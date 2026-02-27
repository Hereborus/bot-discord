import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, EndBehaviorType } from "@discordjs/voice";
import http from "http";
import fs from "fs";
import path from "path";
import prism from "prism-media";
import dotenv from "dotenv";
import { fft, util as fftUtil } from "fft-js";

dotenv.config();

// audio configuration (thresholds in dB and duration window in ms)
const AUDIO_CONFIG = {
    thresholds: {
        low: -50,
        medium: -30,
        high: -15, // above this is "high" volume
    },
    durationWindow: 1000, // rolling window to aggregate dB samples
    sampleInterval: 200, // how often analysis tick fires (ms)
    // frequency bands (Hz) and minimum energy to trigger
    freqBands: [
        { name: "low", min: 20, max: 500 },
        { name: "mid", min: 500, max: 2000 },
        { name: "high", min: 2000, max: 10000 },
    ],
    // emotions for high-volume triggers based on frequency dominance
    emotions: {
        scream: "high", // high volume + high-frequency dominant -> scream/fear
        anger: "low", // high volume + low-frequency dominant -> anger
    },
};

// expose config logging
console.log("Audio config:", JSON.stringify(AUDIO_CONFIG, null, 2));

// util to serve obs-widget statically
const staticDir = path.join(process.cwd(), "obs-widget");
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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// Serveur simple exposant les niveaux audio par utilisateur et widget static
const userLevels = new Map();
const levelsPort = process.env.LEVELS_PORT || 3000;
const server = http.createServer((req, res) => {
    // Essayer de servir un fichier statique du widget
    if (serveStatic(req, res)) return;

    if (req.url === "/levels") {
        // Allow OBS browser source (and other origins) to fetch levels
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        });
        const obj = {};
        for (const [k, v] of userLevels) obj[k] = v;
        res.end(JSON.stringify(obj));
        return;
    }

    if (req.url === "/config") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(AUDIO_CONFIG));
        return;
    }

    res.writeHead(404);
    res.end();
});
server.listen(levelsPort, () =>
    console.log(
        `Server listening on http://localhost:${levelsPort}/ (levels & widget)`,
    ),
);

client.once("clientReady", () => {
    console.log("Bot is ready!");
});

client.login(process.env.DISCORD_TOKEN);

client.on("messageCreate", async (message) => {
    if (message.content === "!join") {
        const channel = message.member.voice.channel;

        if (!channel) {
            return message.reply("You need to be in a voice channel first!");
        }

        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
            });

            // Le receiver peut ne pas être disponible selon la version de la lib
            if (connection && connection.receiver) {
                const receiver = connection.receiver;

                // Quand un utilisateur commence à parler, on s'abonne au flux Opus
                receiver.speaking.on("start", (userId) => {
                    console.log(`🔊 ${userId} commence à parler`);

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

                        let sumSquares = 0;
                        let sampleCount = 0;
                        const history = [];
                        // buffer for frequency analysis (mono)
                        const freqBuffer = [];

                        // Agrégation périodique pour calculer RMS -> dB avec pondération durée
                        const tick = setInterval(() => {
                            if (sampleCount > 0) {
                                const rms =
                                    Math.sqrt(sumSquares / sampleCount) / 32768;
                                const db =
                                    rms > 0 ? 20 * Math.log10(rms) : -100;
                                const now = Date.now();
                                history.push({ db, t: now });
                                // purge anciennes entrées hors fenêtre
                                while (
                                    history.length &&
                                    now - history[0].t >
                                        AUDIO_CONFIG.durationWindow
                                ) {
                                    history.shift();
                                }
                                const avg =
                                    history.reduce((a, v) => a + v.db, 0) /
                                    history.length;
                                let status;
                                if (avg < AUDIO_CONFIG.thresholds.low)
                                    status = "silent";
                                else if (avg < AUDIO_CONFIG.thresholds.medium)
                                    status = "low";
                                else if (avg < AUDIO_CONFIG.thresholds.high)
                                    status = "medium";
                                else status = "high";
                                // frequency analysis
                                let freqInfo = null;
                                if (freqBuffer.length >= 1024) {
                                    // compute FFT
                                    const phasors = fft(
                                        freqBuffer.slice(0, 1024),
                                    );
                                    const mags = fftUtil.fftMag(phasors);
                                    const binFreq = 48000 / 1024; // approx Hz per bin
                                    const bandE = {};
                                    AUDIO_CONFIG.freqBands.forEach((b) => {
                                        let sum = 0,
                                            count = 0;
                                        const startBin = Math.floor(
                                            b.min / binFreq,
                                        );
                                        const endBin = Math.ceil(
                                            b.max / binFreq,
                                        );
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
                                }
                                userLevels.set(userId, {
                                    rms,
                                    db: Math.round(db * 100) / 100,
                                    status,
                                    freq: freqInfo,
                                    updated: now,
                                });
                                sumSquares = 0;
                                sampleCount = 0;
                            }
                        }, AUDIO_CONFIG.sampleInterval);

                        decoder.on("data", (chunk) => {
                            for (let i = 0; i < chunk.length; i += 2) {
                                const sample = chunk.readInt16LE(i);
                                sumSquares += sample * sample;
                                sampleCount++;
                                // push mono sample to freqBuffer (use left channel)
                                freqBuffer.push(sample / 32768);
                                if (freqBuffer.length > 2048)
                                    freqBuffer.shift();
                            }
                        });

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
                        console.error(
                            "Erreur lors de l'abonnement au flux audio:",
                            err,
                        );
                    }
                });

                receiver.speaking.on("end", (userId) => {
                    console.log(`🔇 ${userId} a arrêté`);
                    userLevels.set(userId, {
                        rms: 0,
                        db: -100,
                        status: "silent",
                        updated: Date.now(),
                    });
                });
            } else {
                console.log(
                    "Receiver non disponible sur la connexion vocale (vérifier la version de @discordjs/voice).",
                );
            }
        } catch (err) {
            console.error("Erreur en rejoignant le vocal :", err);
            return message.reply(
                "Impossible de rejoindre le vocal (vérifiez mes permissions).",
            );
        }

        message.reply("Je rejoins le vocal 👀");
    }
});

import { getVoiceConnection } from "@discordjs/voice";

client.on("voiceStateUpdate", (oldState, newState) => {
    const guild = oldState.guild || newState.guild;
    if (!guild) return;

    const connection = getVoiceConnection(guild.id);
    if (!connection) return;

    const channel = guild.channels.cache.get(connection.joinConfig.channelId);
    if (!channel) return;

    // Compte les membres NON bot
    const nonBotMembers = channel.members.filter((member) => !member.user.bot);

    if (nonBotMembers.size === 0) {
        setTimeout(() => {
            const refreshedChannel = oldState.guild.channels.cache.get(
                connection.joinConfig.channelId,
            );
            const stillAlone = refreshedChannel.members.filter(
                (m) => !m.user.bot,
            );

            if (stillAlone.size === 0) {
                console.log("Toujours seul, je quitte");
                connection.destroy();
            }
        }, 5000); // attend 5 secondes
    }
});
