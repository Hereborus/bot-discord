/**
 * Discord Audio Level Bot — Raw Data Mode
 * ========================================
 * Le bot analyse l'audio et expose UNIQUEMENT les données brutes.
 * Toute la logique de classification (thresholds, émotions) est
 * gérée côté client local par chaque streamer.
 *
 * DONNÉES EXPOSÉES par userId:
 *   db          — niveau en décibels (float, ex: -23.4)
 *   rms         — RMS normalisé 0–1
 *   freq        — énergie par bande { low, mid, high } (float)
 *   speaking    — bool, true si micro actif
 *   displayName — pseudo Discord du membre
 *   updated     — timestamp ms
 *
 * ENDPOINTS:
 *   GET /levels  → payload complet
 *   GET /status  → état du bot
 *
 * ENV (.env):
 *   DISCORD_TOKEN  — requis
 *   LEVELS_PORT    — port HTTP (défaut: 3000)
 *
 * COMMANDES DISCORD:
 *   !join        — rejoindre le canal vocal
 *   !disconnect  — quitter
 *   !status      — état du bot
 */

import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, EndBehaviorType, getVoiceConnection } from "@discordjs/voice";
import http from "http";
import fs from "fs";
import path from "path";
import prism from "prism-media";
import dotenv from "dotenv";
import fftPkg from "fft-js";

const { fft, util: fftUtil } = fftPkg;
dotenv.config();

// ============================================================================
// PARAMÈTRES AUDIO INTERNES (non-exposés aux clients, non-configurables)
// Ces valeurs concernent uniquement l'analyse technique, pas la classification.
// ============================================================================

const AUDIO = {
  sampleRate:     48000,
  sampleInterval: 50,     // ms entre chaque tick d'analyse (était 100)
  durationWindow: 200,    // ms de rolling average — réactif sans être instable (était 800)
  fftSize:        1024,   // taille FFT (puissance de 2)
  // Bandes fréquence fixes pour l'analyse — les clients peuvent les interpréter librement
  freqBands: {
    low:  { min: 20,   max: 500   },
    mid:  { min: 500,  max: 2000  },
    high: { min: 2000, max: 10000 },
  },
};

// ============================================================================
// STATE
// ============================================================================

// userId → { db, rms, freq, speaking, displayName, updated }
const userLevels = new Map();

let botConnected       = false;
let currentConnection  = null;
let connectedGuildId   = null;
let connectedChannelId = null;

const PORT = process.env.LEVELS_PORT || 3000;

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

const STATIC_DIR = process.cwd();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".json": "application/json",
};

/**
 * Sert un fichier statique depuis le dossier du bot.
 * Retourne true si le fichier a été servi, false sinon.
 */
function serveStatic(req, res) {
  const url      = new URL(req.url, `http://localhost`);
  let   pathname = url.pathname;

  // Racine → index.html
  if (pathname === "/" || pathname === "") pathname = "/index.html";

  const filePath = path.join(STATIC_DIR, pathname);

  // Sécurité : empêcher les path traversal (../../etc)
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403); res.end(); return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": mime, ...CORS_HEADERS });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ============================================================================
// HTTP SERVER
// ============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, CORS_HEADERS);
    res.end();
    return;
  }

  // ── GET /levels ─────────────────────────────────────────────────────────
  if (req.url === "/levels") {
    res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json" });

    const payload = {
      _bot: {
        connected:  botConnected,
        guildId:    connectedGuildId,
        channelId:  connectedChannelId,
        updatedAt:  new Date().toISOString(),
      },
    };

    for (const [id, data] of userLevels) {
      payload[id] = data;
    }

    res.end(JSON.stringify(payload));
    return;
  }

  // ── GET /status ──────────────────────────────────────────────────────────
  if (req.url === "/status") {
    res.writeHead(200, { ...CORS_HEADERS, "Content-Type": "application/json" });
    res.end(JSON.stringify({
      botConnected,
      connectedGuildId,
      connectedChannelId,
      usersActive: userLevels.size,
      timestamp:   new Date().toISOString(),
    }));
    return;
  }

  // ── Fichiers statiques (index.html, viewer.html, etc.) ──────────────────
  if (serveStatic(req, res)) return;

  res.writeHead(404);
  res.end("Not found");

}).listen(PORT, () => {
  console.log(`✓ HTTP → http://localhost:${PORT}/`);
  console.log(`  ├─ Config UI  : http://localhost:${PORT}/index.html`);
  console.log(`  ├─ Viewer OBS : http://localhost:${PORT}/viewer.html`);
  console.log(`  └─ API data   : http://localhost:${PORT}/levels`);
});

// ============================================================================
// FFT HELPERS
// ============================================================================

/**
 * Calcule l'énergie moyenne par bande de fréquence depuis un buffer PCM normalisé.
 * @param {number[]} buffer - échantillons normalisés [-1, 1]
 * @returns {{ low: number, mid: number, high: number }}
 */
function computeFreqBands(buffer) {
  if (buffer.length < AUDIO.fftSize) return { low: 0, mid: 0, high: 0 };

  try {
    const slice   = buffer.slice(0, AUDIO.fftSize);
    const phasors = fft(slice);
    const mags    = fftUtil.fftMag(phasors);
    const binHz   = AUDIO.sampleRate / AUDIO.fftSize;
    const result  = {};

    for (const [name, band] of Object.entries(AUDIO.freqBands)) {
      let sum = 0, count = 0;
      const start = Math.floor(band.min / binHz);
      const end   = Math.ceil(band.max / binHz);
      for (let i = start; i <= end && i < mags.length; i++) {
        sum += mags[i];
        count++;
      }
      result[name] = count ? Math.round((sum / count) * 1000) / 1000 : 0;
    }

    return result;
  } catch {
    return { low: 0, mid: 0, high: 0 };
  }
}

// ============================================================================
// AUDIO SUBSCRIPTION
// ============================================================================

function subscribeUser(receiver, userId, displayName) {
  try {
    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 150 }, // était 300ms
    });

    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels:  2,
      rate:      AUDIO.sampleRate,
    });
    opusStream.pipe(decoder);

    let sumSquares  = 0;
    let sampleCount = 0;
    const history   = [];   // rolling window { db, t }
    const freqBuf   = [];   // buffer PCM pour FFT

    // ── Tick d'analyse ─────────────────────────────────────────────────────
    const tick = setInterval(() => {
      if (sampleCount === 0) return;

      const rms = Math.sqrt(sumSquares / sampleCount) / 32768;
      const db  = rms > 0 ? 20 * Math.log10(rms) : -100;
      const now = Date.now();

      // Rolling average
      history.push({ db, t: now });
      while (history.length && now - history[0].t > AUDIO.durationWindow) {
        history.shift();
      }
      const avgDb = history.reduce((a, v) => a + v.db, 0) / history.length;

      // Fréquences
      const freq = computeFreqBands(freqBuf);

      // Stocker les données brutes — aucune classification ici
      userLevels.set(userId, {
        db:          Math.round(avgDb * 100) / 100,
        rms:         Math.round(rms * 10000) / 10000,
        freq,                          // { low, mid, high } — énergie brute
        speaking:    true,
        displayName,
        updated:     now,
      });

      sumSquares  = 0;
      sampleCount = 0;
    }, AUDIO.sampleInterval);

    // ── Accumulation PCM ───────────────────────────────────────────────────
    decoder.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i += 2) {
        const sample = chunk.readInt16LE(i);
        sumSquares  += sample * sample;
        sampleCount++;
        freqBuf.push(sample / 32768);
        if (freqBuf.length > AUDIO.fftSize * 2) freqBuf.shift();
      }
    });

    // ── Cleanup ────────────────────────────────────────────────────────────
    const cleanup = () => {
      clearInterval(tick);
      try { opusStream.destroy(); } catch (_) {}
      try { decoder.destroy(); }   catch (_) {}
      const prev = userLevels.get(userId) || {};
      userLevels.set(userId, {
        ...prev,
        db:       -100,
        rms:      0,
        freq:     { low: 0, mid: 0, high: 0 },
        speaking: false,
        updated:  Date.now(),
      });
    };

    opusStream.on("end",   cleanup);
    opusStream.on("close", cleanup);
    decoder.on("end",      cleanup);

    // DAVE E2E encryption (Discord 2024+) — certains paquets chiffres
    // ne peuvent pas etre dechiffres par le bot. On ignore silencieusement.
    opusStream.on("error", (err) => {
      if (err?.message?.includes("DecryptionFailed") || err?.code === "GenericFailure") return;
      console.error(`opusStream error (${userId}):`, err);
    });
    decoder.on("error", (err) => {
      console.error(`decoder error (${userId}):`, err);
    });

  } catch (err) {
    console.error(`Audio error (${userId}):`, err);
  }
}

// ============================================================================
// DISCORD CLIENT
// ============================================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once("clientReady", () => {
  botConnected = true;
  console.log(`✓ Bot ready — ${client.user.tag}`);
});

// ============================================================================
// COMMANDES DISCORD
// ============================================================================

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // !join
  if (message.content === "!join") {
    const channel = message.member?.voice.channel;
    if (!channel) return message.reply("❌ Tu dois être dans un canal vocal.");

    try {
      const connection = joinVoiceChannel({
        channelId:      channel.id,
        guildId:        channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf:       false,
      });

      currentConnection  = connection;
      connectedGuildId   = channel.guild.id;
      connectedChannelId = channel.id;
      console.log(`📍 Joined: ${channel.guild.name} / ${channel.name}`);

      const receiver = connection.receiver;

      receiver.speaking.on("start", (userId) => {
        const member      = channel.guild.members.cache.get(userId);
        const displayName = member?.displayName || member?.user?.username || userId;
        console.log(`🔊 ${displayName}`);
        subscribeUser(receiver, userId, displayName);
      });

      receiver.speaking.on("end", (userId) => {
        const prev = userLevels.get(userId) || {};
        console.log(`🔇 ${prev.displayName || userId}`);
        userLevels.set(userId, {
          ...prev,
          db: -100, rms: 0,
          freq: { low: 0, mid: 0, high: 0 },
          speaking: false,
          updated: Date.now(),
        });
      });

      return message.reply("✅ Connecté — données disponibles sur /levels");
    } catch (err) {
      console.error("Join error:", err);
      return message.reply("❌ Impossible de rejoindre le canal.");
    }
  }

  // !disconnect
  if (message.content === "!disconnect") {
    if (!currentConnection) return message.reply("❌ Pas connecté.");
    currentConnection.destroy();
    currentConnection = null;
    connectedGuildId  = null;
    connectedChannelId = null;
    userLevels.clear();
    console.log("✋ Disconnected");
    return message.reply("👋 Déconnecté.");
  }

  // !status
  if (message.content === "!status") {
    const lines = [...userLevels.entries()]
      .map(([id, v]) => `  • **${v.displayName || id}** — ${v.db} dB ${v.speaking ? "🎙" : "🔇"}`)
      .join("\n") || "  (aucun)";
    return message.reply(
      `**Bot** Discord:${botConnected?"✅":"❌"} Voice:${connectedGuildId?"✅":"❌"}\n${lines}\nAPI: http://localhost:${PORT}/levels`
    );
  }
});

// ============================================================================
// AUTO-DISCONNECT SI SEUL
// ============================================================================

client.on("voiceStateUpdate", (oldState) => {
  const guild = oldState.guild;
  if (!guild) return;
  const connection = getVoiceConnection(guild.id);
  if (!connection) return;
  const channel = guild.channels.cache.get(connection.joinConfig.channelId);
  if (!channel) return;
  if (channel.members.filter(m => !m.user.bot).size > 0) return;

  setTimeout(() => {
    const ch = guild.channels.cache.get(connection.joinConfig.channelId);
    if (ch?.members.filter(m => !m.user.bot).size === 0) {
      console.log("🔇 Seul dans le canal — déconnexion auto");
      connection.destroy();
      currentConnection = null;
      connectedGuildId  = null;
      connectedChannelId = null;
      userLevels.clear();
    }
  }, 5000);
});

// ============================================================================
// BOOT
// ============================================================================

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN manquant dans .env");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
console.log("✓ Discord Audio Bot initialized (raw data mode)");
