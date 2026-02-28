/**
 * Discord Audio Level Bot — Raw Data Mode
 * =========================================
 * ENDPOINTS:
 *   GET  /levels                          → données audio temps réel
 *   GET  /status                          → état du bot
 *   GET  /images/{userId}/{state}/{file}  → servir une image uploadée
 *   GET  /frames/{userId}                 → liste des frames par état
 *   POST /upload                          → upload image (multipart/form-data)
 *   POST /reorder                         → réordonner les frames d'un état
 *   POST /delete-frame                    → supprimer une frame
 *
 * ENV (.env): DISCORD_TOKEN, LEVELS_PORT (défaut: 3000)
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

const ROOT = process.cwd();
const IMAGES_DIR = path.join(ROOT, "images");
const META_DIR = path.join(ROOT, "meta");
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

const AUDIO = {
    sampleRate: 48000,
    sampleInterval: 50,
    durationWindow: 200,
    fftSize: 1024,
    freqBands: {
        low: { min: 20, max: 500 },
        mid: { min: 500, max: 2000 },
        high: { min: 2000, max: 10000 },
    },
};

const userLevels = new Map();
let botConnected = false,
    currentConnection = null,
    connectedGuildId = null,
    connectedChannelId = null;
const PORT = process.env.LEVELS_PORT || 3000;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json",
};
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function serveFile(res, filePath) {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile())
        return false;
    const mime =
        MIME[path.extname(filePath).toLowerCase()] ||
        "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, ...CORS });
    fs.createReadStream(filePath).pipe(res);
    return true;
}
function json(res, data, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json", ...CORS });
    res.end(JSON.stringify(data));
}
function readBody(req) {
    return new Promise((res, rej) => {
        const c = [];
        req.on("data", (d) => c.push(d));
        req.on("end", () => res(Buffer.concat(c)));
        req.on("error", rej);
    });
}

function metaPath(userId) {
    return path.join(META_DIR, `${userId}.json`);
}
function readMeta(userId) {
    try {
        return JSON.parse(fs.readFileSync(metaPath(userId), "utf-8"));
    } catch {
        return {};
    }
}
function writeMeta(userId, meta) {
    fs.writeFileSync(metaPath(userId), JSON.stringify(meta, null, 2));
}
function stateDir(userId, stateKey) {
    return path.join(IMAGES_DIR, userId, stateKey);
}

function getFrames(userId) {
    const meta = {},
        result = {};
    Object.assign(meta, readMeta(userId));
    const userDir = path.join(IMAGES_DIR, userId);
    if (!fs.existsSync(userDir)) return result;
    for (const state of fs
        .readdirSync(userDir)
        .filter((s) => fs.statSync(path.join(userDir, s)).isDirectory())) {
        const order = meta[state] || [],
            dir = stateDir(userId, state);
        const existing = fs
            .readdirSync(dir)
            .filter((f) => MIME[path.extname(f).toLowerCase()]);
        const ordered = order.filter((f) => existing.includes(f));
        const unordered = existing.filter((f) => !ordered.includes(f));
        result[state] = [...ordered, ...unordered].map((f) => ({
            file: f,
            url: `/images/${userId}/${state}/${f}`,
        }));
    }
    return result;
}

// Multipart parser minimal
function indexOf(buf, search, start = 0) {
    for (let i = start; i <= buf.length - search.length; i++) {
        let ok = true;
        for (let j = 0; j < search.length; j++) {
            if (buf[i + j] !== search[j]) {
                ok = false;
                break;
            }
        }
        if (ok) return i;
    }
    return -1;
}
function parseMultipart(body, boundary) {
    const parts = [],
        sep = Buffer.from(`--${boundary}`);
    let offset = 0;
    while (offset < body.length) {
        const start = indexOf(body, sep, offset);
        if (start === -1) break;
        offset = start + sep.length;
        if (body[offset] === 45 && body[offset + 1] === 45) break;
        if (body[offset] === 13) offset += 2;
        const headerEnd = indexOf(body, Buffer.from("\r\n\r\n"), offset);
        if (headerEnd === -1) break;
        const headerStr = body.slice(offset, headerEnd).toString();
        offset = headerEnd + 4;
        const nextSep = indexOf(body, sep, offset);
        const dataEnd = nextSep === -1 ? body.length : nextSep - 2;
        const data = body.slice(offset, dataEnd);
        offset = nextSep === -1 ? body.length : nextSep;
        parts.push({
            name: headerStr.match(/name="([^"]+)"/)?.[1] || "",
            filename: headerStr.match(/filename="([^"]+)"/)?.[1] || "",
            contentType:
                headerStr.match(/Content-Type:\s*(.+)/i)?.[1]?.trim() || "",
            data,
        });
    }
    return parts;
}

// HTTP SERVER
http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);
    if (req.method === "OPTIONS") {
        res.writeHead(200, CORS);
        res.end();
        return;
    }

    // GET /levels
    if (req.method === "GET" && url.pathname === "/levels") {
        const p = {
            _bot: {
                connected: botConnected,
                guildId: connectedGuildId,
                channelId: connectedChannelId,
                updatedAt: new Date().toISOString(),
            },
        };
        for (const [id, data] of userLevels) p[id] = data;
        return json(res, p);
    }

    // GET /status
    if (req.method === "GET" && url.pathname === "/status") {
        return json(res, {
            botConnected,
            connectedGuildId,
            connectedChannelId,
            usersActive: userLevels.size,
        });
    }

    // GET /frames/:userId
    if (req.method === "GET" && url.pathname.startsWith("/frames/")) {
        const userId = url.pathname.split("/")[2];
        return json(res, userId ? getFrames(userId) : {});
    }

    // GET /frames  (tous)
    if (req.method === "GET" && url.pathname === "/frames") {
        const all = {};
        if (fs.existsSync(IMAGES_DIR)) {
            for (const uid of fs.readdirSync(IMAGES_DIR)) {
                if (fs.statSync(path.join(IMAGES_DIR, uid)).isDirectory())
                    all[uid] = getFrames(uid);
            }
        }
        return json(res, all);
    }

    // GET /images/:userId/:state/:file
    if (req.method === "GET" && url.pathname.startsWith("/images/")) {
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 4) {
            res.writeHead(400);
            res.end();
            return;
        }
        const [, userId, state, file] = parts;
        const fp = path.join(IMAGES_DIR, userId, state, file);
        if (!fp.startsWith(IMAGES_DIR)) {
            res.writeHead(403);
            res.end();
            return;
        }
        if (!serveFile(res, fp)) {
            res.writeHead(404);
            res.end("Not found");
        }
        return;
    }

    // POST /upload
    if (req.method === "POST" && url.pathname === "/upload") {
        try {
            const body = await readBody(req);
            const ct = req.headers["content-type"] || "";
            const bm = ct.match(/boundary=(.+)/);
            if (!bm) return json(res, { error: "boundary manquant" }, 400);
            const parts = parseMultipart(body, bm[1]);
            const fields = {};
            let imgPart = null;
            for (const p of parts) {
                if (p.filename) imgPart = p;
                else fields[p.name] = p.data.toString().trim();
            }
            const { userId, stateKey } = fields;
            if (!userId || !stateKey || !imgPart)
                return json(
                    res,
                    { error: "userId, stateKey et image requis" },
                    400,
                );
            const ext = path.extname(imgPart.filename).toLowerCase();
            if (!MIME[ext] || !MIME[ext].startsWith("image/"))
                return json(res, { error: "Format non supporté" }, 400);
            const dir = stateDir(userId, stateKey);
            fs.mkdirSync(dir, { recursive: true });
            const fname = `${Date.now()}_${imgPart.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            fs.writeFileSync(path.join(dir, fname), imgPart.data);
            const meta = readMeta(userId);
            if (!meta[stateKey]) meta[stateKey] = [];
            meta[stateKey].push(fname);
            writeMeta(userId, meta);
            console.log(`📁 Upload: ${userId}/${stateKey}/${fname}`);
            return json(res, {
                ok: true,
                file: fname,
                url: `/images/${userId}/${stateKey}/${fname}`,
            });
        } catch (err) {
            return json(res, { error: err.message }, 500);
        }
    }

    // POST /reorder  { userId, stateKey, order:[] }
    if (req.method === "POST" && url.pathname === "/reorder") {
        try {
            const { userId, stateKey, order } = JSON.parse(
                (await readBody(req)).toString(),
            );
            if (!userId || !stateKey || !Array.isArray(order))
                return json(res, { error: "params manquants" }, 400);
            const meta = readMeta(userId);
            meta[stateKey] = order;
            writeMeta(userId, meta);
            return json(res, { ok: true });
        } catch (err) {
            return json(res, { error: err.message }, 500);
        }
    }

    // POST /delete-frame  { userId, stateKey, file }
    if (req.method === "POST" && url.pathname === "/delete-frame") {
        try {
            const { userId, stateKey, file } = JSON.parse(
                (await readBody(req)).toString(),
            );
            if (!userId || !stateKey || !file)
                return json(res, { error: "params manquants" }, 400);
            const fp = path.join(IMAGES_DIR, userId, stateKey, file);
            if (!fp.startsWith(IMAGES_DIR))
                return json(res, { error: "Interdit" }, 403);
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
            const meta = readMeta(userId);
            if (meta[stateKey])
                meta[stateKey] = meta[stateKey].filter((f) => f !== file);
            writeMeta(userId, meta);
            console.log(`🗑 Deleted: ${userId}/${stateKey}/${file}`);
            return json(res, { ok: true });
        } catch (err) {
            return json(res, { error: err.message }, 500);
        }
    }

    // Fichiers statiques
    let pathname = url.pathname;
    if (pathname === "/" || pathname === "") pathname = "/index.html";
    const fp = path.join(ROOT, pathname);
    if (!fp.startsWith(ROOT)) {
        res.writeHead(403);
        res.end();
        return;
    }
    if (serveFile(res, fp)) return;
    res.writeHead(404);
    res.end("Not found");
}).listen(PORT, () => {
    console.log(`✓ HTTP → http://localhost:${PORT}/`);
    console.log(`  ├─ Config UI  : http://localhost:${PORT}/index.html`);
    console.log(
        `  ├─ Viewer OBS : http://localhost:${PORT}/viewer.html?userId=DISCORD_ID`,
    );
    console.log(`  └─ API data   : http://localhost:${PORT}/levels`);
});

// FFT
function computeFreqBands(buffer) {
    if (buffer.length < AUDIO.fftSize) return { low: 0, mid: 0, high: 0 };
    try {
        const mags = fftUtil.fftMag(fft(buffer.slice(0, AUDIO.fftSize)));
        const binHz = AUDIO.sampleRate / AUDIO.fftSize,
            result = {};
        for (const [name, band] of Object.entries(AUDIO.freqBands)) {
            let sum = 0,
                count = 0;
            for (
                let i = Math.floor(band.min / binHz);
                i <= Math.ceil(band.max / binHz) && i < mags.length;
                i++
            ) {
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

// Audio subscription
function subscribeUser(receiver, userId, displayName) {
    try {
        const opusStream = receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 150 },
        });
        const decoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 2,
            rate: AUDIO.sampleRate,
        });
        opusStream.pipe(decoder);
        let sumSq = 0,
            sampleCount = 0;
        const history = [],
            freqBuf = [];
        const tick = setInterval(() => {
            if (!sampleCount) return;
            const rms = Math.sqrt(sumSq / sampleCount) / 32768,
                db = rms > 0 ? 20 * Math.log10(rms) : -100,
                now = Date.now();
            history.push({ db, t: now });
            while (history.length && now - history[0].t > AUDIO.durationWindow)
                history.shift();
            const avgDb =
                history.reduce((a, v) => a + v.db, 0) / history.length;
            userLevels.set(userId, {
                db: Math.round(avgDb * 100) / 100,
                rms: Math.round(rms * 10000) / 10000,
                freq: computeFreqBands(freqBuf),
                speaking: true,
                displayName,
                updated: now,
            });
            sumSq = 0;
            sampleCount = 0;
        }, AUDIO.sampleInterval);
        decoder.on("data", (chunk) => {
            for (let i = 0; i < chunk.length; i += 2) {
                const s = chunk.readInt16LE(i);
                sumSq += s * s;
                sampleCount++;
                freqBuf.push(s / 32768);
                if (freqBuf.length > AUDIO.fftSize * 2) freqBuf.shift();
            }
        });
        const cleanup = () => {
            clearInterval(tick);
            try {
                opusStream.destroy();
            } catch (_) {}
            try {
                decoder.destroy();
            } catch (_) {}
            const prev = userLevels.get(userId) || {};
            userLevels.set(userId, {
                ...prev,
                db: -100,
                rms: 0,
                freq: { low: 0, mid: 0, high: 0 },
                speaking: false,
                updated: Date.now(),
            });
        };
        opusStream.on("end", cleanup);
        opusStream.on("close", cleanup);
        decoder.on("end", cleanup);
        opusStream.on("error", (err) => {
            if (
                err?.message?.includes("DecryptionFailed") ||
                err?.code === "GenericFailure"
            )
                return;
            console.error(`opusStream error:`, err);
        });
        decoder.on("error", (err) => console.error(`decoder error:`, err));
    } catch (err) {
        console.error(`Audio error (${userId}):`, err);
    }
}

// Discord
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

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.content === "!join") {
        const channel = message.member?.voice.channel;
        if (!channel)
            return message.reply("❌ Tu dois être dans un canal vocal.");
        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
            });
            currentConnection = connection;
            connectedGuildId = channel.guild.id;
            connectedChannelId = channel.id;
            console.log(`📍 Joined: ${channel.guild.name} / ${channel.name}`);
            const receiver = connection.receiver;
            receiver.speaking.on("start", (userId) => {
                const member = channel.guild.members.cache.get(userId);
                const displayName =
                    member?.displayName || member?.user?.username || userId;
                console.log(`🔊 ${displayName}`);
                subscribeUser(receiver, userId, displayName);
            });
            receiver.speaking.on("end", (userId) => {
                const prev = userLevels.get(userId) || {};
                userLevels.set(userId, {
                    ...prev,
                    db: -100,
                    rms: 0,
                    freq: { low: 0, mid: 0, high: 0 },
                    speaking: false,
                    updated: Date.now(),
                });
            });
            const members = channel.members.filter((m) => !m.user.bot);
            const links = members
                .map(
                    (m) =>
                        `  • ${m.displayName}: http://localhost:${PORT}/viewer.html?userId=${m.id}`,
                )
                .join("\n");
            return message.reply(
                `✅ Connecté !\n Config URLs: http://localhost:${PORT}/index.html\nURLs OBS viewer:\n${links || "  (aucun membre)"}`,
            );
        } catch (err) {
            console.error("Join error:", err);
            return message.reply("❌ Impossible de rejoindre le canal.");
        }
    }
    if (message.content === "!disconnect") {
        if (!currentConnection) return message.reply("❌ Pas connecté.");
        currentConnection.destroy();
        currentConnection = null;
        connectedGuildId = null;
        connectedChannelId = null;
        userLevels.clear();
        return message.reply("👋 Déconnecté.");
    }
    if (message.content === "!status") {
        const lines =
            [...userLevels.entries()]
                .map(
                    ([id, v]) =>
                        `  • **${v.displayName || id}** — ${v.db} dB ${v.speaking ? "🎙" : "🔇"}`,
                )
                .join("\n") || "  (aucun)";
        return message.reply(
            `**Bot** Discord:${botConnected ? "✅" : "❌"} Voice:${connectedGuildId ? "✅" : "❌"}\n${lines}`,
        );
    }
});

client.on("voiceStateUpdate", (oldState) => {
    const guild = oldState.guild;
    if (!guild) return;
    const connection = getVoiceConnection(guild.id);
    if (!connection) return;
    const channel = guild.channels.cache.get(connection.joinConfig.channelId);
    if (!channel) return;
    if (channel.members.filter((m) => !m.user.bot).size > 0) return;
    setTimeout(() => {
        const ch = guild.channels.cache.get(connection.joinConfig.channelId);
        if (ch?.members.filter((m) => !m.user.bot).size === 0) {
            connection.destroy();
            currentConnection = null;
            connectedGuildId = null;
            connectedChannelId = null;
            userLevels.clear();
            console.log("🔇 Seul → déconnexion auto");
        }
    }, 5000);
});

if (!process.env.DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN manquant dans .env");
    process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
console.log("✓ Bot initialized");
