/**
 * Discord Audio Level Analysis Bot
 * ================================
 *
 * Bot Discord qui analyse les niveaux audio en temps réel
 * et expose les données via HTTP API pour un widget/viewer.
 *
 * ARCHITECTURE:
 * - Discord Bot Client: Rejoins canal vocal, écoute audio
 * - Audio Analysis: RMS/dB, FFT frequency analysis
 * - HTTP Server: Expose API endpoints pour le widget
 * - Widget (viewer.js): Gère l'affichage et les transitions
 *
 * RESPONSABILITÉ DE CE FICHIER:
 * - Connexion à Discord
 * - Analyse audio (conversion Opus → PCM)
 * - Calcul RMS/dB et FFT fréquence
 * - Stockage des données en mémoire
 * - Exposition via HTTP API
 * - Gestion des commandes Discord
 *
 * DÉPENDANCES:
 * - discord.js: Bot API
 * - @discordjs/voice: Voice channels
 * - @discordjs/opus: Opus codec
 * - prism-media: PCM decoding
 * - fft-js: Frequency analysis
 * - dotenv: .env variables
 *
 * VARIABLES D'ENVIRONNEMENT:
 * - DISCORD_TOKEN: Bot token (required)
 * - LEVELS_PORT: HTTP port (default: 3000)
 *
 * COMMANDES DISCORD:
 * - !join: Rejoindre le canal vocal de l'utilisateur
 * - !disconnect: Quitter le canal vocal
 * - !status: Afficher l'état du bot
 *
 * ENDPOINTS HTTP:
 * - GET /levels: Données audio en temps réel + état bot
 * - GET /status: État de connexion du bot
 * - GET /config: Configuration audio (thresholds, freq bands)
 * - GET / (static): Fichiers de obs-widget/
 */

import { Client, GatewayIntentBits } from "discord.js";
import {
    joinVoiceChannel,
    EndBehaviorType,
    getVoiceConnection,
} from "@discordjs/voice";
import http from "http";
import fs from "fs";
import path from "path";
import prism from "prism-media";
import dotenv from "dotenv";
import fftPkg from "fft-js";

const { fft, util: fftUtil } = fftPkg;

dotenv.config();

// ============================================================================
// AUDIO CONFIGURATION
// ============================================================================

/**
 * Paramètres d'analyse audio
 *
 * THRESHOLDS: Niveaux dB pour classifier le statut
 *   - silent: < -50 dB
 *   - low: -50 à -30 dB
 *   - medium: -30 à -15 dB
 *   - high: > -15 dB
 *
 * DURATION_WINDOW: Fenêtre rolling (1000ms) pour lisser
 * SAMPLE_INTERVAL: Fréquence d'analyse (200ms par tick)
 *
 * FREQ_BANDS: Bandes de fréquence pour détection emotion
 *   - low (20-500 Hz): Colère
 *   - mid (500-2000 Hz): Parole normale
 *   - high (2000-10000 Hz): Peur/Cri
 */
const AUDIO_CONFIG = {
    thresholds: {
        low: -70,
        medium: -50,
        high: -25,
    },
    durationWindow: 1000,
    sampleInterval: 200,
    freqBands: [
        { name: "low", min: 20, max: 500 },
        { name: "mid", min: 500, max: 2000 },
        { name: "high", min: 2000, max: 10000 },
    ],
};

console.log("✓ Audio config:", JSON.stringify(AUDIO_CONFIG, null, 2));

// ============================================================================
// STATIC FILE SERVING
// ============================================================================

const staticDir = path.join(process.cwd(), "obs-widget");

/**
 * Servir les fichiers statiques d'obs-widget/
 * @returns {boolean} true si fichier servi
 */
function serveStatic(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let filePath = path.join(staticDir, url.pathname);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
    }

    if (fs.existsSync(filePath)) {
        const stream = fs.createReadStream(filePath);
        res.writeHead(200);
        stream.pipe(res);
        return true;
    }
    return false;
}

// ============================================================================
// DISCORD CLIENT SETUP
// ============================================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// ============================================================================
// STATE VARIABLES
// ============================================================================

// Données audio en temps réel: userId → { db, status, freq, rms, updated }
const userLevels = new Map();

// État global du bot
let botConnected = false;
let currentConnection = null;
let connectedGuildId = null;
let connectedChannelId = null;

const levelsPort = process.env.LEVELS_PORT || 3000;

// ============================================================================
// HTTP SERVER
// ============================================================================

const server = http.createServer((req, res) => {
    // Essayer de servir fichiers statiques
    if (serveStatic(req, res)) return;

    // Handle OPTIONS for CORS
    if (req.method === "OPTIONS") {
        res.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
    }

    // ========== ENDPOINT: GET /levels ==========
    // Données audio en temps réel + état bot
    if (req.url === "/levels") {
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        });
        const obj = {
            _bot: {
                connected: botConnected,
                guildId: connectedGuildId,
                channelId: connectedChannelId,
                updatedAt: new Date().toISOString(),
            },
        };
        for (const [k, v] of userLevels) obj[k] = v;
        res.end(JSON.stringify(obj));
        return;
    }

    // ========== ENDPOINT: GET /status ==========
    // État général du bot (sans données audio)
    if (req.url === "/status") {
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        });
        res.end(
            JSON.stringify({
                botConnected,
                connectedGuildId,
                connectedChannelId,
                usersListening: userLevels.size,
                timestamp: new Date().toISOString(),
            }),
        );
        return;
    }

    // ========== ENDPOINT: GET /config ==========
    // Configuration audio (lecture seule)
    if (req.url === "/config") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(AUDIO_CONFIG));
        return;
    }

    res.writeHead(404);
    res.end();
});

server.listen(levelsPort, () =>
    console.log(`✓ HTTP server on http://localhost:${levelsPort}/`),
);

// ============================================================================
// DISCORD LIFECYCLE
// ============================================================================

client.once("ready", () => {
    botConnected = true;
    console.log("✓ Bot ready!");
});

client.on("disconnect", () => {
    botConnected = false;
    console.log("⚠ Bot disconnected");
});

client.login(process.env.DISCORD_TOKEN);

// ============================================================================
// DISCORD COMMANDS
// ============================================================================

client.on("messageCreate", async (message) => {
    // ========== COMMAND: !join ==========
    // Rejoindre le canal vocal de l'utilisateur et démarrer l'analyse
    if (message.content === "!join") {
        const channel = message.member?.voice.channel;

        if (!channel) {
            return message.reply("You need to be in a voice channel!");
        }

        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
            });

            currentConnection = connection;
            connectedGuildId = channel.guild.id;
            connectedChannelId = channel.id;
            console.log(`📍 Joined ${channel.guild.name}/${channel.name}`);

            if (!connection?.receiver) {
                console.log("⚠ Receiver not available");
                return message.reply("Audio receiver not available");
            }

            const receiver = connection.receiver;

            // ========== AUDIO STREAM HANDLING ==========
            // Quand un utilisateur parle, s'abonner et analyser son audio
            receiver.speaking.on("start", (userId) => {
                console.log(`🔊 ${userId} started speaking`);

                try {
                    const opusStream = receiver.subscribe(userId, {
                        end: {
                            behavior: EndBehaviorType.AfterSilence,
                            duration: 200,
                        },
                    });

                    const decoder = new prism.opus.Decoder({
                        frameSize: 960,
                        channels: 2,
                        rate: 48000,
                    });
                    opusStream.pipe(decoder);

                    // Accumulateurs pour RMS calculation
                    let sumSquares = 0;
                    let sampleCount = 0;
                    const history = [];
                    const freqBuffer = [];

                    // ========== PERIODIC ANALYSIS TICK ==========
                    // Toutes les SAMPLE_INTERVAL ms, calculer dB, status, frequency
                    const tick = setInterval(() => {
                        if (sampleCount > 0) {
                            // RMS → dB
                            const rms =
                                Math.sqrt(sumSquares / sampleCount) / 32768;
                            const db = rms > 0 ? 20 * Math.log10(rms) : -100;
                            const now = Date.now();

                            // Rolling window
                            history.push({ db, t: now });
                            while (
                                history.length &&
                                now - history[0].t > AUDIO_CONFIG.durationWindow
                            ) {
                                history.shift();
                            }

                            // Average dB over window
                            const avg =
                                history.reduce((a, v) => a + v.db, 0) /
                                history.length;

                            // Classify status
                            let status = "silent";
                            if (avg >= AUDIO_CONFIG.thresholds.low)
                                status = "low";
                            if (avg >= AUDIO_CONFIG.thresholds.medium)
                                status = "medium";
                            if (avg >= AUDIO_CONFIG.thresholds.high)
                                status = "high";

                            // ========== FFT FREQUENCY ANALYSIS ==========
                            let freqInfo = null;
                            let emotion = null;
                            if (freqBuffer.length >= 1024) {
                                const phasors = fft(freqBuffer.slice(0, 1024));
                                const mags = fftUtil.fftMag(phasors);
                                const binFreq = 48000 / 1024;
                                const bandE = {};

                                AUDIO_CONFIG.freqBands.forEach((b) => {
                                    let sum = 0,
                                        count = 0;
                                    const startBin = Math.floor(
                                        b.min / binFreq,
                                    );
                                    const endBin = Math.ceil(b.max / binFreq);
                                    for (
                                        let i = startBin;
                                        i <= endBin && i < mags.length;
                                        i++
                                    ) {
                                        sum += mags[i];
                                        count++;
                                    }
                                    bandE[b.name] = count ? sum / count : 0;
                                });
                                freqInfo = bandE;

                                // Déterminer émotion si status = high
                                if (status === "high") {
                                    emotion =
                                        freqInfo.high > freqInfo.low
                                            ? "scream"
                                            : "anger";
                                }
                            }

                            // Store en mémoire
                            userLevels.set(userId, {
                                rms,
                                db: Math.round(db * 100) / 100,
                                status,
                                freq: freqInfo,
                                emotion,
                                updated: now,
                            });

                            sumSquares = 0;
                            sampleCount = 0;
                        }
                    }, AUDIO_CONFIG.sampleInterval);

                    // ========== DECODER DATA HANDLER ==========
                    // Traiter les samples PCM décodés
                    decoder.on("data", (chunk) => {
                        for (let i = 0; i < chunk.length; i += 2) {
                            const sample = chunk.readInt16LE(i);
                            sumSquares += sample * sample;
                            sampleCount++;
                            freqBuffer.push(sample / 32768);
                            if (freqBuffer.length > 2048) freqBuffer.shift();
                        }
                    });

                    // ========== CLEANUP ==========
                    const cleanup = () => {
                        clearInterval(tick);
                        try {
                            opusStream.destroy();
                        } catch (e) {}
                        try {
                            decoder.destroy();
                        } catch (e) {}
                        userLevels.set(userId, {
                            rms: 0,
                            db: -100,
                            status: "silent",
                            updated: Date.now(),
                        });
                    };

                    opusStream.on("end", cleanup);
                    opusStream.on("close", cleanup);
                    decoder.on("end", cleanup);
                } catch (err) {
                    console.error("Audio subscription error:", err);
                }
            });

            // Quand un utilisateur arrête de parler
            receiver.speaking.on("end", (userId) => {
                console.log(`🔇 ${userId} stopped speaking`);
                userLevels.set(userId, {
                    rms: 0,
                    db: -100,
                    status: "silent",
                    updated: Date.now(),
                });
            });

            return message.reply("Joining voice channel 👀");
        } catch (err) {
            console.error("Join error:", err);
            return message.reply("Failed to join voice channel");
        }
    }

    // ========== COMMAND: !disconnect ==========
    if (message.content === "!disconnect") {
        if (!currentConnection) {
            return message.reply("Not connected to any voice channel");
        }

        try {
            currentConnection.destroy();
            currentConnection = null;
            connectedGuildId = null;
            connectedChannelId = null;
            userLevels.clear();
            console.log("✋ Disconnected");
            return message.reply("Leaving voice channel 👋");
        } catch (err) {
            console.error("Disconnect error:", err);
            return message.reply("Failed to disconnect");
        }
    }

    // ========== COMMAND: !status ==========
    if (message.content === "!status") {
        const status = `
**Bot Status:**
- Discord: ${botConnected ? "✅ Connected" : "❌ Disconnected"}
- Voice: ${connectedGuildId ? "✅ In channel" : "❌ Not in channel"}
- Users: ${userLevels.size}
- API: http://localhost:${levelsPort}/status
        `.trim();
        return message.reply(status);
    }
});

// ============================================================================
// AUTO DISCONNECT
// ============================================================================

/**
 * Si le bot se retrouve seul dans un canal (après 5s),
 * il se déconnecte automatiquement
 */
client.on("voiceStateUpdate", (oldState, newState) => {
    const guild = oldState.guild || newState.guild;
    if (!guild) return;

    const connection = getVoiceConnection(guild.id);
    if (!connection) return;

    const channel = guild.channels.cache.get(connection.joinConfig.channelId);
    if (!channel) return;

    const nonBotMembers = channel.members.filter((m) => !m.user.bot);

    if (nonBotMembers.size === 0) {
        setTimeout(() => {
            const refreshed = oldState.guild?.channels.cache.get(
                connection.joinConfig.channelId,
            );
            const stillAlone = refreshed?.members.filter((m) => !m.user.bot);

            if (stillAlone?.size === 0) {
                console.log("🔇 Alone in channel, leaving");
                connection.destroy();
                if (currentConnection === connection) {
                    currentConnection = null;
                    connectedGuildId = null;
                    connectedChannelId = null;
                    userLevels.clear();
                }
            }
        }, 5000);
    }
});

console.log("✓ Discord Audio Bot initialized");
