/**
 * Discord Audio Level Bot
 * ========================
 * TOKEN SYSTEM : toutes les routes HTTP utilisent un token opaque (HMAC-SHA256 tronqué).
 * Le userId Discord ne quitte JAMAIS ce processus Node — ni dans les URLs, ni dans les
 * réponses JSON, ni dans les noms de fichiers sur disque.
 *
 * ENDPOINTS :
 *   GET  /levels                        → niveaux audio  (clés = tokens)
 *   GET  /status                        → état du bot
 *   GET  /bot-info                      → info bot connecté
 *   POST /bot-token                     → valider + sauvegarder le token Discord
 *   GET  /images/{token}/{state}/{file} → image uploadée
 *   GET  /frames/{token}                → frames par état
 *   GET  /user-config/{token}           → config audio d'un user
 *   POST /user-config/{token}           → sauvegarder config audio
 *   GET  /known-users                   → liste users (token + displayName)
 *   POST /upload                        → upload image (champ "token")
 *   POST /reorder                       → réordonner frames
 *   POST /delete-frame                  → supprimer une frame
 *   POST /delete-user/{token}           → supprimer toutes les données d'un user
 *
 * PERMISSIONS :
 *   GET  /api/permissions               → liste permissions (admin)
 *   POST /api/permissions               → ajouter/modifier permission (admin)
 *   DELETE /api/permissions/:discordId  → supprimer permission (admin)
 *   GET  /api/permissions/me            → mes permissions (auth)
 *   GET  /api/my-token                  → mon token opaque (auth)
 *
 * VOICE BROWSER API :
 *   GET  /api/guilds                    → liste des serveurs Discord (admin)
 *   GET  /api/guilds/:guildId/channels  → canaux vocaux d'un serveur (admin)
 *   GET  /api/guilds/:guildId/members   → membres d'un serveur (admin)
 *   POST /api/voice/join                → rejoindre un canal vocal (admin)
 *   POST /api/voice/disconnect          → quitter le canal vocal (admin)
 *   GET  /api/voice/status              → état connexion vocale (auth)
 *
 * AUTH :
 *   GET  /auth/login                    → redirection OAuth2 Discord
 *   GET  /auth/callback                 → callback OAuth2
 *   GET  /auth/logout                   → déconnexion session
 *   GET  /auth/me                       → info session courante
 *
 * ENV : DISCORD_TOKEN, USER_HASH_SECRET (auto-généré), LEVELS_PORT (défaut 3000),
 *       SESSION_SECRET (auto-généré), DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET,
 *       DISCORD_REDIRECT_URI, ADMIN_DISCORD_ID, CORS_ORIGINS, DATA_ROOT
 */

import { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import {
    joinVoiceChannel,
    EndBehaviorType,
    getVoiceConnection,
    VoiceConnectionStatus,
    entersState,
    generateDependencyReport,
} from "@discordjs/voice";
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import prism from "prism-media";
import dotenv from "dotenv";
import fftPkg from "fft-js";
import { exec, spawn } from "child_process";
import { WebSocketServer } from "ws";
import sharp from "sharp";

// ── Imports depuis src/ ──────────────────────────────────────────
import { rateLimit } from './src/services/rateLimiter.js';
import { tokenFor, uidFor } from './src/services/tokenService.js';
import { TIER_LIMITS, getUserTier, loadTier, requirePremium } from './src/services/tierService.js';
import {
    sessions, oauthStates, AUTH_ENABLED,
    parseCookies, getSession, createSession, setSessionCookie, getUserRole,
    resolveAuth,
} from './src/services/authService.js';
import { userLevels, userFreqHistory, userBaseline, recordingSessions, AUDIO } from './src/services/audioService.js';
import { saveVoiceState, loadVoiceState, getAutoReconnect, setAutoReconnect } from './src/services/voiceService.js';
import { db } from './src/db/database.js';
import { users as usersRepo, frames as framesRepo } from './src/db/repos/users.js';
import { permissions as permissionsRepo, avatarPerms as avatarPermsRepo } from './src/db/repos/permissions.js';
import { subscriptions as subscriptionsRepo, seats as seatsRepo } from './src/db/repos/subscriptions.js';
import { psessions, participants, invitations as invitationsRepo } from './src/db/repos/sessions.js';
import { appTokens as appTokensRepo, notifications as notificationsRepo } from './src/db/repos/appTokens.js';
import { BASE_URL, getAllowedOrigins, corsHeaders, securityHeaders } from './src/http/cors.js';
import { json, serveFile, readBody, parseJsonBody, escapeHtml, MAX_BODY_SIZE } from './src/http/helpers.js';
import { route, matchRoute } from './src/http/router.js';
import { requireAuth, requireAdmin, requireClientOrAdmin } from './src/http/middleware.js';

const { fft, util: fftUtil } = fftPkg;
const SOURCE_ROOT = process.cwd();
const STATIC_ROOT = SOURCE_ROOT;
const DATA_ROOT = process.env.DATA_ROOT || SOURCE_ROOT;

// ── Validation magic bytes pour images ──────────────────────────
// POURQUOI LES MAGIC BYTES ?
// L'extension d'un fichier (.png, .jpg) n'est pas fiable — un attaquant peut
// renommer un fichier .exe en .png pour tromper le serveur.
// Les "magic bytes" sont les premiers octets du fichier, définis par le format
// lui-même et indépendants du nom. Ex: tout fichier PNG commence par 0x89504E47.
// NOTE : cette vérification est une garde secondaire. La vraie sanitisation
// est le re-encodage via sharp() qui reconstruit l'image de zéro.
const IMAGE_SIGNATURES = {
    '.png':  [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
    '.jpg':  [Buffer.from([0xFF, 0xD8, 0xFF])],
    '.jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
    '.gif':  [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
    '.webp': [Buffer.from('RIFF')], // + WEBP à offset 8
};
function validateMagicBytes(buffer, ext) {
    const sigs = IMAGE_SIGNATURES[ext];
    if (!sigs) return false;
    for (const sig of sigs) {
        if (buffer.length >= sig.length && buffer.subarray(0, sig.length).equals(sig)) {
            // Vérification supplémentaire WebP: "WEBP" à offset 8
            if (ext === '.webp') return buffer.length >= 12 && buffer.subarray(8, 12).equals(Buffer.from('WEBP'));
            return true;
        }
    }
    return false;
}

// ── Validation stateKey / noms de fichier ───────────────────────
// POURQUOI CES REGEX ?
// Protection contre les attaques de "path traversal" (traversée de répertoire).
// Sans validation, un attaquant pourrait envoyer stateKey = "../../etc/passwd"
// pour lire ou écraser des fichiers système. On autorise uniquement les
// caractères alphanumériques, tirets et underscores — rien qui puisse former
// un chemin relatif. La validation est complétée par path.resolve() + startsWith()
// plus bas pour une double protection.
const SAFE_STATE_KEY = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_FILENAME = /^[a-zA-Z0-9._-]{1,255}$/;

// ── Trusted proxy — ne lire X-Forwarded-For que si un reverse proxy est configuré ──
// POURQUOI TRUST_PROXY ?
// Derrière un reverse proxy (Nginx, Traefik, Pangolin…) l'IP visible par Node
// est toujours l'IP du proxy (ex: 127.0.0.1), pas celle du client réel.
// Le proxy transmet la vraie IP dans l'en-tête "X-Forwarded-For".
// DANGER : si on lit cet en-tête sans vérification, n'importe quel client peut
// forger "X-Forwarded-For: 1.2.3.4" pour usurper une IP et contourner le rate limit.
// Solution : n'activer la lecture de X-Forwarded-For que si TRUST_PROXY=true,
// c'est-à-dire quand on sait qu'un proxy de confiance est en frontal.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

function getClientIp(req) {
    if (TRUST_PROXY) {
        const xff = req.headers['x-forwarded-for'];
        // X-Forwarded-For peut contenir plusieurs IPs séparées par des virgules
        // (chaîne de proxies). On prend la première, qui est le client original.
        if (xff) return xff.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

// rateLimit() importé depuis src/services/rateLimiter.js
const IMAGES_DIR = path.join(DATA_ROOT, "images");
const META_DIR = path.join(DATA_ROOT, "meta");
const ENV_PATH = path.join(DATA_ROOT, ".env");

if (!fs.existsSync(DATA_ROOT)) fs.mkdirSync(DATA_ROOT, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

// saveVoiceState, loadVoiceState, getAutoReconnect, setAutoReconnect importés depuis src/services/voiceService.js

// ── Mode suivi (follow) — le bot suit un utilisateur entre les canaux vocaux ──
let followTarget = null; // { discordId, requestedBy, displayName }
let followError = null; // { channelName, userName, ts } — erreur de suivi récente

// ── Aliases stmts → repos src/ ──────────────────────────────────
// db, repos et schema sont initialisés par src/db/database.js et ses repos.
// On crée des aliases compatibles avec le code existant de index.js.
const stmts = {
    getUser:             usersRepo.get,
    upsertUser:          usersRepo.upsert,
    getUserConfig:       usersRepo.getConfig,
    setUserConfig:       usersRepo.setConfig,
    getFrames:           framesRepo.byToken,
    getFramesByState:    framesRepo.byState,
    insertFrame:         framesRepo.insert,
    deleteFrame:         framesRepo.delete,
    deleteUserFrames:    framesRepo.deleteAll,
    deleteUser:          db.prepare("DELETE FROM users WHERE token = ?"),
    updateFrameOrder:    framesRepo.updateOrder,
    maxSortOrder:        framesRepo.maxOrder,
    allUsers:            usersRepo.all,
    moveFrame:           framesRepo.move,
    // DB browser
    dbStats:             framesRepo.stats,
    dbAllFrames:         framesRepo.allForAdmin,
    // Permissions
    getPermission:       permissionsRepo.get,
    upsertPermission:    permissionsRepo.upsert,
    deletePermission:    permissionsRepo.delete,
    allPermissions:      permissionsRepo.all,
    // Avatar permissions per server
    getAvatarPerms:      avatarPermsRepo.byToken,
    getAvatarPerm:       avatarPermsRepo.get,
    upsertAvatarPerm:    avatarPermsRepo.upsert,
    // ── Subscriptions ──
    getSubscription:     subscriptionsRepo.get,
    getSubscriptionById: subscriptionsRepo.getById,
    upsertSubscription:  subscriptionsRepo.upsert,
    cancelSubscription:  subscriptionsRepo.cancel,
    expireSubscriptions: subscriptionsRepo.expire,
    // ── Seats ──
    getSeatByUser:       seatsRepo.byUser,
    getSeatsBySub:       seatsRepo.bySub,
    countSeatsBySub:     seatsRepo.count,
    addSeat:             seatsRepo.add,
    removeSeat:          seatsRepo.remove,
    // ── Sessions PNGTuber ──
    createPSession:      psessions.create,
    getPSession:         psessions.get,
    endPSession:         psessions.end,
    getActiveVoiceSession: psessions.activeVoice,
    getUserPSessions:    psessions.byUser,
    // ── Participants ──
    addParticipant:      participants.add,
    removeParticipant:   participants.remove,
    getParticipants:     participants.list,
    isParticipant:       participants.check,
    // ── Invitations ──
    createInvitation:    invitationsRepo.create,
    getInvitation:       invitationsRepo.get,
    updateInvitationStatus: invitationsRepo.updateStatus,
    incrementInviteUse:  invitationsRepo.incrementUse,
    getPendingInvitations: invitationsRepo.pending,
    getSessionInvitations: invitationsRepo.bySession,
    // ── App Tokens ──
    createAppToken:      appTokensRepo.create,
    getAppToken:         appTokensRepo.get,
    getAppTokensByUser:  appTokensRepo.byUser,
    revokeAppToken:      appTokensRepo.revoke,
    touchAppToken:       appTokensRepo.touch,
    deleteAppTokensByUser: appTokensRepo.revokeAll,
    // ── Notifications ──
    createNotification:  notificationsRepo.create,
    getNotifications:    notificationsRepo.list,
    getUnreadNotifications: notificationsRepo.unread,
    countUnreadNotifs:   notificationsRepo.countUnread,
    markNotifRead:       notificationsRepo.markRead,
    markAllNotifsRead:   notificationsRepo.markAllRead,
};

// ════════════════════════════════════════════════════════════════
// .ENV — généré automatiquement au premier lancement si absent
// ════════════════════════════════════════════════════════════════
function readEnvFile() {
    try {
        return fs.readFileSync(ENV_PATH, "utf-8");
    } catch {
        return "";
    }
}
function writeEnvFile(content) {
    fs.writeFileSync(ENV_PATH, content, "utf-8");
}

function ensureEnvKey(key, value) {
    // Idempotent: cette fonction peut être appelée à chaque démarrage
    // sans dupliquer la clé dans le fichier .env.
    let env = readEnvFile();
    if (new RegExp(`^${key}=`, "m").test(env)) return; // déjà présent
    env += (env.endsWith("\n") ? "" : "\n") + `${key}=${value}\n`;
    writeEnvFile(env);
    console.log(`✓ .env : ${key} généré`);
}

function setEnvKey(key, value) {
    let env = readEnvFile();
    if (new RegExp(`^${key}=`, "m").test(env)) {
        env = env.replace(new RegExp(`^${key}=.*`, "m"), `${key}=${value}`);
    } else {
        env += (env.endsWith("\n") ? "" : "\n") + `${key}=${value}\n`;
    }
    writeEnvFile(env);
}

// Créer .env avec valeurs par défaut si absent
if (!fs.existsSync(ENV_PATH)) {
    writeEnvFile(
        "# PNGTuber Bot — généré automatiquement\n# Ajoute DISCORD_TOKEN= après avoir configuré le bot via l'UI\n",
    );
    console.log("✓ .env créé");
}
ensureEnvKey("LEVELS_PORT", "3000");
ensureEnvKey("USER_HASH_SECRET", crypto.randomBytes(32).toString("hex"));
ensureEnvKey("SESSION_SECRET", crypto.randomBytes(32).toString("hex"));

dotenv.config({ path: ENV_PATH });

// tokenFor, uidFor importés depuis src/services/tokenService.js
// Compatibilité avec le code qui utilise tokenToUid/uidToToken directement
// (accès interne aux Maps du tokenService — partagées via le module singleton)
// Note: on accède aux maps via les fonctions exportées uniquement.
function hashUid(userId) {
    // Fallback interne — utilisé dans migrateExistingData et writeCfg
    return tokenFor(userId);
}

// Valide un token: en mémoire OU en base de données
function isKnownToken(token) {
    return !!uidFor(token) || !!stmts.getUser.get(token);
}
// Chemin dossier état par token (sans besoin du userId)
function stateDirByToken(token, sk) {
    return path.join(IMAGES_DIR, token, sk);
}

// AUDIO, userLevels importés depuis src/services/audioService.js
// Viewer sessions: sessionId → { userToken, createdAt } — persisté sur disque
const VIEWER_SESSIONS_PATH = path.join(DATA_ROOT, "viewer-sessions.json");
const viewerSessions = new Map();
function loadViewerSessions() {
    try {
        if (fs.existsSync(VIEWER_SESSIONS_PATH)) {
            const data = JSON.parse(fs.readFileSync(VIEWER_SESSIONS_PATH, "utf8"));
            const now = Date.now();
            for (const [sid, s] of Object.entries(data)) {
                // Ne pas charger les sessions expirées (>30 jours)
                if (now - s.createdAt < 30 * 86400000) viewerSessions.set(sid, s);
            }
        }
    } catch {}
}
function saveViewerSessions() {
    try {
        const obj = Object.fromEntries(viewerSessions);
        fs.writeFileSync(VIEWER_SESSIONS_PATH, JSON.stringify(obj), "utf8");
    } catch {}
}
loadViewerSessions();
let botConnected = false,
    currentConnection = null,
    connectedGuildId = null,
    connectedChannelId = null;
let tokenRejected = false;
const PORT = process.env.LEVELS_PORT || 3000;
let httpServer = null;
let isShuttingDown = false;

// ════════════════════════════════════════════════════════════════
// UTILITAIRES HTTP
// ════════════════════════════════════════════════════════════════
// BASE_URL, getAllowedOrigins, corsHeaders, securityHeaders importés depuis src/http/cors.js
// json, serveFile, readBody, parseJsonBody, escapeHtml, MAX_BODY_SIZE importés depuis src/http/helpers.js
// MIME importé indirectement (disponible via src/http/helpers.js)

function openDefaultBrowser(url) {
    if (process.env.PNGTUBER_NO_BROWSER === "1") return;
    // Utiliser spawn avec tableau d'arguments (pas de shell injection possible)
    let cmd, args;
    if (process.platform === "win32") {
        cmd = "cmd"; args = ["/c", "start", "", url];
    } else if (process.platform === "darwin") {
        cmd = "open"; args = [url];
    } else {
        cmd = "xdg-open"; args = [url];
    }
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref();
    child.on("error", (err) => {
        console.warn(`⚠ Impossible d'ouvrir automatiquement le navigateur: ${err.message}`);
    });
}

// ════════════════════════════════════════════════════════════════
// FICHIERS & DB — nommés par hash, jamais par userId
// ════════════════════════════════════════════════════════════════
function stateDir(userId, sk) {
    return path.join(IMAGES_DIR, hashUid(userId), sk);
}

function readCfg(userId) {
    const token = hashUid(userId);
    const row = stmts.getUserConfig.get(token);
    if (!row) return null;
    try { return JSON.parse(row.config_json); }
    catch { return null; }
}

function writeCfg(userId, c) {
    const token = hashUid(userId);
    stmts.upsertUser.run(token, c.displayName || "???", JSON.stringify(c));
}

// ════════════════════════════════════════════════════════════════
// PERMISSIONS — rôles utilisateur (admin / client / viewer) via SQLite
// ════════════════════════════════════════════════════════════════
function loadPermissions() {
    const rows = stmts.allPermissions.all();
    const users = {};
    for (const r of rows) {
        users[r.discord_id] = {
            role: r.role,
            grantedBy: r.granted_by,
            grantedAt: r.granted_at,
            displayName: r.display_name,
            guilds: JSON.parse(r.guilds_json || "[]"),
        };
    }
    return { version: 1, users };
}

// getUserRole importé depuis src/services/authService.js

function getFrames(userId) {
    const token = tokenFor(userId);
    return getFramesByToken(token);
}
function getFramesByToken(token) {
    const rows = stmts.getFrames.all(token);
    const result = {};
    for (const row of rows) {
        if (!result[row.state_key]) result[row.state_key] = [];
        result[row.state_key].push({
            file: row.filename,
            url: `/images/${token}/${row.state_key}/${row.filename}`,
        });
    }
    return result;
}

// ════════════════════════════════════════════════════════════════
// VALIDATION CONFIG UTILISATEUR
// ════════════════════════════════════════════════════════════════
const ALLOWED_CONFIG_KEYS = ['displayName', 'thresholds', 'emotionHoldMs', 'frameSpeed', 'emotions', 'blinkSettings', 'calibration', 'emotionFingerprints', 'emotionHotkeys'];

function validateUserConfig(cfg) {
    if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) return false;
    for (const key of Object.keys(cfg)) {
        if (!ALLOWED_CONFIG_KEYS.includes(key)) return false;
    }
    if (cfg.displayName !== undefined && typeof cfg.displayName !== 'string') return false;
    if (cfg.emotionHoldMs !== undefined && typeof cfg.emotionHoldMs !== 'number') return false;
    if (cfg.frameSpeed !== undefined && typeof cfg.frameSpeed !== 'number') return false;
    if (cfg.thresholds !== undefined && !Array.isArray(cfg.thresholds)) return false;
    if (cfg.emotions !== undefined && !Array.isArray(cfg.emotions)) return false;
    if (cfg.blinkSettings !== undefined) {
        if (typeof cfg.blinkSettings !== 'object' || Array.isArray(cfg.blinkSettings)) return false;
        for (const setting of Object.values(cfg.blinkSettings)) {
            if (typeof setting !== 'object') return false;
            if (setting.mode && !['blink', 'transition'].includes(setting.mode)) return false;
            // Ancien format (rétrocompat)
            if (setting.interval !== undefined && (typeof setting.interval !== 'number' || setting.interval < 500)) return false;
            if (setting.duration !== undefined && (typeof setting.duration !== 'number' || setting.duration < 50)) return false;
            // Nouveau format min/max
            for (const k of ['intervalMin', 'intervalMax']) {
                if (setting[k] !== undefined && (typeof setting[k] !== 'number' || setting[k] < 200)) return false;
            }
            for (const k of ['durationMin', 'durationMax']) {
                if (setting[k] !== undefined && (typeof setting[k] !== 'number' || setting[k] < 50)) return false;
            }
        }
    }
    // Validation emotionHotkeys
    if (cfg.emotionHotkeys !== undefined) {
        if (!Array.isArray(cfg.emotionHotkeys)) return false;
        for (const h of cfg.emotionHotkeys) {
            if (typeof h !== 'object' || !h) return false;
            if (typeof h.code !== 'string' || typeof h.emotion !== 'string') return false;
            if (h.mode && h.mode !== 'toggle' && h.mode !== 'hold') return false;
        }
    }
    // Validation emotionFingerprints
    if (cfg.emotionFingerprints !== undefined) {
        if (typeof cfg.emotionFingerprints !== 'object' || cfg.emotionFingerprints === null || Array.isArray(cfg.emotionFingerprints)) return false;
        for (const fp of Object.values(cfg.emotionFingerprints)) {
            if (typeof fp !== 'object' || fp === null) return false;
            for (const val of Object.values(fp)) {
                if (typeof val !== 'object' || val === null) return false;
                if (typeof val.mean !== 'number' || typeof val.std !== 'number') return false;
            }
        }
    }
    // Validation calibration
    if (cfg.calibration !== undefined) {
        const cal = cfg.calibration;
        if (typeof cal !== 'object' || cal === null || Array.isArray(cal)) return false;
        for (const k of ['dbMean', 'dbStd', 'sampleCount']) {
            if (cal[k] !== undefined && typeof cal[k] !== 'number') return false;
        }
        for (const k of ['freqMean', 'freqStd']) {
            if (cal[k] !== undefined) {
                if (typeof cal[k] !== 'object' || cal[k] === null) return false;
                for (const band of ['low', 'mid', 'high']) {
                    if (cal[k][band] !== undefined && typeof cal[k][band] !== 'number') return false;
                }
            }
        }
    }
    return true;
}

// TIER_LIMITS, getUserTier, loadTier, requirePremium importés depuis src/services/tierService.js

// ════════════════════════════════════════════════════════════════
// MULTIPART PARSER
// ════════════════════════════════════════════════════════════════
// Les uploads de fichiers utilisent le format "multipart/form-data".
// Ce format encapsule plusieurs "parts" (champs texte + fichiers) dans un
// même corps HTTP, séparées par un "boundary" (séparateur unique).
//
// Structure d'une requête multipart :
//   --<boundary>\r\n
//   Content-Disposition: form-data; name="token"\r\n
//   \r\n
//   abc123\r\n
//   --<boundary>\r\n
//   Content-Disposition: form-data; name="image"; filename="avatar.png"\r\n
//   Content-Type: image/png\r\n
//   \r\n
//   <octets binaires de l'image>\r\n
//   --<boundary>--\r\n    ← fin du body
//
// On n'utilise pas de bibliothèque externe (busboy, formidable) pour garder
// zéro dépendance supplémentaire. Ce parser minimal suffit pour le cas simple
// d'un formulaire avec exactement un token + une image.
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
    // Parser multipart minimaliste (sans dépendance externe).
    // Suffisant ici car on ne gère qu'un formulaire simple (token, stateKey, image).
    const parts = [],
        sep = Buffer.from(`--${boundary}`);
    let offset = 0;
    while (offset < body.length) {
        const start = indexOf(body, sep, offset);
        if (start === -1) break;
        offset = start + sep.length;
        if (body[offset] === 45 && body[offset + 1] === 45) break;
        if (body[offset] === 13) offset += 2;
        const he = indexOf(body, Buffer.from("\r\n\r\n"), offset);
        if (he === -1) break;
        const hs = body.slice(offset, he).toString();
        offset = he + 4;
        const ns = indexOf(body, sep, offset),
            de = ns === -1 ? body.length : ns - 2,
            data = body.slice(offset, de);
        offset = ns === -1 ? body.length : ns;
        parts.push({
            name: hs.match(/name="([^"]+)"/)?.[1] || "",
            filename: hs.match(/filename="([^"]+)"/)?.[1] || "",
            contentType: hs.match(/Content-Type:\s*(.+)/i)?.[1]?.trim() || "",
            data,
        });
    }
    return parts;
}

// ════════════════════════════════════════════════════════════════
// SESSIONS & AUTHENTIFICATION OAuth2 Discord
// ════════════════════════════════════════════════════════════════
// sessions, oauthStates, AUTH_ENABLED, parseCookies, getSession,
// createSession, setSessionCookie, getUserRole importés depuis src/services/authService.js
// requireAuth, requireAdmin, requireClientOrAdmin importés depuis src/http/middleware.js

const deviceAuthRequests = new Map(); // deviceCode → { userCode, discordId?, status, deviceName, expiresAt, appToken? }

// Nettoyage périodique des device auth requests + DB (sessions/auth nettoyées par authService.js)
setInterval(() => {
    // Nettoyage device auth requests expirés
    const now = Date.now();
    for (const [k, v] of deviceAuthRequests) {
        if (now > v.expiresAt) deviceAuthRequests.delete(k);
    }
    // Nettoyage DB périodique (subscriptions expirées, invitations, notifications)
    try {
        stmts.expireSubscriptions.run();
        db.prepare("UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')").run();
        db.prepare("DELETE FROM notifications WHERE created_at < datetime('now', '-30 days')").run();
    } catch {}
}, 60_000);

// Compatibilité: getUserRole disponible via authService
// verifyCookie utilisé dans handleAuthLogout — accès via parseCookies + sessions Map
function verifyCookie(signed) {
    // Ré-implémentation locale pour handleAuthLogout qui en a besoin directement
    const idx = signed.lastIndexOf('.');
    if (idx === -1) return null;
    const value = signed.slice(0, idx);
    const sig = signed.slice(idx + 1);
    const SESSION_SECRET = process.env.SESSION_SECRET;
    if (!SESSION_SECRET) return null;
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
    if (sig.length !== expected.length) return null;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? value : null;
}

async function parseBodyToken(req, res, ctx) {
    if ((req.headers['content-type'] || '').includes('multipart')) return true;
    try {
        const body = await readBody(req);
        ctx._rawBody = body;
        const parsed = JSON.parse(body.toString());
        ctx._parsedBody = parsed;
        ctx._bodyToken = parsed.token;
    } catch {}
    return true;
}

// ════════════════════════════════════════════════════════════════
// MIGRATION — JSON + fichiers existants → SQLite + WebP
// ════════════════════════════════════════════════════════════════
function migrateExistingData() {
    console.log("Verification migration donnees existantes...");

    // 1. Migrer permissions.json → table permissions
    const permsPath = path.join(META_DIR, "permissions.json");
    if (fs.existsSync(permsPath)) {
        try {
            const perms = JSON.parse(fs.readFileSync(permsPath, "utf-8"));
            const insertPerm = db.transaction(() => {
                for (const [discordId, p] of Object.entries(perms.users || {})) {
                    stmts.upsertPermission.run(
                        discordId, p.role || "viewer", p.grantedBy || null,
                        p.displayName || "Unknown", JSON.stringify(p.guilds || [])
                    );
                }
            });
            insertPerm();
            fs.renameSync(permsPath, permsPath + ".migrated");
            console.log("  Permissions migrees vers SQLite");
        } catch (err) {
            console.warn("  Erreur migration permissions:", err.message);
        }
    }

    // 1b. Migrer ADMIN_DISCORD_ID depuis .env vers la base de données
    if (process.env.ADMIN_DISCORD_ID) {
        const existing = stmts.getPermission.get(process.env.ADMIN_DISCORD_ID);
        if (!existing) {
            stmts.upsertPermission.run(
                process.env.ADMIN_DISCORD_ID, 'admin', 'system', 'Admin (env)', '[]'
            );
            console.log('  └─ Admin migré vers la base de données');
        } else if (existing.role !== 'admin') {
            stmts.upsertPermission.run(
                process.env.ADMIN_DISCORD_ID, 'admin', 'system', existing.display_name || 'Admin (env)', existing.guilds || '[]'
            );
            console.log('  └─ Admin promu dans la base de données');
        }
    }

    // 2. Migrer meta/<hash>_config.json → table users
    if (!fs.existsSync(META_DIR)) return;
    const configFiles = fs.readdirSync(META_DIR).filter(f => f.endsWith("_config.json"));
    for (const f of configFiles) {
        const token = f.replace("_config.json", "");
        if (stmts.getUser.get(token)) continue;
        try {
            const cfg = JSON.parse(fs.readFileSync(path.join(META_DIR, f), "utf-8"));
            stmts.upsertUser.run(token, cfg.displayName || "???", JSON.stringify(cfg));
            fs.renameSync(path.join(META_DIR, f), path.join(META_DIR, f + ".migrated"));
            console.log(`  User config migree: ${token}`);
        } catch (err) {
            console.warn(`  Erreur migration config ${token}:`, err.message);
        }
    }

    // 3. Migrer meta/<hash>.json (ordre frames) → table frames
    const metaFiles = fs.readdirSync(META_DIR).filter(f =>
        f.endsWith(".json") && !f.includes("_config") && !f.includes("permissions") && !f.includes(".migrated")
    );
    for (const f of metaFiles) {
        const token = f.replace(".json", "");
        const existingFrames = stmts.getFrames.all(token);
        if (existingFrames.length > 0) continue;
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(META_DIR, f), "utf-8"));
            const imgDir = path.join(IMAGES_DIR, token);
            if (!fs.existsSync(imgDir)) continue;
            const migrateFrames = db.transaction(() => {
                for (const [stateKey, order] of Object.entries(meta)) {
                    const sd = path.join(imgDir, stateKey);
                    if (!fs.existsSync(sd)) continue;
                    const existing = fs.readdirSync(sd).filter(fn => MIME[path.extname(fn).toLowerCase()]);
                    const ordered = order.filter(fn => existing.includes(fn));
                    const unordered = existing.filter(fn => !ordered.includes(fn));
                    const allFiles = [...ordered, ...unordered];
                    for (let i = 0; i < allFiles.length; i++) {
                        const fn = allFiles[i];
                        const filePath = path.join(sd, fn);
                        const stat = fs.statSync(filePath);
                        const ext = path.extname(fn).toLowerCase();
                        stmts.insertFrame.run(token, stateKey, fn, i, ext, stat.size);
                    }
                }
            });
            migrateFrames();
            fs.renameSync(path.join(META_DIR, f), path.join(META_DIR, f + ".migrated"));
            console.log(`  Frames migrees: ${token}`);
        } catch (err) {
            console.warn(`  Erreur migration frames ${token}:`, err.message);
        }
    }

    // 4. Conversion WebP en arrière-plan
    convertExistingImagesToWebP().catch(err => {
        console.warn("Erreur conversion WebP:", err.message);
    });
}

async function convertExistingImagesToWebP() {
    const allFrames = db.prepare(
        "SELECT token, state_key, filename FROM frames WHERE filename NOT LIKE '%.webp' AND filename NOT LIKE '%.svg'"
    ).all();
    if (allFrames.length === 0) return;
    console.log(`Conversion WebP: ${allFrames.length} images a convertir...`);
    let converted = 0, errors = 0;
    for (const frame of allFrames) {
        const sd = path.join(IMAGES_DIR, frame.token, frame.state_key);
        const oldPath = path.join(sd, frame.filename);
        if (!fs.existsSync(oldPath)) continue;
        try {
            const ext = path.extname(frame.filename).toLowerCase();
            const isGif = ext === ".gif";
            const inputBuffer = fs.readFileSync(oldPath);
            const webpBuffer = await sharp(inputBuffer, isGif ? { animated: true } : {})
                .webp({ quality: 85 })
                .toBuffer();
            const baseName = path.basename(frame.filename, ext);
            const newFilename = baseName + ".webp";
            const newPath = path.join(sd, newFilename);
            fs.writeFileSync(newPath, webpBuffer);
            db.prepare(
                "UPDATE frames SET filename = ?, file_size = ?, original_ext = ? WHERE token = ? AND state_key = ? AND filename = ?"
            ).run(newFilename, webpBuffer.length, ext, frame.token, frame.state_key, frame.filename);
            fs.unlinkSync(oldPath);
            converted++;
        } catch (err) {
            errors++;
            console.warn(`  Erreur conversion ${frame.filename}: ${err.message}`);
        }
    }
    console.log(`Conversion WebP terminee: ${converted} converties, ${errors} erreurs`);
}

// Lancer la migration au démarrage
migrateExistingData();

// ════════════════════════════════════════════════════════════════
// DÉCONNEXION VOCALE & SHUTDOWN PROPRE
// ════════════════════════════════════════════════════════════════
function disconnectVoice() {
    if (currentConnection) {
        currentConnection.destroy();
        currentConnection = null;
    }
    connectedGuildId = null;
    connectedChannelId = null;
    userLevels.clear();
    saveVoiceState();
    console.log("🔇 Déconnecté du canal vocal");
}

function shutdownApp() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\n🛑 Fermeture de l'application...");

    // Nettoyer la connexion vocale
    if (currentConnection) {
        currentConnection.destroy();
        currentConnection = null;
    }
    connectedGuildId = null;
    connectedChannelId = null;
    userLevels.clear();

    // Fermer la base de données
    try { db.close(); } catch {}

    // Fermer le serveur HTTP
    if (httpServer) {
        httpServer.close(() => {
            console.log("✓ Serveur HTTP fermé");
            console.log("✓ Port libéré");
            process.exit(0);
        });
        // Force exit après 2 secondes si le serveur ne se ferme pas
        setTimeout(() => {
            console.log("⚠ Fermeture forcée");
            process.exit(0);
        }, 2000);
    } else {
        process.exit(0);
    }
}

// ════════════════════════════════════════════════════════════════
// MINI-ROUTEUR & HANDLERS
// ════════════════════════════════════════════════════════════════
// route(), matchRoute() importés depuis src/http/router.js

// ── Route handlers ──────────────────────────────────────────────

// GET /levels — tokens opaques comme clés, aucun userId
// Cache 50ms pour éviter de reconstruire le JSON à chaque requête
let levelsCache = { json: null, ts: 0 };
async function handleLevels(req, res, ctx) {
    const now = Date.now();
    if (levelsCache.json && now - levelsCache.ts < 50) {
        return json(res, JSON.parse(levelsCache.json), 200, req);
    }
    // Contrat API: _bot contient l'état global, les autres clés sont des tokens user.
    // Important: jamais d'userId Discord en sortie HTTP.
    const guild = connectedGuildId ? client.guilds.cache.get(connectedGuildId) : null;
    const channel = connectedChannelId && guild ? guild.channels.cache.get(connectedChannelId) : null;
    const p = { _bot: {
        connected: botConnected,
        inVoice: !!currentConnection,
        channelName: channel?.name || null,
        guildName: guild?.name || null,
        updatedAt: new Date().toISOString()
    } };
    for (const [uid, d] of userLevels) {
        const tk = tokenFor(uid);
        const bl = userBaseline.get(uid);
        p[tk] = {
            db: d.db, rms: d.rms, freq: d.freq,
            freqDelta: d.freqDelta || { low: 0, mid: 0, high: 0 },
            zcr: d.zcr || 0, centroid: d.centroid || 0, energyVar: d.energyVar || 0,
            detectedEmotion: manualEmotion.get(tk)?.emotion || d.detectedEmotion || null,
            state: smoothAndClassifyState(tk, d.db),
            speaking: d.speaking, displayName: d.displayName, updated: d.updated,
            baseline: bl ? {
                dbMean: Math.round(bl.dbMean * 100) / 100,
                dbStd: Math.round(bl.dbStd * 100) / 100,
                freqMean: {
                    low: Math.round(bl.freqMean.low * 1000) / 1000,
                    mid: Math.round(bl.freqMean.mid * 1000) / 1000,
                    high: Math.round(bl.freqMean.high * 1000) / 1000,
                },
                freqStd: {
                    low: Math.round(bl.freqStd.low * 1000) / 1000,
                    mid: Math.round(bl.freqStd.mid * 1000) / 1000,
                    high: Math.round(bl.freqStd.high * 1000) / 1000,
                },
                sampleCount: bl.sampleCount,
            } : null,
        };
    }
    levelsCache = { json: JSON.stringify(p), ts: now };
    return json(res, p, 200, req);
}

// GET /status
async function handleStatus(req, res, ctx) {
    return json(res, { botConnected, usersActive: userLevels.size }, 200, req);
}

// GET /bot-info
async function handleBotInfo(req, res, ctx) {
    const hasToken = !!process.env.DISCORD_TOKEN;
    return json(res, {
        configured: hasToken,
        connected: botConnected,
        tokenInvalid: hasToken && !botConnected && tokenRejected,
        tag: botConnected ? client.user?.tag : null,
        id: botConnected ? client.user?.id : null,
    }, 200, req);
}

// POST /bot-token
async function handleBotToken(req, res, ctx) {
    try {
        const { token } = JSON.parse((await readBody(req)).toString());
        if (!token || token.trim().length < 50)
            return json(res, { ok: false, error: "Token trop court" }, 400, req);
        const vRes = await fetch(
            "https://discord.com/api/v10/users/@me",
            { headers: { Authorization: `Bot ${token.trim()}` } },
        );
        if (!vRes.ok) {
            const e = await vRes.json().catch(() => ({}));
            return json(res, { ok: false, error: `Rejeté: ${e.message || vRes.status}` }, 401, req);
        }
        const botUser = await vRes.json();
        setEnvKey("DISCORD_TOKEN", token.trim());
        console.log(`Token mis à jour → redémarrage...`);
        setTimeout(() => process.exit(0), 500);
        return json(res, { ok: true, tag: botUser.username }, 200, req);
    } catch (err) {
        console.error("Bot token error:", err);
        return json(res, { ok: false, error: "Erreur lors de la validation du token" }, 500, req);
    }
}

// GET /frames/:token
async function handleFrames(req, res, ctx) {
    const t = ctx.params.token;
    if (!uidFor(t) && !isKnownToken(t)) return json(res, { error: "token inconnu" }, 404, req);
    // Vérifier l'autorisation serveur si guild est spécifié
    const guildId = ctx.url.searchParams.get('guild');
    if (guildId && !isAvatarAllowed(t, guildId)) {
        return json(res, { error: "Avatar non autorisé sur ce serveur" }, 403, req);
    }
    return json(res, getFramesByToken(t), 200, req);
}

// GET /images/*
async function handleImages(req, res, ctx) {
    const parts = ctx.url.pathname.split("/");
    if (parts.length >= 5) {
        const tokenPart = parts[2];
        if (!uidFor(tokenPart) && !isKnownToken(tokenPart)) {
            res.writeHead(404);
            res.end("Not found");
            return;
        }
        // Valider les composants du chemin (empêcher path traversal via ..)
        const stateKey = parts[3];
        const fileName = parts.slice(4).join("/");
        if (!SAFE_STATE_KEY.test(stateKey) || !SAFE_FILENAME.test(fileName)) {
            res.writeHead(400);
            res.end("Bad request");
            return;
        }
        const fp = path.resolve(path.join(IMAGES_DIR, tokenPart, stateKey, fileName));
        if (!fp.startsWith(path.resolve(IMAGES_DIR))) {
            res.writeHead(403);
            res.end();
            return;
        }
        if (serveFile(res, fp, req)) return;
    }
    res.writeHead(404);
    res.end("Not found");
}

// GET /user-config/:token
async function handleGetUserConfig(req, res, ctx) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token)) return json(res, { error: "token inconnu" }, 404, req);
    const row = stmts.getUserConfig.get(token);
    return json(res, row ? JSON.parse(row.config_json || "{}") : {}, 200, req);
}

// POST /user-config/:token
async function handlePostUserConfig(req, res, ctx) {
    try {
        const token = ctx.params.token;
        if (!uidFor(token) && !isKnownToken(token)) return json(res, { error: "token inconnu" }, 404, req);
        const cfg = JSON.parse((await readBody(req)).toString());
        if (!validateUserConfig(cfg))
            return json(res, { error: "Configuration invalide" }, 400, req);
        // Enforcement tier : strip les fonctionnalités premium pour le tier free
        const tierLimits = ctx.tierLimits || TIER_LIMITS.free;
        if (!tierLimits.emotionsEnabled) {
            delete cfg.emotions;
            delete cfg.emotionFingerprints;
            delete cfg.emotionHotkeys;
        }
        if (!tierLimits.calibrationEnabled) {
            delete cfg.calibration;
        }
        stmts.upsertUser.run(token, cfg.displayName || "???", JSON.stringify(cfg));
        broadcastConfigUpdate(token);
        return json(res, { ok: true }, 200, req);
    } catch (err) {
        console.error("Config save error:", err);
        return json(res, { error: "Erreur lors de la sauvegarde" }, 500, req);
    }
}

// ── Calibration routes ─────────────────────────────────────────

// POST /calibration/:token/reset — réinitialise la baseline vocale
async function handleCalibrationReset(req, res, ctx) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: "token inconnu" }, 404, req);
    // Trouver le userId associé au token
    const uid = uidFor(token);
    if (uid) userBaseline.delete(uid);
    // Supprimer aussi la calibration persistée dans config
    const row = stmts.getUserConfig.get(token);
    if (row) {
        try {
            const cfg = JSON.parse(row.config_json || '{}');
            if (cfg.calibration) {
                delete cfg.calibration;
                stmts.upsertUser.run(token, cfg.displayName || '???', JSON.stringify(cfg));
            }
        } catch {}
    }
    return json(res, { ok: true }, 200, req);
}

// POST /calibration/:token/auto-thresholds — calcule les seuils optimaux
async function handleAutoThresholds(req, res, ctx) {
    const token = ctx.params.token;
    const uid = uidFor(token);
    if (!uid && !isKnownToken(token))
        return json(res, { error: "token inconnu" }, 404, req);
    const bl = uid ? userBaseline.get(uid) : null;
    if (!bl || bl.sampleCount < 100)
        return json(res, { error: "Calibration insuffisante", sampleCount: bl?.sampleCount || 0 }, 400, req);
    const mean = bl.dbMean;
    const std = Math.max(bl.dbStd, 2); // minimum 2 dB d'écart-type
    const thresholds = [
        { key: "low",    db: Math.round(mean - 1.5 * std), label: "Low",    color: "#4a90e2" },
        { key: "medium", db: Math.round(mean - 0.3 * std), label: "Medium", color: "#f0a500" },
        { key: "high",   db: Math.round(mean + 1.2 * std), label: "High",   color: "#e74c6c" },
    ];
    return json(res, { thresholds, baseline: { dbMean: Math.round(mean * 100) / 100, dbStd: Math.round(std * 100) / 100 } }, 200, req);
}

// POST /calibration/:token/auto-emotions — calcule les émotions basées sur la baseline
async function handleAutoEmotions(req, res, ctx) {
    const token = ctx.params.token;
    const uid = uidFor(token);
    if (!uid && !isKnownToken(token))
        return json(res, { error: "token inconnu" }, 404, req);
    const bl = uid ? userBaseline.get(uid) : null;
    if (!bl || bl.sampleCount < 100)
        return json(res, { error: "Calibration insuffisante", sampleCount: bl?.sampleCount || 0 }, 400, req);
    // Calculer des émotions adaptées à la baseline fréquentielle du user
    const emotions = [
        {
            key: "anger", label: "Anger", minStatus: "medium",
            freqMin: 20, freqMax: 400,
            sensitivity: 1.3,
            useBaseline: true, deviationDirection: "below",
            deviationThreshold: 1.5,
        },
        {
            key: "happy", label: "Happy", minStatus: "low",
            freqMin: 1500, freqMax: 6000,
            sensitivity: 1.3,
            useBaseline: true, deviationDirection: "above",
            deviationThreshold: 1.2,
        },
        {
            key: "scream", label: "Scream", minStatus: "high",
            freqMin: 800, freqMax: 4000,
            sensitivity: 1.5,
        },
    ];
    return json(res, {
        emotions,
        baseline: {
            freqMean: {
                low: Math.round(bl.freqMean.low * 1000) / 1000,
                mid: Math.round(bl.freqMean.mid * 1000) / 1000,
                high: Math.round(bl.freqMean.high * 1000) / 1000,
            },
            freqStd: {
                low: Math.round(bl.freqStd.low * 1000) / 1000,
                mid: Math.round(bl.freqStd.mid * 1000) / 1000,
                high: Math.round(bl.freqStd.high * 1000) / 1000,
            },
        },
    }, 200, req);
}

// ── Empreintes vocales — enregistrement + détection ────────────

function fpAvg(arr) { return arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0; }
function fpStd(arr) {
    if (arr.length < 2) return 0;
    const m = fpAvg(arr);
    return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / arr.length);
}

function computeFingerprint(samples) {
    const features = ['db', 'zcr', 'centroid', 'energyVar'];
    const freqBands = ['low', 'mid', 'high'];
    const fp = {};
    for (const f of features) {
        const vals = samples.map(s => s[f]).filter(v => typeof v === 'number');
        fp[f] = { mean: Math.round(fpAvg(vals) * 100) / 100, std: Math.round(fpStd(vals) * 100) / 100 };
    }
    for (const band of freqBands) {
        const vals = samples.map(s => s.freq?.[band]).filter(v => typeof v === 'number');
        fp['freq_' + band] = { mean: Math.round(fpAvg(vals) * 1000) / 1000, std: Math.round(fpStd(vals) * 1000) / 1000 };
    }
    return fp;
}

// Cache des fingerprints par token (évite lecture SQLite à chaque tick)
const fingerprintCache = new Map(); // token → { fingerprints, ts }
const FP_CACHE_TTL = 5000; // 5s

function getFingerprints(token) {
    const cached = fingerprintCache.get(token);
    if (cached && Date.now() - cached.ts < FP_CACHE_TTL) return cached.fingerprints;
    const row = stmts.getUserConfig.get(token);
    if (!row) { fingerprintCache.set(token, { fingerprints: null, ts: Date.now() }); return null; }
    let cfg;
    try { cfg = JSON.parse(row.config_json || '{}'); } catch { return null; }
    const fp = cfg.emotionFingerprints || null;
    fingerprintCache.set(token, { fingerprints: fp, ts: Date.now() });
    return fp;
}

// Invalider le cache quand on sauvegarde/supprime un fingerprint
function invalidateFingerprintCache(token) { fingerprintCache.delete(token); }

// ── Hystérésis d'émotion ──
// Évite les changements trop rapides d'émotion.
// Requiert N détections consécutives avant de changer, et maintient l'émotion
// pendant un hold après qu'elle cesse d'être détectée.
const emotionState = new Map(); // token → { current, candidate, confirmCount, holdUntil }
const EMOTION_CONFIRM_COUNT = 5;  // 5 × 50ms = 250ms avant de changer d'émotion
const EMOTION_HOLD_MS = 800;      // Maintenir l'émotion 800ms après la dernière détection

function stabilizeEmotion(token, rawEmotion) {
    const now = Date.now();
    let st = emotionState.get(token);
    if (!st) {
        st = { current: null, candidate: null, confirmCount: 0, holdUntil: 0 };
        emotionState.set(token, st);
    }

    if (rawEmotion) {
        if (rawEmotion === st.current) {
            // Même émotion que l'actuelle → prolonger le hold
            st.holdUntil = now + EMOTION_HOLD_MS;
            st.candidate = null;
            st.confirmCount = 0;
            return st.current;
        }
        // Nouvelle émotion différente → accumuler des confirmations
        if (rawEmotion === st.candidate) {
            st.confirmCount++;
        } else {
            st.candidate = rawEmotion;
            st.confirmCount = 1;
        }
        // Assez de confirmations → changer
        if (st.confirmCount >= EMOTION_CONFIRM_COUNT) {
            st.current = rawEmotion;
            st.holdUntil = now + EMOTION_HOLD_MS;
            st.candidate = null;
            st.confirmCount = 0;
            return st.current;
        }
        // Pas encore confirmé → garder l'émotion actuelle si dans le hold
        if (st.current && now < st.holdUntil) return st.current;
        return st.current; // garder l'actuelle même si hold expiré
    }

    // rawEmotion est null → plus d'émotion détectée
    st.candidate = null;
    st.confirmCount = 0;
    if (st.current && now < st.holdUntil) return st.current; // hold actif
    // Hold expiré → effacer l'émotion
    st.current = null;
    return null;
}

// ── Émotion manuelle (override via raccourcis clavier / agent local) ──
// Priorité sur la détection automatique par empreintes vocales.
const manualEmotion = new Map(); // token → { emotion, setAt }
const MANUAL_EMOTION_TIMEOUT_MS = 30 * 60 * 1000; // 30min sécurité

function setManualEmotion(token, emotion) {
    if (!emotion) {
        manualEmotion.delete(token);
        return null;
    }
    manualEmotion.set(token, { emotion, setAt: Date.now() });
    return emotion;
}

// ── Lissage d'état audio côté serveur ──
// Source unique de vérité : le serveur calcule l'état final (silent/low/med/high)
// pour que tous les clients affichent la même chose.
const stateSmooth = new Map(); // token → { smoothDb, lastState, stateHoldUntil }
const STATE_HOLD_MS = 400;

function smoothAndClassifyState(token, rawDb) {
    let sd = stateSmooth.get(token);
    if (!sd) {
        sd = { smoothDb: rawDb, lastState: 'silent', stateHoldUntil: 0 };
        stateSmooth.set(token, sd);
    }
    // Lissage exponentiel asymétrique : montée rapide, descente lente
    const alpha = rawDb > sd.smoothDb ? 0.4 : 0.12;
    sd.smoothDb += (rawDb - sd.smoothDb) * alpha;

    // Récupérer les seuils de l'utilisateur
    const uid = tokenToUid.get(token);
    const cfg = uid ? readCfg(uid) : null;
    const thresholds = cfg?.thresholds || [
        { key: 'low', db: -45 },
        { key: 'medium', db: -30 },
        { key: 'high', db: -15 },
    ];
    const sorted = [...thresholds].sort((a, b) => a.db - b.db);
    let status = 'silent';
    for (const t of sorted) {
        if (sd.smoothDb >= t.db) status = t.key;
    }

    // State hold : garder l'état supérieur pendant STATE_HOLD_MS
    const stateOrder = ['silent', ...sorted.map(t => t.key)];
    const now = Date.now();
    const newIdx = stateOrder.indexOf(status);
    const curIdx = stateOrder.indexOf(sd.lastState);

    if (newIdx >= curIdx) {
        sd.lastState = status;
        sd.stateHoldUntil = now + STATE_HOLD_MS;
    } else if (now < sd.stateHoldUntil) {
        status = sd.lastState;
    } else {
        sd.lastState = status;
    }
    return status;
}

// Détection d'émotion par comparaison aux empreintes enregistrées
function detectEmotionFromFingerprints(token, features) {
    const fingerprints = getFingerprints(token);
    if (!fingerprints || typeof fingerprints !== 'object') return stabilizeEmotion(token, null);

    let bestKey = null, bestDist = Infinity;
    for (const [key, fp] of Object.entries(fingerprints)) {
        let dist = 0, count = 0;
        for (const f of Object.keys(fp)) {
            let current;
            if (f.startsWith('freq_')) current = features.freq?.[f.slice(5)];
            else current = features[f];
            if (current === undefined || current === null) continue;
            const std = fp[f].std || 0.001;
            dist += ((current - fp[f].mean) / std) ** 2;
            count++;
        }
        dist = count > 0 ? Math.sqrt(dist / count) : Infinity;
        if (dist < bestDist) { bestDist = dist; bestKey = key; }
    }
    // Seuil : distance normalisée < 2.0 (2 écarts-types)
    const rawEmotion = bestDist < 2.0 ? bestKey : null;
    return stabilizeEmotion(token, rawEmotion);
}

// GET /api/emotion/:token — état de l'émotion manuelle
async function handleGetEmotion(req, res, ctx) {
    const token = ctx.params.token;
    const manual = manualEmotion.get(token);
    return json(res, { active: manual?.emotion || null }, 200, req);
}

// POST /api/emotion/:token — définir ou effacer l'émotion manuelle
async function handleSetEmotion(req, res, ctx) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: "token inconnu" }, 404, req);
    let body;
    try { body = await parseJsonBody(req); } catch { return json(res, { error: "JSON invalide" }, 400, req); }
    const emotion = typeof body.emotion === 'string' ? body.emotion : null;
    const active = setManualEmotion(token, emotion);
    return json(res, { ok: true, active }, 200, req);
}

// POST /calibration/:token/record-start — démarre l'enregistrement d'empreinte vocale
async function handleRecordStart(req, res, ctx) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: "token inconnu" }, 404, req);
    let durationMs = 5000;
    try {
        const body = await parseJsonBody(req);
        if (body.durationMs && typeof body.durationMs === 'number') durationMs = Math.min(Math.max(body.durationMs, 2000), 15000);
    } catch {}
    recordingSessions.set(token, { startedAt: Date.now(), durationMs, samples: [] });
    return json(res, { ok: true, durationMs }, 200, req);
}

// POST /calibration/:token/record-stop — arrête l'enregistrement et retourne l'empreinte
async function handleRecordStop(req, res, ctx) {
    const token = ctx.params.token;
    const session = recordingSessions.get(token);
    if (!session) return json(res, { error: "Aucune session d'enregistrement active" }, 400, req);
    recordingSessions.delete(token);
    if (session.samples.length < 10)
        return json(res, { error: "Pas assez d'échantillons", count: session.samples.length }, 400, req);
    const fingerprint = computeFingerprint(session.samples);
    return json(res, { ok: true, fingerprint, sampleCount: session.samples.length }, 200, req);
}

// POST /calibration/:token/save-fingerprint — sauvegarde une empreinte vocale
async function handleSaveFingerprint(req, res, ctx) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: "token inconnu" }, 404, req);
    let body;
    try { body = await parseJsonBody(req); } catch { return json(res, { error: "JSON invalide" }, 400, req); }
    const { emotionKey, fingerprint } = body;
    if (!emotionKey || typeof emotionKey !== 'string') return json(res, { error: "emotionKey requis" }, 400, req);
    if (!fingerprint || typeof fingerprint !== 'object') return json(res, { error: "fingerprint requis" }, 400, req);
    // Charger config existante
    const row = stmts.getUserConfig.get(token);
    const cfg = row ? JSON.parse(row.config_json || '{}') : {};
    if (!cfg.emotionFingerprints) cfg.emotionFingerprints = {};
    cfg.emotionFingerprints[emotionKey] = fingerprint;
    stmts.upsertUser.run(token, cfg.displayName || row?.display_name || '???', JSON.stringify(cfg));
    invalidateFingerprintCache(token);
    return json(res, { ok: true }, 200, req);
}

// DELETE /calibration/:token/fingerprint/:emotionKey — supprime une empreinte
async function handleDeleteFingerprint(req, res, ctx) {
    const token = ctx.params.token;
    const emotionKey = ctx.params.emotionKey;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: "token inconnu" }, 404, req);
    const row = stmts.getUserConfig.get(token);
    if (!row) return json(res, { error: "config introuvable" }, 404, req);
    const cfg = JSON.parse(row.config_json || '{}');
    if (cfg.emotionFingerprints) {
        delete cfg.emotionFingerprints[emotionKey];
        if (Object.keys(cfg.emotionFingerprints).length === 0) delete cfg.emotionFingerprints;
    }
    stmts.upsertUser.run(token, cfg.displayName || row.display_name || '???', JSON.stringify(cfg));
    invalidateFingerprintCache(token);
    return json(res, { ok: true }, 200, req);
}

// GET /known-users — token + displayName uniquement (via SQLite)
async function handleKnownUsers(req, res, ctx) {
    const users = [];
    // Users actifs en mémoire
    for (const [uid, token] of uidToToken) {
        const row = stmts.getUser.get(token);
        const cfg = row ? JSON.parse(row.config_json || "{}") : null;
        users.push({
            token,
            displayName: cfg?.displayName || row?.display_name || "???",
            hasConfig: !!row,
        });
    }
    // Users persistés en base (sessions précédentes)
    for (const row of stmts.allUsers.all()) {
        if (users.find((u) => u.token === row.token)) continue;
        users.push({
            token: row.token,
            displayName: row.display_name || "???",
            hasConfig: true,
            offline: true,
        });
    }
    return json(res, users, 200, req);
}

// POST /upload — champ "token" au lieu de "userId" — conversion WebP auto
async function handleUpload(req, res, ctx) {
    try {
        // Rate limit: 30 uploads par minute par IP
        const clientIp = getClientIp(req);
        if (rateLimit(`upload:${clientIp}`, 30, 60_000))
            return json(res, { error: "Trop de requêtes, réessayez dans une minute" }, 429, req);

        const body = await readBody(req, 50 * 1024 * 1024),
            ct = req.headers["content-type"] || "",
            bm = ct.match(/boundary=([^\s;]+)/);
        if (!bm) return json(res, { error: "boundary manquant" }, 400, req);
        const parts = parseMultipart(body, bm[1]),
            fields = {};
        for (const p of parts)
            if (!p.filename) fields[p.name] = p.data.toString();
        const imgPart = parts.find((p) => p.filename);
        const { token, stateKey } = fields;
        if ((!uidFor(token) && !isKnownToken(token)) || !stateKey || !imgPart)
            return json(res, { error: "token invalide, stateKey ou image manquant" }, 400, req);
        // Validation stateKey: caractères sûrs uniquement (empêche path traversal)
        if (!SAFE_STATE_KEY.test(stateKey))
            return json(res, { error: "stateKey invalide (caractères alphanumériques, _ et - uniquement)" }, 400, req);
        const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
        if (imgPart.data.length > MAX_IMAGE_SIZE)
            return json(res, { error: "Image trop volumineuse (max 10 Mo)" }, 413, req);
        const ext = path.extname(imgPart.filename).toLowerCase();
        // Formats acceptés: PNG, JPG, GIF, WebP uniquement (SVG interdit — vecteur XSS)
        const ALLOWED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        if (!ALLOWED_IMAGE_EXTS.includes(ext))
            return json(res, { error: "Format non supporté (PNG, JPG, GIF, WebP uniquement)" }, 400, req);
        // Validation magic bytes: vérifier que le contenu correspond à l'extension
        if (!validateMagicBytes(imgPart.data, ext))
            return json(res, { error: "Le contenu du fichier ne correspond pas au format déclaré" }, 400, req);

        // ── Enforcement tier : limites d'upload ──
        const limits = ctx.tierLimits || TIER_LIMITS.free;
        const isClosed = stateKey.endsWith('_closed');
        const existingStates = db.prepare("SELECT DISTINCT state_key FROM frames WHERE token = ?").all(token);
        const isNewState = !existingStates.some(s => s.state_key === stateKey);
        if (isNewState) {
            const openCount = existingStates.filter(s => !s.state_key.endsWith('_closed')).length;
            const closedCount = existingStates.filter(s => s.state_key.endsWith('_closed')).length;
            if (isClosed && closedCount >= limits.maxClosedStates)
                return json(res, { error: `Limite atteinte : ${limits.maxClosedStates} états fermés maximum`, tier: ctx.tier || 'free', upgrade: true }, 403, req);
            if (!isClosed && openCount >= limits.maxStates)
                return json(res, { error: `Limite atteinte : ${limits.maxStates} états maximum`, tier: ctx.tier || 'free', upgrade: true }, 403, req);
        }
        const framesInState = stmts.getFramesByState.all(token, stateKey);
        if (framesInState.length >= limits.maxFramesPerState)
            return json(res, { error: `Limite atteinte : ${limits.maxFramesPerState} frames par état`, tier: ctx.tier || 'free', upgrade: true }, 403, req);

        // Conversion sécurisée WebP via sharp (reprocessing = sanitisation)
        const isGif = ext === ".gif";
        let outputBuffer;
        try {
            outputBuffer = await sharp(imgPart.data, isGif ? { animated: true } : {})
                .webp({ quality: 85 })
                .toBuffer();
        } catch (sharpErr) {
            return json(res, { error: "Image invalide ou corrompue" }, 400, req);
        }
        const outputExt = ".webp";

        const dir = stateDirByToken(token, stateKey);
        // Vérification path traversal sur le répertoire cible
        const resolvedDir = path.resolve(dir);
        if (!resolvedDir.startsWith(path.resolve(IMAGES_DIR)))
            return json(res, { error: "Chemin invalide" }, 403, req);
        fs.mkdirSync(dir, { recursive: true });
        const baseName = path.basename(imgPart.filename, ext).replace(/[^a-zA-Z0-9._-]/g, "_");
        const fname = `${Date.now()}_${baseName}${outputExt}`;
        fs.writeFileSync(path.join(dir, fname), outputBuffer);

        // Insérer en base de données
        const maxOrder = stmts.maxSortOrder.get(token, stateKey).max_order;
        stmts.insertFrame.run(token, stateKey, fname, maxOrder + 1, ext, outputBuffer.length);
        // S'assurer que l'utilisateur existe en DB
        if (!stmts.getUser.get(token)) {
            stmts.upsertUser.run(token, "???", "{}");
        }

        broadcastFrameUpdate(token);
        return json(res, {
            ok: true,
            file: fname,
            url: `/images/${token}/${stateKey}/${fname}`,
        }, 200, req);
    } catch (err) {
        console.error("Upload error:", err);
        return json(res, { error: "Erreur lors de l'upload" }, 500, req);
    }
}

// POST /reorder  { token, stateKey, order:[] }
async function handleReorder(req, res, ctx) {
    try {
        const { token, stateKey, order } = ctx._parsedBody || JSON.parse(
            (await readBody(req)).toString(),
        );
        if ((!uidFor(token) && !isKnownToken(token)) || !stateKey || !Array.isArray(order))
            return json(res, { error: "params manquants" }, 400, req);
        const updateOrder = db.transaction((files) => {
            for (let i = 0; i < files.length; i++) {
                stmts.updateFrameOrder.run(i, token, stateKey, files[i]);
            }
        });
        updateOrder(order);
        return json(res, { ok: true }, 200, req);
    } catch (err) {
        console.error("Reorder error:", err);
        return json(res, { error: "Erreur lors du réordonnement" }, 500, req);
    }
}

// POST /delete-frame  { token, stateKey, file }
async function handleDeleteFrame(req, res, ctx) {
    try {
        const { token, stateKey, file } = ctx._parsedBody || JSON.parse(
            (await readBody(req)).toString(),
        );
        if ((!uidFor(token) && !isKnownToken(token)) || !stateKey || !file)
            return json(res, { error: "params manquants" }, 400, req);
        if (!SAFE_STATE_KEY.test(stateKey) || !SAFE_FILENAME.test(file))
            return json(res, { error: "Paramètres invalides" }, 400, req);
        const fp = path.resolve(path.join(IMAGES_DIR, token, stateKey, file));
        if (!fp.startsWith(path.resolve(IMAGES_DIR)))
            return json(res, { error: "Interdit" }, 403, req);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        stmts.deleteFrame.run(token, stateKey, file);
        broadcastFrameUpdate(token);
        return json(res, { ok: true }, 200, req);
    } catch (err) {
        console.error("Delete frame error:", err);
        return json(res, { error: "Erreur lors de la suppression" }, 500, req);
    }
}

// POST /move-frame  { token, file, fromState, toState }
async function handleMoveFrame(req, res, ctx) {
    try {
        const { token, file, fromState, toState } = ctx._parsedBody || JSON.parse(
            (await readBody(req)).toString(),
        );
        if (!token || !file || !fromState || !toState)
            return json(res, { error: "params manquants" }, 400, req);
        if (!SAFE_STATE_KEY.test(fromState) || !SAFE_STATE_KEY.test(toState) || !SAFE_FILENAME.test(file))
            return json(res, { error: "Paramètres invalides" }, 400, req);
        if (fromState === toState)
            return json(res, { ok: true }, 200, req);
        const srcPath = path.resolve(path.join(IMAGES_DIR, token, fromState, file));
        if (!srcPath.startsWith(path.resolve(IMAGES_DIR)))
            return json(res, { error: "Interdit" }, 403, req);
        // Single-frame mode: supprimer frames existantes dans toState
        const existing = stmts.getFramesByState.all(token, toState);
        for (const f of existing) {
            const p = path.join(IMAGES_DIR, token, toState, f.filename);
            if (fs.existsSync(p)) fs.unlinkSync(p);
            stmts.deleteFrame.run(token, toState, f.filename);
        }
        // Déplacer le fichier sur disque
        const destDir = path.join(IMAGES_DIR, token, toState);
        fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, file);
        if (fs.existsSync(srcPath)) fs.renameSync(srcPath, destPath);
        // Mettre à jour la DB
        stmts.moveFrame.run(toState, token, fromState, file);
        broadcastFrameUpdate(token);
        return json(res, { ok: true }, 200, req);
    } catch (err) {
        console.error("Move frame error:", err);
        return json(res, { error: "Erreur lors du déplacement" }, 500, req);
    }
}

// GET /api/db/stats — stats DB (admin only)
function handleDbStats(req, res) {
    const row = stmts.dbStats.get();
    return json(res, row, 200, req);
}

// GET /api/db/frames — toutes les frames (admin only)
function handleDbFrames(req, res) {
    const rows = stmts.dbAllFrames.all();
    return json(res, rows, 200, req);
}

// POST /delete-user/:token — supprimer toutes les données d'un user
async function handleDeleteUser(req, res, ctx) {
    const token = ctx.params.token;
    const uid = uidFor(token);
    if (!uid && !isKnownToken(token)) return json(res, { error: "token inconnu" }, 404, req);
    try {
        // Supprimer dossier images (token === hashUid)
        const imgDir = path.join(IMAGES_DIR, token);
        if (fs.existsSync(imgDir))
            fs.rmSync(imgDir, { recursive: true, force: true });
        // Supprimer de la base de données (nettoyage complet)
        const deleteAll = db.transaction(() => {
            stmts.deleteUserFrames.run(token);
            stmts.deleteUser.run(token);
            if (uid) {
                // Révoquer les app tokens associés
                stmts.deleteAppTokensByUser.run(uid);
                // Terminer les sessions dont l'utilisateur est owner
                db.prepare("UPDATE pngtuber_sessions SET status = 'ended', ended_at = datetime('now') WHERE owner_discord_id = ? AND status = 'active'").run(uid);
                // Retirer des participations
                db.prepare("UPDATE session_participants SET left_at = datetime('now') WHERE discord_id = ? AND left_at IS NULL").run(uid);
                // Révoquer les invitations envoyées
                db.prepare("UPDATE invitations SET status = 'expired' WHERE invited_by = ? AND status = 'pending'").run(uid);
                // Supprimer les notifications
                db.prepare("DELETE FROM notifications WHERE discord_id = ?").run(uid);
                // Supprimer les subscription seats
                db.prepare("DELETE FROM subscription_seats WHERE discord_id = ?").run(uid);
                // Supprimer la subscription
                db.prepare("DELETE FROM subscriptions WHERE discord_id = ?").run(uid);
            }
        });
        deleteAll();
        // Retirer de la mémoire
        if (uid) {
            tokenToUid.delete(token);
            uidToToken.delete(uid);
            userLevels.delete(uid);
        }
        console.log(`🗑 User supprimé: ${token}`);
        return json(res, { ok: true }, 200, req);
    } catch (err) {
        console.error("Delete user error:", err);
        return json(res, { error: "Erreur lors de la suppression" }, 500, req);
    }
}

// ── Auth route handlers ─────────────────────────────────────────

async function handleAuthLogin(req, res, ctx) {
    // Rate limit: 10 tentatives login par minute par IP
    const clientIp = getClientIp(req);
    if (rateLimit(`auth:${clientIp}`, 30, 60_000)) {
        res.writeHead(429, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Trop de tentatives</h2><p>Réessayez dans une minute.</p>");
        return;
    }
    // Cap: max 1000 états OAuth en attente (protection contre memory exhaustion)
    if (oauthStates.size > 1000) {
        const oldest = [...oauthStates.entries()].sort((a, b) => {
            const ea = typeof a[1] === 'number' ? a[1] : a[1]?.expiresAt || 0;
            const eb = typeof b[1] === 'number' ? b[1] : b[1]?.expiresAt || 0;
            return ea - eb;
        });
        for (let i = 0; i < 200; i++) oauthStates.delete(oldest[i][0]);
    }
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/callback`;
    if (!clientId) return json(res, { error: "OAuth2 non configuré" }, 500, req);
    // Stocker le paramètre next pour redirection post-login
    const next = ctx.url.searchParams.get('next');
    const safeNext = (next && next.startsWith('/') && !next.startsWith('//')) ? next : null;
    const state = crypto.randomBytes(16).toString("hex");
    oauthStates.set(state, { expiresAt: Date.now() + 5 * 60 * 1000, next: safeNext });
    const url = `https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify%20guilds&state=${state}`;
    res.writeHead(302, { Location: url });
    res.end();
}

async function handleAuthCallback(req, res, ctx) {
    const code = ctx.url.searchParams.get('code');
    const state = ctx.url.searchParams.get('state');
    const stateData = oauthStates.get(state);
    oauthStates.delete(state);
    // Support ancien format (nombre) et nouveau format (objet)
    const expiry = typeof stateData === 'number' ? stateData : stateData?.expiresAt;
    const nextUrl = typeof stateData === 'object' ? stateData?.next : null;
    if (!expiry || Date.now() > expiry) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h2>Session OAuth expirée ou invalide</h2><a href='/auth/login'>Réessayer</a>");
        return;
    }
    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.DISCORD_REDIRECT_URI || `${BASE_URL}/auth/callback`,
            }),
        });
        if (!tokenRes.ok) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h2>Échec échange token OAuth</h2><a href='/auth/login'>Réessayer</a>");
            return;
        }
        const { access_token } = await tokenRes.json();
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${access_token}` },
        });
        if (!userRes.ok) {
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h2>Échec récupération profil</h2><a href='/auth/login'>Réessayer</a>");
            return;
        }
        const discordUser = await userRes.json();
        // Récupérer les serveurs de l'utilisateur via le scope guilds
        let userGuildIds = [];
        try {
            const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
                headers: { Authorization: `Bearer ${access_token}` },
            });
            if (guildsRes.ok) {
                const guilds = await guildsRes.json();
                userGuildIds = guilds.map(g => g.id);
            }
        } catch {}
        const role = getUserRole(discordUser.id);
        const redirectTo = nextUrl || '/';
        if (role === 'admin') {
            const sessionId = createSession(discordUser, userGuildIds);
            setSessionCookie(res, sessionId, BASE_URL);
            res.writeHead(302, { Location: redirectTo });
            res.end();
        } else if (role === 'client') {
            const sessionId = createSession(discordUser, userGuildIds);
            setSessionCookie(res, sessionId, BASE_URL);
            res.writeHead(302, { Location: redirectTo });
            res.end();
        } else {
            // Unknown user → 403
            res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<h2>Accès refusé</h2><p>Vous n'avez pas les permissions nécessaires pour accéder à cette interface.</p>");
            return;
        }
    } catch (err) {
        console.error("OAuth callback error:", err);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h2>Erreur OAuth</h2><p>${escapeHtml(err.message)}</p><a href='/auth/login'>Réessayer</a>`);
    }
}

async function handleAuthLogout(req, res, ctx) {
    const cookies = parseCookies(req);
    const signed = cookies['pngtuber_session'];
    if (signed) {
        const sessionId = verifyCookie(signed);
        if (sessionId) sessions.delete(sessionId);
    }
    res.setHeader('Set-Cookie', 'pngtuber_session=; Path=/; HttpOnly; Max-Age=0');
    res.writeHead(302, { Location: '/auth/login' });
    res.end();
}

async function handleAuthMe(req, res, ctx) {
    const session = getSession(req);
    if (!session) return json(res, { authenticated: false }, 401, req);
    const effectiveRole = session.testRole || session.role || 'viewer';
    const tier = getUserTier(session.discordId);
    return json(res, {
        authenticated: true, username: session.username, discordId: session.discordId,
        role: session.role || 'viewer', effectiveRole, testMode: !!session.testRole,
        tier, tierLimits: TIER_LIMITS[tier],
    }, 200, req);
}

// POST /api/test-mode — admin simule un rôle client (toggle)
async function handleTestMode(req, res, ctx) {
    if (ctx.session.role !== 'admin') return json(res, { error: "Admin uniquement" }, 403, req);
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    const session = getSession(req);
    if (body.enabled) {
        session.testRole = 'client';
    } else {
        delete session.testRole;
    }
    return json(res, { ok: true, testMode: !!session.testRole, effectiveRole: session.testRole || session.role }, 200, req);
}

// ── Permission API handlers ──────────────────────────────────────

// GET /api/permissions (admin only)
async function handleGetPermissions(req, res, ctx) {
    return json(res, loadPermissions(), 200, req);
}

// POST /api/permissions (admin only)
async function handleSetPermission(req, res, ctx) {
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    if (!body.discordId || !body.role) return json(res, { error: "discordId et role requis" }, 400, req);
    if (!['admin', 'client', 'viewer'].includes(body.role)) return json(res, { error: "Rôle invalide" }, 400, req);
    stmts.upsertPermission.run(
        body.discordId, body.role,
        ctx.session?.discordId || null,
        body.displayName || "Unknown",
        JSON.stringify(body.guilds || [])
    );
    return json(res, { ok: true }, 200, req);
}

// DELETE /api/permissions/:discordId (admin only)
async function handleDeletePermission(req, res, ctx) {
    stmts.deletePermission.run(ctx.params.discordId);
    return json(res, { ok: true }, 200, req);
}

// GET /api/permissions/me (any auth)
async function handleGetMyPermissions(req, res, ctx) {
    const session = ctx.session || getSession(req);
    if (!session) return json(res, { error: "Non authentifié" }, 401, req);
    const role = getUserRole(session.discordId);
    const row = stmts.getPermission.get(session.discordId);
    const guilds = row ? JSON.parse(row.guilds_json || "[]") : null;
    return json(res, { role, guilds }, 200, req);
}

// GET /api/my-token (any auth)
async function handleMyToken(req, res, ctx) {
    const session = ctx.session || getSession(req);
    if (!session) return json(res, { error: "Non authentifié" }, 401, req);
    const token = tokenFor(session.discordId);
    return json(res, { token, displayName: session.username }, 200, req);
}

// ── Avatar permissions per server ────────────────────────────────

// GET /api/avatar-permissions/:token — liste des autorisations serveur d'un user
async function handleGetAvatarPerms(req, res, ctx) {
    const token = ctx.params.token;
    const rows = stmts.getAvatarPerms.all(token);
    // Enrichir avec les noms de serveurs
    const perms = rows.map(r => {
        const guild = botConnected ? client.guilds.cache.get(r.guild_id) : null;
        return { guildId: r.guild_id, guildName: guild?.name || r.guild_id, guildIcon: guild?.iconURL({ size: 64 }) || null, allowed: !!r.allowed };
    });
    return json(res, perms, 200, req);
}

// POST /api/avatar-permissions — set permission (token, guildId, allowed)
async function handleSetAvatarPerm(req, res, ctx) {
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    if (!body.token || !body.guildId) return json(res, { error: "token et guildId requis" }, 400, req);
    // Vérifier que le user est autorisé à modifier (admin ou propriétaire du token)
    const isAdmin = (ctx.session?.testRole || ctx.session?.role) === 'admin';
    if (!isAdmin) {
        const myToken = tokenFor(ctx.session.discordId);
        if (body.token !== myToken) return json(res, { error: "Non autorisé" }, 403, req);
    }
    stmts.upsertAvatarPerm.run(body.token, body.guildId, body.allowed ? 1 : 0);
    return json(res, { ok: true }, 200, req);
}

// Vérifier si un token est autorisé sur un guild
function isAvatarAllowed(token, guildId) {
    if (!guildId) return true; // pas de contexte serveur → autorisé (rétrocompatibilité)
    const row = stmts.getAvatarPerm.get(token, guildId);
    return row ? !!row.allowed : false; // non autorisé par défaut
}

// ── Voice Browser API handlers ──────────────────────────────────

// GET /api/guilds — liste des serveurs (filtré par membership pour non-admins)
async function handleGuilds(req, res, ctx) {
    if (!botConnected) return json(res, { error: "Bot non connecté" }, 503, req);
    const isAdmin = (ctx.session?.testRole || ctx.session?.role) === 'admin';
    let guilds = client.guilds.cache;
    // Non-admin: ne montrer que les serveurs où l'utilisateur ET le bot sont présents
    if (!isAdmin) {
        const userGuilds = ctx.session?.userGuildIds || [];
        guilds = guilds.filter(g => userGuilds.includes(g.id));
    }
    return json(res, guilds.map(g => ({
        id: g.id, name: g.name, icon: g.iconURL({ size: 64 }), memberCount: g.memberCount
    })), 200, req);
}

// GET /api/guilds/:guildId/channels — channels vocaux (filtré par permissions pour non-admins)
async function handleGuildChannels(req, res, ctx) {
    if (!botConnected) return json(res, { error: "Bot non connecté" }, 503, req);
    const guild = client.guilds.cache.get(ctx.params.guildId);
    if (!guild) return json(res, { error: "Serveur non trouvé" }, 404, req);
    const isAdmin = (ctx.session?.testRole || ctx.session?.role) === 'admin';
    const discordId = ctx.session?.discordId;
    // Non-admin: vérifier que l'utilisateur est membre du serveur (via OAuth guilds)
    if (!isAdmin) {
        const userGuilds = ctx.session?.userGuildIds || [];
        if (!userGuilds.includes(guild.id)) {
            return json(res, { error: "Vous n'êtes pas membre de ce serveur" }, 403, req);
        }
    }
    // Tenter de fetch le member pour vérifier les permissions channel par channel
    let member = discordId ? guild.members.cache.get(discordId) : null;
    if (!member && discordId && !isAdmin) {
        try { member = await guild.members.fetch(discordId); } catch {}
    }
    const voiceChannels = guild.channels.cache
        .filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
        .filter(c => {
            // Admin voit tout; non-admin ne voit que les channels où il a Connect
            if (isAdmin) return true;
            if (!member) return true; // Si on n'a pas pu fetch le member, on montre tout (filtré au join)
            try { return c.permissionsFor(member).has(PermissionFlagsBits.Connect); }
            catch { return false; }
        })
        .sort((a, b) => a.position - b.position)
        .map(c => ({
            id: c.id, name: c.name, type: c.type, position: c.position,
            members: c.members.map(m => ({
                token: tokenFor(m.id), displayName: m.displayName || m.user.username, bot: m.user.bot
            })),
            botConnected: connectedChannelId === c.id
        }));
    return json(res, voiceChannels, 200, req);
}

// GET /api/guilds/:guildId/members (admin only)
async function handleGuildMembers(req, res, ctx) {
    if (!botConnected) return json(res, { error: "Bot non connecté" }, 503, req);
    const guild = client.guilds.cache.get(ctx.params.guildId);
    if (!guild) return json(res, { error: "Serveur non trouvé" }, 404, req);
    const members = guild.members.cache
        .filter(m => !m.user.bot)
        .map(m => ({
            discordId: m.id, displayName: m.displayName || m.user.username,
            username: m.user.username, avatar: m.user.displayAvatarURL({ size: 64 }),
            inVoice: !!m.voice.channelId,
            voiceChannelName: m.voice.channel?.name || null
        }));
    return json(res, { members, partial: true }, 200, req);
}

// POST /api/voice/join — rejoindre un channel vocal (vérifie permissions pour non-admins)
async function handleVoiceJoin(req, res, ctx) {
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    if (!body.guildId || !body.channelId) return json(res, { error: "guildId et channelId requis" }, 400, req);
    // Vérifier permissions pour les non-admins
    const isAdmin = (ctx.session?.testRole || ctx.session?.role) === 'admin';
    const discordId = ctx.session?.discordId;
    if (!isAdmin) {
        // Vérifier que l'utilisateur est membre du serveur (via OAuth guilds)
        const userGuilds = ctx.session?.userGuildIds || [];
        if (!userGuilds.includes(body.guildId)) {
            return json(res, { error: "Vous n'êtes pas membre de ce serveur" }, 403, req);
        }
        // Vérifier la permission Connect sur le channel spécifique
        const guild = client.guilds.cache.get(body.guildId);
        if (!guild) return json(res, { error: "Serveur non trouvé" }, 404, req);
        let member = guild.members.cache.get(discordId);
        if (!member) { try { member = await guild.members.fetch(discordId); } catch {} }
        if (member) {
            const channel = guild.channels.cache.get(body.channelId);
            if (channel) {
                try {
                    if (!channel.permissionsFor(member).has(PermissionFlagsBits.Connect)) {
                        return json(res, { error: "Pas de permission pour rejoindre ce channel" }, 403, req);
                    }
                } catch {}
            }
        }
    }
    try {
        const result = await connectToVoiceChannel(body.guildId, body.channelId);
        return json(res, { ok: true, guild: result.guild.name, channel: result.channel.name, memberCount: result.members.length }, 200, req);
    } catch (err) {
        console.error("Voice join error:", err);
        return json(res, { error: "Impossible de rejoindre le canal vocal" }, 400, req);
    }
}

// POST /api/voice/disconnect — déconnecter le bot du vocal
async function handleVoiceDisconnect(req, res, ctx) {
    if (!currentConnection) return json(res, { error: "Pas connecté" }, 400, req);
    disconnectVoice();
    return json(res, { ok: true }, 200, req);
}

// GET /api/auto-reconnect — lire l'état de l'option
function handleGetAutoReconnect(req, res) {
    return json(res, { enabled: getAutoReconnect() }, 200, req);
}

// POST /api/auto-reconnect — activer/désactiver l'option
async function handleSetAutoReconnect(req, res, ctx) {
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    setAutoReconnect(!!body.enabled);
    return json(res, { ok: true, enabled: getAutoReconnect() }, 200, req);
}

// GET /api/voice/status (any auth)
async function handleVoiceStatus(req, res, ctx) {
    if (!currentConnection || !connectedGuildId) {
        return json(res, { connected: false }, 200, req);
    }
    const guild = client.guilds.cache.get(connectedGuildId);
    const channel = guild?.channels.cache.get(connectedChannelId);
    return json(res, {
        connected: true,
        guildId: connectedGuildId, guildName: guild?.name,
        channelId: connectedChannelId, channelName: channel?.name,
        members: channel ? channel.members.filter(m => !m.user.bot).map(m => ({
            token: tokenFor(m.id), displayName: m.displayName || m.user.username
        })) : [],
        following: followTarget ? { token: tokenFor(followTarget.discordId), displayName: followTarget.displayName } : null,
        followError: followError && (Date.now() - followError.ts < 10000) ? followError : null,
    }, 200, req);
    // Effacer l'erreur après lecture (une seule notification)
    if (followError && (Date.now() - followError.ts >= 5000)) followError = null;
}

// ── Mode suivi — routes API ──────────────────────────────────

function broadcastFollowStatus() {
    const msg = JSON.stringify({
        type: 'follow-status',
        target: followTarget ? { token: tokenFor(followTarget.discordId), displayName: followTarget.displayName } : null,
    });
    for (const c of wsClients) { if (c.ws.readyState === 1) c.ws.send(msg); }
}
function broadcastFollowError(channelName, userName) {
    followError = { channelName, userName, ts: Date.now() };
    const msg = JSON.stringify({ type: 'follow-error', channelName, userName });
    for (const c of wsClients) { if (c.ws.readyState === 1) c.ws.send(msg); }
}

// POST /api/voice/follow { token } — activer le mode suivi
async function handleVoiceFollow(req, res, ctx) {
    const body = await parseJsonBody(req);
    const token = body?.token;
    if (!token) return json(res, { error: "token requis" }, 400, req);
    const discordId = uidFor(token);
    if (!discordId) return json(res, { error: "token inconnu" }, 404, req);
    // Trouver le membre dans le canal vocal actuel
    let displayName = token;
    if (connectedGuildId) {
        const guild = client.guilds.cache.get(connectedGuildId);
        const member = guild?.members.cache.get(discordId);
        if (member) displayName = member.displayName || member.user.username;
    }
    followTarget = { discordId, requestedBy: ctx.session?.discordId, displayName };
    broadcastFollowStatus();
    console.log(`👣 Mode suivi activé: ${displayName}`);
    return json(res, { ok: true, following: { token, displayName } }, 200, req);
}

// POST /api/voice/unfollow — désactiver le mode suivi
async function handleVoiceUnfollow(req, res, ctx) {
    followTarget = null;
    broadcastFollowStatus();
    console.log('👣 Mode suivi désactivé');
    return json(res, { ok: true }, 200, req);
}

// GET /api/voice/follow-status — état actuel du suivi
async function handleFollowStatus(req, res, ctx) {
    return json(res, {
        following: followTarget ? { token: tokenFor(followTarget.discordId), displayName: followTarget.displayName } : null,
    }, 200, req);
}

// ════════════════════════════════════════════════════════════════
// VIEWER SESSIONS — tokens sécurisés pour les URLs OBS
// ════════════════════════════════════════════════════════════════

// POST /api/viewer-session { userToken } → crée un lien sécurisé
async function handleCreateViewerSession(req, res, ctx) {
    const body = await parseJsonBody(req);
    const userToken = body?.userToken;
    if (!userToken || typeof userToken !== "string") return json(res, { error: "userToken requis" }, 400, req);
    const now = Date.now();
    const sessionId = crypto.randomBytes(24).toString("hex");
    viewerSessions.set(sessionId, { userToken, createdAt: now });
    saveViewerSessions();
    return json(res, { sessionId }, 200, req);
}

// GET /api/viewer-session/:sessionId → résout le token utilisateur
async function handleResolveViewerSession(req, res, ctx) {
    const sessionId = ctx.params.sessionId;
    const session = viewerSessions.get(sessionId);
    if (!session) return json(res, { error: "Session invalide ou expirée" }, 404, req);
    // Rafraîchir le timestamp (prolonge la session à chaque accès)
    session.createdAt = Date.now();
    saveViewerSessions();
    return json(res, { userToken: session.userToken }, 200, req);
}

// ════════════════════════════════════════════════════════════════
// DEVICE AUTH FLOW — authentification mini-agent local
// ════════════════════════════════════════════════════════════════
// PROBLÈME : une app locale (agent, plugin OBS…) ne peut pas faire le flux
// OAuth2 classique car elle n'a pas d'URL de callback accessible depuis Discord.
//
// SOLUTION : OAuth2 Device Authorization Grant (RFC 8628)
// C'est le même flux que pour connecter une Apple TV ou une console de jeux.
//
// ÉTAPES :
//   1. L'app appelle POST /api/device/authorize → reçoit { deviceCode, userCode }
//   2. L'app affiche à l'utilisateur : "Allez sur https://bot.../device et entrez XXXX-XXXX"
//   3. L'utilisateur, déjà connecté dans le navigateur, ouvre la page et approuve.
//      GET /api/device/verify?code=XXXX-XXXX → lie le deviceCode à la session Discord
//   4. L'app poll (toutes les 5s) POST /api/device/poll?deviceCode=... jusqu'à
//      recevoir { status: 'approved', appToken: '...' }
//   5. L'app stocke l'appToken et l'utilise ensuite en Bearer token dans les requêtes.
//
// SÉCURITÉ :
//   - Les deviceCodes expirent après 15 minutes
//   - L'appToken final est un token aléatoire 32 octets → seul son SHA-256 est en DB
//   - Les appTokens sont limités au rôle 'client' (jamais admin)

function generateUserCode() {
    // Code 8 chars lisible: XXXX-XXXX (alphanum majuscules sans ambiguïté)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // pas de 0/O/1/I
    let code = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) code += chars[bytes[i] % chars.length];
    return code.slice(0, 4) + '-' + code.slice(4);
}

// POST /api/device/authorize — l'app demande un code
async function handleDeviceAuthorize(req, res, ctx) {
    const clientIp = getClientIp(req);
    if (rateLimit(`device:${clientIp}`, 5, 60_000))
        return json(res, { error: "Trop de requêtes" }, 429, req);
    // Cap mémoire : max 500 device codes en attente
    if (deviceAuthRequests.size > 500) {
        const now = Date.now();
        for (const [k, v] of deviceAuthRequests) {
            if (now > v.expiresAt) deviceAuthRequests.delete(k);
        }
    }
    let body = {};
    try { body = await parseJsonBody(req); } catch {}
    const deviceCode = crypto.randomBytes(32).toString('hex');
    const userCode = generateUserCode();
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.slice(0, 64) : 'Agent';
    deviceAuthRequests.set(deviceCode, {
        userCode, discordId: null, status: 'pending',
        deviceName, expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return json(res, {
        deviceCode, userCode, verifyUrl: `${BASE_URL}/api/device/verify?user_code=${userCode}`,
        expiresIn: 300, interval: 5,
    }, 200, req);
}

// POST /api/device/poll — l'app poll le statut
async function handleDevicePoll(req, res, ctx) {
    const clientIp = getClientIp(req);
    if (rateLimit(`poll:${clientIp}`, 30, 60_000))
        return json(res, { error: "Trop de requêtes" }, 429, req);
    const body = await parseJsonBody(req);
    const entry = deviceAuthRequests.get(body?.deviceCode);
    if (!entry) return json(res, { status: 'expired' }, 200, req);
    if (Date.now() > entry.expiresAt) {
        deviceAuthRequests.delete(body.deviceCode);
        return json(res, { status: 'expired' }, 200, req);
    }
    if (entry.status === 'denied') {
        deviceAuthRequests.delete(body.deviceCode);
        return json(res, { status: 'denied' }, 200, req);
    }
    if (entry.status === 'authorized' && entry.appToken) {
        const token = entry.appToken;
        const userToken = tokenFor(entry.discordId);
        const tier = getUserTier(entry.discordId);
        deviceAuthRequests.delete(body.deviceCode);
        return json(res, { status: 'authorized', appToken: token, userToken, tier }, 200, req);
    }
    return json(res, { status: 'pending' }, 200, req);
}

// GET /api/device/verify — page HTML de vérification
async function handleDeviceVerifyPage(req, res, ctx) {
    const userCode = ctx.url.searchParams.get('user_code') || '';
    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autoriser l'application</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
  .card{background:#16213e;border-radius:16px;padding:2rem;max-width:420px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
  h1{font-size:1.4rem;margin-bottom:.5rem}
  .code{font-size:2rem;font-weight:bold;letter-spacing:.3em;color:#7c3aed;background:#0f0f23;padding:.8rem 1.5rem;border-radius:8px;margin:1.5rem 0;font-family:monospace}
  .device{color:#a78bfa;font-weight:600}
  .btn{display:inline-block;padding:.7rem 2rem;border-radius:8px;border:none;font-size:1rem;cursor:pointer;margin:.3rem;font-weight:600;transition:all .2s}
  .approve{background:#7c3aed;color:#fff}.approve:hover{background:#6d28d9}
  .deny{background:#374151;color:#9ca3af}.deny:hover{background:#4b5563}
  .result{margin-top:1rem;padding:1rem;border-radius:8px;display:none}
  .success{background:#064e3b;color:#34d399;display:block}
  .error{background:#450a0a;color:#f87171;display:block}
  input{background:#0f0f23;border:2px solid #374151;color:#e0e0e0;padding:.7rem 1rem;border-radius:8px;font-size:1.2rem;text-align:center;letter-spacing:.2em;width:80%;font-family:monospace;text-transform:uppercase}
  input:focus{border-color:#7c3aed;outline:none}
</style></head><body>
<div class="card">
  <h1>Autoriser l'application</h1>
  <p>Entrez le code affiché dans votre application :</p>
  <div><input id="codeInput" type="text" maxlength="9" placeholder="XXXX-XXXX" value="${escapeHtml(userCode)}"></div>
  <div id="deviceInfo" style="margin:1rem 0;display:none">
    <p>L'application <span class="device" id="deviceName"></span> demande l'accès à votre compte.</p>
    <p style="color:#9ca3af;font-size:.9rem">Cela lui permettra de contrôler vos avatars PNGTuber.</p>
  </div>
  <div id="actions" style="margin-top:1rem">
    <button class="btn approve" onclick="verify()">Vérifier</button>
  </div>
  <div id="result" class="result"></div>
</div>
<script>
const input = document.getElementById('codeInput');
input.addEventListener('input', e => {
    let v = e.target.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    if(v.length>4) v=v.slice(0,4)+'-'+v.slice(4,8);
    e.target.value=v;
});
async function verify() {
    const code = input.value.trim();
    if(code.length<9) return;
    try {
        const r = await fetch('/api/device/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userCode:code,action:'check'})});
        const d = await r.json();
        if(d.found) {
            document.getElementById('deviceName').textContent=d.deviceName;
            document.getElementById('deviceInfo').style.display='block';
            document.getElementById('actions').innerHTML='<button class="btn approve" onclick="approve()">Autoriser</button><button class="btn deny" onclick="deny()">Refuser</button>';
        } else {
            showResult('Code invalide ou expiré','error');
        }
    } catch(e) { showResult('Erreur réseau','error'); }
}
async function approve() { await submit('approve'); }
async function deny() { await submit('deny'); }
async function submit(action) {
    const code = input.value.trim();
    try {
        const r = await fetch('/api/device/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userCode:code,action})});
        const d = await r.json();
        if(d.ok) showResult(action==='approve'?'Application autorisée ! Vous pouvez fermer cette page.':'Accès refusé.',action==='approve'?'success':'error');
        else showResult(d.error||'Erreur','error');
    } catch(e) { showResult('Erreur réseau','error'); }
}
function showResult(msg,cls) {
    const el = document.getElementById('result');
    el.textContent=msg; el.className='result '+cls;
    document.getElementById('actions').style.display='none';
}
if(input.value.length>=9) verify();
</script></body></html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() });
    res.end(html);
}

// POST /api/device/verify — confirmer/refuser
async function handleDeviceVerifySubmit(req, res, ctx) {
    const clientIp = getClientIp(req);
    if (rateLimit(`device-verify:${clientIp}`, 10, 60_000))
        return json(res, { error: "Trop de tentatives, réessayez dans 1 minute" }, 429, req);
    const body = await parseJsonBody(req);
    const userCode = typeof body?.userCode === 'string' ? body.userCode.toUpperCase().trim() : '';
    const action = body?.action;
    // Chercher le device code par user code
    let found = null, foundKey = null;
    for (const [k, v] of deviceAuthRequests) {
        if (v.userCode === userCode && v.status === 'pending' && Date.now() < v.expiresAt) {
            found = v; foundKey = k; break;
        }
    }
    if (!found) return json(res, { found: false, error: "Code invalide ou expiré" }, 200, req);
    if (action === 'check') {
        return json(res, { found: true, deviceName: found.deviceName }, 200, req);
    }
    if (action === 'deny') {
        found.status = 'denied';
        return json(res, { ok: true }, 200, req);
    }
    if (action === 'approve') {
        // Vérifier le tier (mini-app requiert premium)
        const tier = getUserTier(ctx.session.discordId);
        if (tier === 'free') {
            return json(res, { ok: false, error: "Fonctionnalité premium requise pour la mini-application" }, 403, req);
        }
        // Générer un app token
        const rawToken = crypto.randomBytes(32).toString('hex');
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        stmts.createAppToken.run(hash, ctx.session.discordId, found.deviceName);
        found.status = 'authorized';
        found.discordId = ctx.session.discordId;
        found.appToken = rawToken; // token brut retourné une seule fois via poll
        return json(res, { ok: true }, 200, req);
    }
    return json(res, { error: "Action invalide" }, 400, req);
}

// GET /api/app-tokens — liste des tokens API de l'utilisateur
async function handleListAppTokens(req, res, ctx) {
    const rows = stmts.getAppTokensByUser.all(ctx.session.discordId);
    return json(res, { tokens: rows }, 200, req);
}

// DELETE /api/app-tokens/:id — révoquer un token API
async function handleRevokeAppToken(req, res, ctx) {
    const id = parseInt(ctx.params.id, 10);
    if (isNaN(id)) return json(res, { error: "ID invalide" }, 400, req);
    stmts.revokeAppToken.run(id, ctx.session.discordId);
    return json(res, { ok: true }, 200, req);
}

// ════════════════════════════════════════════════════════════════
// SESSIONS PNGTUBER — sessions collaboratives
// ════════════════════════════════════════════════════════════════
let activeVoiceSessionId = null; // session voice active en cours

// POST /api/sessions — créer une session
async function handleCreateSession(req, res, ctx) {
    const body = await parseJsonBody(req);
    const type = body?.type === 'standalone' ? 'standalone' : 'voice';
    const name = typeof body?.name === 'string' ? body.name.slice(0, 100) : 'Session';
    if (type === 'standalone' && ctx.tier === 'free') {
        return json(res, { error: "Sessions standalone requièrent un abonnement premium", tier: 'free', upgrade: true }, 403, req);
    }
    const maxP = ctx.tierLimits?.maxSessionParticipants || TIER_LIMITS.free.maxSessionParticipants;
    const sessionId = crypto.randomBytes(8).toString('hex');
    stmts.createPSession.run(sessionId, ctx.session.discordId, name, type, body?.guildId || null, body?.channelId || null, maxP);
    // Ajouter le créateur comme participant owner
    const ownerToken = tokenFor(ctx.session.discordId);
    stmts.addParticipant.run(sessionId, ctx.session.discordId, ownerToken, 'owner');
    return json(res, { ok: true, session: stmts.getPSession.get(sessionId) }, 200, req);
}

// GET /api/sessions — lister mes sessions
async function handleListSessions(req, res, ctx) {
    const sessions_list = stmts.getUserPSessions.all(ctx.session.discordId, ctx.session.discordId);
    return json(res, { sessions: sessions_list }, 200, req);
}

// GET /api/sessions/:sessionId — détails
async function handleGetPSession(req, res, ctx) {
    const s = stmts.getPSession.get(ctx.params.sessionId);
    if (!s) return json(res, { error: "Session introuvable" }, 404, req);
    const isParticipant = stmts.isParticipant.get(s.id, ctx.session.discordId);
    if (!isParticipant && s.owner_discord_id !== ctx.session.discordId && ctx.session.role !== 'admin')
        return json(res, { error: "Accès refusé" }, 403, req);
    const participants = stmts.getParticipants.all(s.id);
    return json(res, { session: s, participants }, 200, req);
}

// POST /api/sessions/:sessionId/end — terminer
async function handleEndSession(req, res, ctx) {
    const s = stmts.getPSession.get(ctx.params.sessionId);
    if (!s) return json(res, { error: "Session introuvable" }, 404, req);
    if (s.owner_discord_id !== ctx.session.discordId && ctx.session.role !== 'admin')
        return json(res, { error: "Seul le propriétaire peut terminer la session" }, 403, req);
    stmts.endPSession.run(s.id);
    // Expirer toutes les invitations pending liées à cette session
    db.prepare("UPDATE invitations SET status = 'expired' WHERE session_id = ? AND status = 'pending'").run(s.id);
    if (activeVoiceSessionId === s.id) activeVoiceSessionId = null;
    return json(res, { ok: true }, 200, req);
}

// POST /api/sessions/:sessionId/leave — quitter
async function handleLeaveSession(req, res, ctx) {
    const s = stmts.getPSession.get(ctx.params.sessionId);
    if (!s) return json(res, { error: "Session introuvable" }, 404, req);
    // Le owner ne peut pas quitter sans terminer la session
    if (s.owner_discord_id === ctx.session.discordId)
        return json(res, { error: "Le propriétaire doit terminer la session au lieu de la quitter" }, 400, req);
    stmts.removeParticipant.run(s.id, ctx.session.discordId);
    return json(res, { ok: true }, 200, req);
}

// GET /api/sessions/:sessionId/participants
async function handleSessionParticipants(req, res, ctx) {
    const s = stmts.getPSession.get(ctx.params.sessionId);
    if (!s) return json(res, { error: "Session introuvable" }, 404, req);
    // Vérifier que l'utilisateur est participant, owner, ou admin
    const isOwner = s.owner_discord_id === ctx.session.discordId;
    const isAdmin = ctx.session.role === 'admin';
    const isParticipant = stmts.getParticipants.all(s.id).some(p => p.discord_id === ctx.session.discordId && !p.left_at);
    if (!isOwner && !isAdmin && !isParticipant)
        return json(res, { error: "Accès refusé" }, 403, req);
    const participants = stmts.getParticipants.all(s.id);
    return json(res, { participants }, 200, req);
}

// ════════════════════════════════════════════════════════════════
// INVITATIONS
// ════════════════════════════════════════════════════════════════

// POST /api/invitations — créer une invitation
async function handleCreateInvitation(req, res, ctx) {
    const body = await parseJsonBody(req);
    const sessionId = body?.sessionId;
    if (!sessionId) return json(res, { error: "sessionId requis" }, 400, req);
    const s = stmts.getPSession.get(sessionId);
    if (!s || s.status !== 'active') return json(res, { error: "Session introuvable ou terminée" }, 404, req);
    if (s.owner_discord_id !== ctx.session.discordId && ctx.session.role !== 'admin')
        return json(res, { error: "Seul le propriétaire peut inviter" }, 403, req);
    const inviteId = crypto.randomBytes(8).toString('hex');
    const invitedId = typeof body.discordId === 'string' ? body.discordId : null;
    const maxUses = typeof body.maxUses === 'number' ? Math.min(body.maxUses, 100) : 1;
    const streamName = typeof body.streamName === 'string' ? body.streamName.slice(0, 200) : null;
    const expiresMinutes = typeof body.expiresInMinutes === 'number' ? body.expiresInMinutes : 1440; // 24h défaut
    const expiresAt = new Date(Date.now() + expiresMinutes * 60_000).toISOString();
    stmts.createInvitation.run(inviteId, sessionId, ctx.session.discordId, invitedId, maxUses, streamName, expiresAt);
    // Créer une notification pour l'invité ciblé
    if (invitedId) {
        const payload = JSON.stringify({
            invitationId: inviteId, sessionId, sessionName: s.name,
            inviterName: ctx.session.username || 'Quelqu\'un',
            streamName,
        });
        stmts.createNotification.run(invitedId, 'invitation', payload);
        // Broadcast WS notification
        broadcastNotification(invitedId, { id: inviteId, type: 'invitation', payload: JSON.parse(payload) });
    }
    return json(res, {
        ok: true, invitation: stmts.getInvitation.get(inviteId),
        inviteUrl: `${BASE_URL}/invite/${inviteId}`,
    }, 200, req);
}

// GET /api/invitations/:invitationId — détails (public pour la page d'acceptation)
async function handleGetInvitationDetails(req, res, ctx) {
    const inv = stmts.getInvitation.get(ctx.params.invitationId);
    if (!inv) return json(res, { error: "Invitation introuvable" }, 404, req);
    // Ne pas exposer les IDs Discord dans la réponse publique
    return json(res, {
        id: inv.id, sessionName: inv.session_name, streamName: inv.stream_name,
        status: inv.status, expiresAt: inv.expires_at,
    }, 200, req);
}

// POST /api/invitations/:invitationId/accept — accepter
async function handleAcceptInvitation(req, res, ctx) {
    const inv = stmts.getInvitation.get(ctx.params.invitationId);
    if (!inv) return json(res, { error: "Invitation introuvable" }, 404, req);
    if (inv.status !== 'pending') return json(res, { error: "Invitation déjà utilisée ou expirée" }, 400, req);
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
        stmts.updateInvitationStatus.run('expired', inv.id);
        return json(res, { error: "Invitation expirée" }, 400, req);
    }
    if (inv.invited_discord_id && inv.invited_discord_id !== ctx.session.discordId)
        return json(res, { error: "Cette invitation ne vous est pas destinée" }, 403, req);
    if (inv.use_count >= inv.max_uses) {
        stmts.updateInvitationStatus.run('expired', inv.id);
        return json(res, { error: "Nombre maximum d'utilisations atteint" }, 400, req);
    }
    const s = stmts.getPSession.get(inv.session_id);
    if (!s || s.status !== 'active') return json(res, { error: "Session terminée" }, 400, req);
    // Empêcher l'auto-invitation et la double participation
    if (s.owner_discord_id === ctx.session.discordId)
        return json(res, { error: "Vous êtes déjà propriétaire de cette session" }, 400, req);
    const participants = stmts.getParticipants.all(s.id);
    const alreadyParticipant = participants.some(p => p.discord_id === ctx.session.discordId && !p.left_at);
    if (alreadyParticipant) return json(res, { error: "Vous êtes déjà participant de cette session" }, 400, req);
    // Vérifier le nombre de participants
    if (participants.length >= s.max_participants) return json(res, { error: "Session complète" }, 400, req);
    // Ajouter le participant
    const userToken = tokenFor(ctx.session.discordId);
    stmts.addParticipant.run(s.id, ctx.session.discordId, userToken, 'participant');
    stmts.incrementInviteUse.run(inv.id);
    if (inv.invited_discord_id) stmts.updateInvitationStatus.run('accepted', inv.id);
    // Notifier le propriétaire de la session
    const payload = JSON.stringify({
        sessionId: s.id, sessionName: s.name,
        memberName: ctx.session.username || 'Quelqu\'un',
    });
    stmts.createNotification.run(s.owner_discord_id, 'member_joined', payload);
    broadcastNotification(s.owner_discord_id, { type: 'member_joined', payload: JSON.parse(payload) });
    return json(res, { ok: true, session: s }, 200, req);
}

// POST /api/invitations/:invitationId/decline — refuser
async function handleDeclineInvitation(req, res, ctx) {
    const inv = stmts.getInvitation.get(ctx.params.invitationId);
    if (!inv) return json(res, { error: "Invitation introuvable" }, 404, req);
    if (inv.invited_discord_id && inv.invited_discord_id !== ctx.session.discordId)
        return json(res, { error: "Cette invitation ne vous est pas destinée" }, 403, req);
    stmts.updateInvitationStatus.run('declined', inv.id);
    return json(res, { ok: true }, 200, req);
}

// DELETE /api/invitations/:invitationId — révoquer
async function handleRevokeInvitation(req, res, ctx) {
    const inv = stmts.getInvitation.get(ctx.params.invitationId);
    if (!inv) return json(res, { error: "Invitation introuvable" }, 404, req);
    if (inv.invited_by !== ctx.session.discordId && inv.owner_discord_id !== ctx.session.discordId && ctx.session.role !== 'admin')
        return json(res, { error: "Accès refusé" }, 403, req);
    stmts.updateInvitationStatus.run('revoked', inv.id);
    return json(res, { ok: true }, 200, req);
}

// GET /api/my-invitations — invitations en attente pour moi
async function handleMyInvitations(req, res, ctx) {
    const invitations = stmts.getPendingInvitations.all(ctx.session.discordId);
    return json(res, { invitations }, 200, req);
}

// ════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════════
const wsNotifClients = new Map(); // discordId → Set<ws>

function broadcastNotification(discordId, notification) {
    const clients = wsNotifClients.get(discordId);
    if (!clients || clients.size === 0) return;
    const msg = JSON.stringify({ type: 'notification', notification });
    for (const ws of clients) {
        if (ws.readyState === 1) ws.send(msg);
    }
}

// GET /api/notifications
async function handleGetNotifications(req, res, ctx) {
    const unread = ctx.url.searchParams.get('unread') === 'true';
    const limit = Math.min(parseInt(ctx.url.searchParams.get('limit') || '50', 10), 200);
    const rows = unread
        ? stmts.getUnreadNotifications.all(ctx.session.discordId, limit)
        : stmts.getNotifications.all(ctx.session.discordId, limit);
    const count = stmts.countUnreadNotifs.get(ctx.session.discordId);
    return json(res, { notifications: rows, unreadCount: count.cnt }, 200, req);
}

// POST /api/notifications/:id/read
async function handleMarkNotifRead(req, res, ctx) {
    const id = parseInt(ctx.params.id, 10);
    if (isNaN(id)) return json(res, { error: "ID invalide" }, 400, req);
    stmts.markNotifRead.run(id, ctx.session.discordId);
    return json(res, { ok: true }, 200, req);
}

// POST /api/notifications/read-all
async function handleMarkAllRead(req, res, ctx) {
    stmts.markAllNotifsRead.run(ctx.session.discordId);
    return json(res, { ok: true }, 200, req);
}

// ════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS — gestion admin des abonnements
// ════════════════════════════════════════════════════════════════

// GET /api/subscription — mon abonnement
async function handleGetSubscription(req, res, ctx) {
    const tier = getUserTier(ctx.session.discordId);
    const sub = stmts.getSubscription.get(ctx.session.discordId);
    const seats = sub && sub.tier === 'streamer' ? stmts.getSeatsBySub.all(sub.id) : [];
    return json(res, { tier, subscription: sub || null, seats, limits: TIER_LIMITS[tier] }, 200, req);
}

// POST /api/subscription — admin attribue un abonnement
async function handleSetSubscription(req, res, ctx) {
    const body = await parseJsonBody(req);
    if (!body?.discordId || !body?.tier) return json(res, { error: "discordId et tier requis" }, 400, req);
    if (!['free', 'premium', 'streamer'].includes(body.tier)) return json(res, { error: "Tier invalide" }, 400, req);
    const maxSeats = body.tier === 'streamer' ? (typeof body.maxSeats === 'number' ? body.maxSeats : 5) : 1;
    const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : null;
    if (body.tier === 'free') {
        stmts.cancelSubscription.run(body.discordId);
    } else {
        stmts.upsertSubscription.run(body.discordId, body.tier, maxSeats, expiresAt);
    }
    return json(res, { ok: true, tier: body.tier }, 200, req);
}

// DELETE /api/subscription/:discordId — annuler
async function handleCancelSubscription(req, res, ctx) {
    stmts.cancelSubscription.run(ctx.params.discordId);
    return json(res, { ok: true }, 200, req);
}

// POST /api/subscription/seats — ajouter une place
async function handleAddSeat(req, res, ctx) {
    const sub = stmts.getSubscription.get(ctx.session.discordId);
    if (!sub || sub.tier !== 'streamer') return json(res, { error: "Pack streamer requis" }, 403, req);
    const body = await parseJsonBody(req);
    if (!body?.discordId) return json(res, { error: "discordId requis" }, 400, req);
    const seatCount = stmts.countSeatsBySub.get(sub.id);
    if (seatCount.cnt >= sub.max_seats) return json(res, { error: `Limite de ${sub.max_seats} places atteinte` }, 400, req);
    stmts.addSeat.run(sub.id, body.discordId);
    return json(res, { ok: true }, 200, req);
}

// DELETE /api/subscription/seats/:discordId — retirer une place
async function handleRemoveSeat(req, res, ctx) {
    const sub = stmts.getSubscription.get(ctx.session.discordId);
    if (!sub || sub.tier !== 'streamer') return json(res, { error: "Pack streamer requis" }, 403, req);
    stmts.removeSeat.run(sub.id, ctx.params.discordId);
    return json(res, { ok: true }, 200, req);
}

// GET /api/subscription/seats — lister les places
async function handleListSeats(req, res, ctx) {
    const sub = stmts.getSubscription.get(ctx.session.discordId);
    if (!sub) return json(res, { seats: [], maxSeats: 0 }, 200, req);
    const seats = stmts.getSeatsBySub.all(sub.id);
    return json(res, { seats, maxSeats: sub.max_seats }, 200, req);
}

// ════════════════════════════════════════════════════════════════
// PAGE INVITE (HTML inline)
// ════════════════════════════════════════════════════════════════
async function handleInvitePage(req, res, ctx) {
    const inv = stmts.getInvitation.get(ctx.params.invitationId);
    if (!inv || inv.status !== 'pending') {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end('<h2>Invitation introuvable ou expirée</h2><a href="/">Retour</a>');
        return;
    }
    // Si pas connecté, redirect vers login avec next
    if (AUTH_ENABLED) {
        const session = getSession(req);
        if (!session) {
            res.writeHead(302, { Location: `/auth/login?next=/invite/${inv.id}` });
            res.end();
            return;
        }
    }
    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invitation PNGTuber</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#1a1a2e;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
  .card{background:#16213e;border-radius:16px;padding:2rem;max-width:420px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3)}
  h1{font-size:1.4rem;margin-bottom:.5rem;color:#7c3aed}
  .session-name{font-size:1.2rem;font-weight:600;color:#a78bfa;margin:.5rem 0}
  .stream-name{color:#9ca3af;font-style:italic}
  .btn{display:inline-block;padding:.7rem 2rem;border-radius:8px;border:none;font-size:1rem;cursor:pointer;margin:.3rem;font-weight:600;transition:all .2s}
  .accept{background:#059669;color:#fff}.accept:hover{background:#047857}
  .decline{background:#374151;color:#9ca3af}.decline:hover{background:#4b5563}
  .result{margin-top:1rem;padding:1rem;border-radius:8px;display:none}
</style></head><body>
<div class="card">
  <h1>Vous êtes invité(e) !</h1>
  <p class="session-name">${escapeHtml(inv.session_name || 'Session PNGTuber')}</p>
  ${inv.stream_name ? `<p class="stream-name">${escapeHtml(inv.stream_name)}</p>` : ''}
  <p style="margin:1.5rem 0">Rejoindre cette session PNGTuber ?</p>
  <div id="actions">
    <button class="btn accept" onclick="respond('accept')">Rejoindre</button>
    <button class="btn decline" onclick="respond('decline')">Refuser</button>
  </div>
  <div id="result" class="result"></div>
</div>
<script>
async function respond(action) {
    try {
        const r = await fetch('/api/invitations/${inv.id}/'+action,{method:'POST',headers:{'Content-Type':'application/json'}});
        const d = await r.json();
        const el = document.getElementById('result');
        document.getElementById('actions').style.display='none';
        if(d.ok) {
            el.style.display='block';
            el.style.background=action==='accept'?'#064e3b':'#1f2937';
            el.style.color=action==='accept'?'#34d399':'#9ca3af';
            el.textContent=action==='accept'?'Vous avez rejoint la session !':'Invitation refusée.';
            if(action==='accept') setTimeout(()=>window.location.href='/',2000);
        } else {
            el.style.display='block';el.style.background='#450a0a';el.style.color='#f87171';
            el.textContent=d.error||'Erreur';
        }
    } catch(e) { alert('Erreur réseau'); }
}
</script></body></html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...securityHeaders() });
    res.end(html);
}

// ════════════════════════════════════════════════════════════════
// ENREGISTREMENT DES ROUTES
// ════════════════════════════════════════════════════════════════

// Auth routes (publiques)
route('GET', '/auth/login', handleAuthLogin);
route('GET', '/auth/callback', handleAuthCallback);
route('GET', '/auth/logout', handleAuthLogout);
route('GET', '/auth/me', handleAuthMe);
route('POST', '/api/test-mode', requireAuth, handleTestMode);

// Routes publiques (pas d'auth) — nécessaires pour OBS et le viewer
route('GET', '/levels', handleLevels);
route('GET', '/status', handleStatus);
route('GET', '/bot-info', handleBotInfo);
route('GET', '/images/*', handleImages);
route('GET', '/frames/:token', handleFrames);
route('GET', '/user-config/:token', handleGetUserConfig);
route('GET', '/known-users', handleKnownUsers);
route('GET', '/api/viewer-session/:sessionId', handleResolveViewerSession);
route('GET', '/api/debug-log', requireAuth, requireAdmin, async (req, res, ctx) => {
    // Retourne les logs debug du viewer (ring buffer)
    // ?last=N pour les N dernières entrées (défaut: tout)
    const last = parseInt(ctx.url.searchParams.get('last') || '0', 10);
    const entries = last > 0 ? debugLogBuffer.slice(-last) : debugLogBuffer;
    return json(res, { count: entries.length, total: debugLogBuffer.length, entries }, 200, req);
});

// Émotion manuelle (raccourcis clavier / agent local)
route('GET', '/api/emotion/:token', handleGetEmotion);
route('POST', '/api/emotion/:token', requireAuth, requireClientOrAdmin, handleSetEmotion);

// Viewer session (auth requise pour créer, public pour résoudre)
route('POST', '/api/viewer-session', requireAuth, requireClientOrAdmin, handleCreateViewerSession);

// Routes protégées — client-or-admin (owner can edit own data)
route('POST', '/upload', requireAuth, parseBodyToken, requireClientOrAdmin, loadTier, handleUpload);
route('POST', '/reorder', requireAuth, parseBodyToken, requireClientOrAdmin, handleReorder);
route('POST', '/delete-frame', requireAuth, parseBodyToken, requireClientOrAdmin, handleDeleteFrame);
route('POST', '/move-frame', requireAuth, parseBodyToken, requireClientOrAdmin, handleMoveFrame);
route('POST', '/user-config/:token', requireAuth, requireClientOrAdmin, loadTier, handlePostUserConfig);

// Calibration routes
route('POST', '/calibration/:token/reset', requireAuth, requireClientOrAdmin, handleCalibrationReset);
route('POST', '/calibration/:token/auto-thresholds', requireAuth, requireClientOrAdmin, handleAutoThresholds);
route('POST', '/calibration/:token/auto-emotions', requireAuth, requireClientOrAdmin, handleAutoEmotions);

// Fingerprint recording routes (premium only)
route('POST', '/calibration/:token/record-start', requireAuth, requireClientOrAdmin, loadTier, requirePremium, handleRecordStart);
route('POST', '/calibration/:token/record-stop', requireAuth, requireClientOrAdmin, loadTier, requirePremium, handleRecordStop);
route('POST', '/calibration/:token/save-fingerprint', requireAuth, requireClientOrAdmin, loadTier, requirePremium, handleSaveFingerprint);
route('DELETE', '/calibration/:token/fingerprint/:emotionKey', requireAuth, requireClientOrAdmin, loadTier, requirePremium, handleDeleteFingerprint);

// Routes protégées — admin only
route('POST', '/bot-token', requireAuth, requireAdmin, handleBotToken);
route('POST', '/delete-user/:token', requireAuth, requireAdmin, handleDeleteUser);

// Permission API
route('GET', '/api/permissions/me', requireAuth, handleGetMyPermissions);
route('GET', '/api/permissions', requireAuth, requireAdmin, handleGetPermissions);
route('POST', '/api/permissions', requireAuth, requireAdmin, handleSetPermission);
route('DELETE', '/api/permissions/:discordId', requireAuth, requireAdmin, handleDeletePermission);
route('GET', '/api/my-token', requireAuth, handleMyToken);

// Avatar permissions per server
route('GET', '/api/avatar-permissions/:token', requireAuth, handleGetAvatarPerms);
route('POST', '/api/avatar-permissions', requireAuth, handleSetAvatarPerm);

// Voice Browser API
route('GET', '/api/guilds/:guildId/channels', requireAuth, handleGuildChannels);
route('GET', '/api/guilds/:guildId/members', requireAuth, requireAdmin, handleGuildMembers);
route('GET', '/api/guilds', requireAuth, handleGuilds);
route('POST', '/api/voice/join', requireAuth, handleVoiceJoin);
route('POST', '/api/voice/disconnect', requireAuth, requireAdmin, handleVoiceDisconnect);
route('GET', '/api/voice/status', requireAuth, handleVoiceStatus);

// Auto-reconnect
route('GET', '/api/auto-reconnect', requireAuth, requireAdmin, handleGetAutoReconnect);
route('POST', '/api/auto-reconnect', requireAuth, requireAdmin, handleSetAutoReconnect);

// Follow mode
route('POST', '/api/voice/follow', requireAuth, requireAdmin, handleVoiceFollow);
route('POST', '/api/voice/unfollow', requireAuth, requireAdmin, handleVoiceUnfollow);
route('GET', '/api/voice/follow-status', requireAuth, handleFollowStatus);

// DB Browser API (admin only)
route('GET', '/api/db/stats', requireAuth, requireAdmin, handleDbStats);
route('GET', '/api/db/frames', requireAuth, requireAdmin, handleDbFrames);

// ── Device Auth (mini-agent local) ──
route('POST', '/api/device/authorize', handleDeviceAuthorize);
route('POST', '/api/device/poll', handleDevicePoll);
route('GET', '/api/device/verify', requireAuth, handleDeviceVerifyPage);
route('POST', '/api/device/verify', requireAuth, handleDeviceVerifySubmit);
route('GET', '/api/app-tokens', requireAuth, handleListAppTokens);
route('DELETE', '/api/app-tokens/:id', requireAuth, handleRevokeAppToken);

// ── Subscriptions / Premium ──
route('GET', '/api/subscription', requireAuth, loadTier, handleGetSubscription);
route('POST', '/api/subscription', requireAuth, requireAdmin, handleSetSubscription);
route('DELETE', '/api/subscription/:discordId', requireAuth, requireAdmin, handleCancelSubscription);
route('POST', '/api/subscription/seats', requireAuth, loadTier, handleAddSeat);
route('DELETE', '/api/subscription/seats/:discordId', requireAuth, loadTier, handleRemoveSeat);
route('GET', '/api/subscription/seats', requireAuth, loadTier, handleListSeats);

// ── Sessions PNGTuber ──
route('POST', '/api/sessions', requireAuth, loadTier, handleCreateSession);
route('GET', '/api/sessions', requireAuth, handleListSessions);
route('GET', '/api/sessions/:sessionId', requireAuth, handleGetPSession);
route('POST', '/api/sessions/:sessionId/end', requireAuth, handleEndSession);
route('POST', '/api/sessions/:sessionId/leave', requireAuth, handleLeaveSession);
route('GET', '/api/sessions/:sessionId/participants', requireAuth, handleSessionParticipants);

// ── Invitations ──
route('POST', '/api/invitations', requireAuth, handleCreateInvitation);
route('GET', '/api/invitations/:invitationId', handleGetInvitationDetails);
route('POST', '/api/invitations/:invitationId/accept', requireAuth, handleAcceptInvitation);
route('POST', '/api/invitations/:invitationId/decline', requireAuth, handleDeclineInvitation);
route('DELETE', '/api/invitations/:invitationId', requireAuth, handleRevokeInvitation);
route('GET', '/api/my-invitations', requireAuth, handleMyInvitations);

// ── Notifications ──
route('GET', '/api/notifications', requireAuth, handleGetNotifications);
route('POST', '/api/notifications/:id/read', requireAuth, handleMarkNotifRead);
route('POST', '/api/notifications/read-all', requireAuth, handleMarkAllRead);

// ── Page invitation (HTML) ──
route('GET', '/invite/:invitationId', handleInvitePage);

// ════════════════════════════════════════════════════════════════
// HTTP SERVER
// ════════════════════════════════════════════════════════════════
// REACT BUILD : si dist/index.html existe, l'app React est buildée.
// On la sert en priorité pour / et les assets Vite (/assets/*).
// viewer.html, positioner.html, styles.css restent dans SOURCE_ROOT.
const DIST_ROOT  = path.join(SOURCE_ROOT, 'dist');
const REACT_BUILT = fs.existsSync(path.join(DIST_ROOT, 'index.html'));

const AUTH_PAGES = ['/index.html', '/positioner.html', '/']; // pages nécessitant auth (admin ou client)
const CLIENT_PAGES = ['/client.html']; // redirige vers / (unifié)

httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);
    if (req.method === "OPTIONS") {
        res.writeHead(200, corsHeaders(req));
        res.end();
        return;
    }
    const matched = matchRoute(req.method, url.pathname);
    if (matched) {
        const ctx = { url, params: matched.params };
        try {
            for (const handler of matched.route.handlers) {
                const result = await handler(req, res, ctx);
                if (result === false) return; // middleware rejected
            }
        } catch (err) {
            console.error("Route error:", err);
            if (!res.headersSent) json(res, { error: "Erreur interne" }, 500, req);
        }
        return;
    }
    // Fichiers statiques
    let pathname = url.pathname;
    if (pathname === "/" || pathname === "") pathname = "/index.html";
    // Auth check pour les pages protégées (admin ou client)
    if (AUTH_ENABLED && AUTH_PAGES.includes(pathname)) {
        const session = getSession(req);
        if (!session || (session.role !== 'admin' && session.role !== 'client')) {
            res.writeHead(302, { Location: '/auth/login' });
            res.end();
            return;
        }
    }
    // Redirection client.html → / (interface unifiée)
    if (CLIENT_PAGES.includes(pathname)) {
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }
    // ── Résolution du fichier statique ──────────────────────────
    // Priorité : 1. dist/ (React build) pour /, /index.html, /assets/*
    //            2. SOURCE_ROOT pour viewer.html, positioner.html, styles.css
    let fp;
    if (REACT_BUILT && (pathname === '/index.html' || pathname === '/')) {
        fp = path.join(DIST_ROOT, 'index.html');
    } else if (REACT_BUILT && pathname.startsWith('/assets/')) {
        fp = path.resolve(path.join(DIST_ROOT, pathname));
        if (!fp.startsWith(path.resolve(DIST_ROOT))) { res.writeHead(403); res.end(); return; }
    } else {
        fp = path.resolve(path.join(STATIC_ROOT, pathname));
        if (!fp.startsWith(path.resolve(STATIC_ROOT))) { res.writeHead(403); res.end(); return; }
    }
    if (serveFile(res, fp, req)) return;
    // Fallback SPA : toute route inconnue → dist/index.html (React Router)
    if (REACT_BUILT && !pathname.includes('.')) {
        if (serveFile(res, path.join(DIST_ROOT, 'index.html'), req)) return;
    }
    res.writeHead(404);
    res.end("Not found");
}).listen(PORT, () => {
    console.log(`✓ HTTP → port ${PORT} (${BASE_URL})`);
    console.log(`  ├─ Config UI : ${BASE_URL}/index.html`);
    console.log(`  └─ API data  : ${BASE_URL}/levels`);
    if (AUTH_ENABLED) console.log(`  └─ Auth      : OAuth2 Discord activé`);
    else console.log(`  ⚠ Auth      : DÉSACTIVÉE — toutes les routes sont publiques (configurer DISCORD_CLIENT_ID pour sécuriser)`);
    if (!process.env.BASE_URL && !process.env.PNGTUBER_NO_BROWSER) openDefaultBrowser(`http://localhost:${PORT}/index.html`);
    // GC des viewer sessions expirées (toutes les 60s, en background)
    setInterval(() => {
        const now = Date.now();
        let cleaned = 0;
        for (const [sid, s] of viewerSessions) {
            if (now - s.createdAt > 30 * 86400000) { viewerSessions.delete(sid); cleaned++; }
        }
        if (cleaned) saveViewerSessions();
    }, 60_000);
});

// ════════════════════════════════════════════════════════════════
// WEBSOCKET SERVER — real-time audio levels pour OBS viewer
// ════════════════════════════════════════════════════════════════
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
const wsClients = new Set();

// ── DEBUG LOG RING BUFFER (60s à 20fps = 1200 entrées max) ──
const DEBUG_LOG_MAX = 1200;
const debugLogBuffer = [];

wss.on("connection", (ws, req) => {
    // Vérifier l'origin WebSocket
    if (AUTH_ENABLED) {
        const origin = req.headers.origin;
        if (origin) {
            const allowed = getAllowedOrigins();
            if (!allowed.includes(origin)) {
                ws.close(4003, 'Origin non autorisée');
                return;
            }
        }
    }
    // Authentifier la connexion WS via le cookie de session (si auth activée)
    let wsSession = null;
    if (AUTH_ENABLED) {
        wsSession = getSession(req);
    }
    const client = { ws, token: null, session: wsSession };
    wsClients.add(client);
    // Enregistrer pour les notifications WS si authentifié
    if (wsSession?.discordId) {
        if (!wsNotifClients.has(wsSession.discordId)) wsNotifClients.set(wsSession.discordId, new Set());
        wsNotifClients.get(wsSession.discordId).add(ws);
    }
    ws.on("message", (raw) => {
        try {
            const msg = JSON.parse(raw);
            if (msg.type === "subscribe" && typeof msg.token === "string") {
                client.token = msg.token;
            }
            // Auth via app token (mini-agent local)
            if (msg.type === "auth" && typeof msg.appToken === "string") {
                const hash = crypto.createHash('sha256').update(msg.appToken).digest('hex');
                const row = stmts.getAppToken.get(hash);
                if (row) {
                    client.session = { discordId: row.discord_id, role: getUserRole(row.discord_id) };
                    stmts.touchAppToken.run(hash);
                    // Enregistrer pour les notifications
                    if (!wsNotifClients.has(row.discord_id)) wsNotifClients.set(row.discord_id, new Set());
                    wsNotifClients.get(row.discord_id).add(ws);
                    ws.send(JSON.stringify({ type: 'auth-ok' }));
                } else {
                    ws.send(JSON.stringify({ type: 'auth-error', error: 'Token invalide' }));
                }
            }
            // Émotion manuelle via WS (basse latence) — nécessite auth si activée
            if (msg.type === "set-emotion" && typeof msg.token === "string") {
                const authorized = !AUTH_ENABLED || !client.session
                    ? !AUTH_ENABLED
                    : client.session.role === 'admin' || tokenFor(client.session.discordId) === msg.token;
                if (authorized && (uidFor(msg.token) || isKnownToken(msg.token))) {
                    setManualEmotion(msg.token, typeof msg.emotion === 'string' ? msg.emotion : null);
                }
            }
            if (msg.type === "debug-log") {
                debugLogBuffer.push({ ts: msg.ts, raw: msg.raw, smooth: msg.smooth, status: msg.status, emo: msg.emo, file: msg.file, state: msg.state });
                if (debugLogBuffer.length > DEBUG_LOG_MAX) debugLogBuffer.shift();
            }
        } catch {}
    });
    ws.on("close", () => {
        wsClients.delete(client);
        // Nettoyer les notifications WS
        const did = client.session?.discordId || wsSession?.discordId;
        if (did) wsNotifClients.get(did)?.delete(ws);
    });
    ws.on("error", () => {
        wsClients.delete(client);
        const did = client.session?.discordId || wsSession?.discordId;
        if (did) wsNotifClients.get(did)?.delete(ws);
    });
});

// Broadcast audio levels à tous les clients WS connectés
setInterval(() => {
    if (wsClients.size === 0) return;
    // Construire le payload complet une seule fois
    const guild = connectedGuildId ? client.guilds.cache.get(connectedGuildId) : null;
    const channel = connectedChannelId && guild ? guild.channels.cache.get(connectedChannelId) : null;
    const fullPayload = { _bot: {
        connected: botConnected,
        inVoice: !!currentConnection,
        channelName: channel?.name || null,
        guildName: guild?.name || null,
        updatedAt: new Date().toISOString()
    } };
    for (const [uid, d] of userLevels) {
        const tk = tokenFor(uid);
        const bl = userBaseline.get(uid);
        fullPayload[tk] = {
            db: d.db, rms: d.rms, freq: d.freq,
            freqDelta: d.freqDelta || { low: 0, mid: 0, high: 0 },
            zcr: d.zcr || 0, centroid: d.centroid || 0, energyVar: d.energyVar || 0,
            detectedEmotion: manualEmotion.get(tk)?.emotion || d.detectedEmotion || null,
            state: smoothAndClassifyState(tk, d.db),
            speaking: d.speaking, displayName: d.displayName, updated: d.updated,
            baseline: bl ? {
                dbMean: Math.round(bl.dbMean * 100) / 100,
                dbStd: Math.round(bl.dbStd * 100) / 100,
                freqMean: {
                    low: Math.round(bl.freqMean.low * 1000) / 1000,
                    mid: Math.round(bl.freqMean.mid * 1000) / 1000,
                    high: Math.round(bl.freqMean.high * 1000) / 1000,
                },
                freqStd: {
                    low: Math.round(bl.freqStd.low * 1000) / 1000,
                    mid: Math.round(bl.freqStd.mid * 1000) / 1000,
                    high: Math.round(bl.freqStd.high * 1000) / 1000,
                },
                sampleCount: bl.sampleCount,
            } : null,
        };
    }
    const fullJson = JSON.stringify(fullPayload);
    for (const c of wsClients) {
        if (c.ws.readyState !== 1) continue; // OPEN
        if (!c.token) {
            // Pas de filtre: envoyer tout
            c.ws.send(fullJson);
        } else {
            // Filtre par token: envoyer seulement les données de cet user
            const userData = fullPayload[c.token];
            if (userData) {
                c.ws.send(JSON.stringify({ _bot: fullPayload._bot, [c.token]: userData }));
            } else {
                c.ws.send(JSON.stringify({ _bot: fullPayload._bot }));
            }
        }
    }
}, 50); // 50ms = 20fps, bon compromis latence/performance

// Broadcast config update à tous les viewers WS abonnés à ce token
function broadcastConfigUpdate(token) {
    if (wsClients.size === 0) return;
    const row = stmts.getUserConfig.get(token);
    const config = row ? JSON.parse(row.config_json || '{}') : {};
    const msg = JSON.stringify({ type: 'config-update', token, config });
    for (const c of wsClients) {
        if (c.ws.readyState !== 1) continue;
        if (!c.token || c.token === token) {
            c.ws.send(msg);
        }
    }
}

// Broadcast frame update à tous les viewers WS abonnés à ce token
function broadcastFrameUpdate(token) {
    if (wsClients.size === 0) return;
    const msg = JSON.stringify({ type: 'frame-update', token });
    for (const c of wsClients) {
        if (c.ws.readyState !== 1) continue;
        if (!c.token || c.token === token) {
            c.ws.send(msg);
        }
    }
}

// ── Compatibilité tokenToUid/uidToToken ────────────────────────
// Proxies vers les fonctions du tokenService (tokenFor/uidFor).
// Supporte .get() et .delete() (delete = no-op sur le module, ok pour le GC local).
const tokenToUid = {
    get: (token) => uidFor(token),
    has: (token) => !!uidFor(token),
    delete: (_token) => {}, // le module gère son propre GC
};
const uidToToken = {
    get: (userId) => tokenFor(userId),
    has: (userId) => true, // tokenFor crée le token si nécessaire
    delete: (_userId) => {},
};

// ════════════════════════════════════════════════════════════════
// FFT
// ════════════════════════════════════════════════════════════════
function computeFreqBands(buffer) {
    // FFT: transforme le signal temporel en spectre fréquentiel.
    // On calcule ensuite une énergie moyenne par bande (low/mid/high) + centroïde spectral.
    if (buffer.length < AUDIO.fftSize) return { low: 0, mid: 0, high: 0, centroid: 0 };
    try {
        const mags = fftUtil.fftMag(fft(buffer.slice(0, AUDIO.fftSize))),
            binHz = AUDIO.sampleRate / AUDIO.fftSize,
            result = {};
        // binHz = résolution fréquentielle d'un bin FFT.
        // Exemple: 48000/1024 ≈ 46.875 Hz par bin.
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
        // Centroïde spectral : centre de gravité fréquentiel (Hz)
        let wSum = 0, mSum = 0;
        for (let i = 0; i < mags.length; i++) {
            wSum += mags[i] * (i * binHz);
            mSum += mags[i];
        }
        result.centroid = mSum > 0 ? Math.round(wSum / mSum) : 0;
        return result;
    } catch {
        return { low: 0, mid: 0, high: 0, centroid: 0 };
    }
}

// ════════════════════════════════════════════════════════════════
// AUDIO SUBSCRIPTION — pipeline d'analyse vocale
// ════════════════════════════════════════════════════════════════
// CHAÎNE DE TRAITEMENT :
//   Opus (Discord) → PCM 16-bit stéréo 48kHz → analyse → Map userLevels
//
// OPUS est le codec audio utilisé par Discord : haute qualité, faible latence.
// PRISM-MEDIA décode chaque frame Opus en PCM brut (octets → entiers 16-bit).
//
// ANALYSE toutes les 50ms (sampleInterval) :
//   1. RMS (Root Mean Square) → niveau sonore instantané
//      RMS = sqrt(moyenne des carrés des échantillons) — approxime le volume perçu
//   2. dB = 20 × log₁₀(RMS / 32768) — conversion en décibels (échelle logarithmique)
//      −100 dB = silence, 0 dB = maximum théorique
//   3. Fenêtre glissante (100ms) → lissage des micro-variations (évite le clignotement)
//   4. FFT (Fast Fourier Transform, 1024 points) → décomposition en fréquences
//      Chaque "bin" couvre binHz = 48000/1024 ≈ 46.9 Hz
//      → 3 bandes extraites : low (20-500 Hz), mid (500-2000 Hz), high (2000-10000 Hz)
//   5. ZCR (Zero Crossing Rate) → taux de passage par zéro → rugosité vocale
//   6. Energy Variance → variance du volume → stabilité (rire vs parole calme)
//   7. Centroïde spectral → fréquence "center of gravity" → brillance de la voix
//
// Toutes ces métriques alimentent la détection d'émotion (voir computeEmotion).
// userFreqHistory, userBaseline, recordingSessions importés depuis src/services/audioService.js
// userId → { dbMean, dbStd, freqMean:{low,mid,high}, freqStd:{low,mid,high}, sampleCount, lastUpdate, dirty }
const BASELINE_ALPHA = 0.005; // lissage lent (~10s convergence à 20Hz)

// Sauvegarde périodique de la baseline dans config_json (toutes les 60s)
setInterval(() => {
    for (const [userId, bl] of userBaseline) {
        if (!bl.dirty) continue;
        bl.dirty = false;
        const token = tokenFor(userId);
        try {
            const row = stmts.getUserConfig.get(token);
            const cfg = row ? JSON.parse(row.config_json || '{}') : {};
            cfg.calibration = {
                dbMean: Math.round(bl.dbMean * 100) / 100,
                dbStd: Math.round(bl.dbStd * 100) / 100,
                freqMean: {
                    low: Math.round(bl.freqMean.low * 1000) / 1000,
                    mid: Math.round(bl.freqMean.mid * 1000) / 1000,
                    high: Math.round(bl.freqMean.high * 1000) / 1000,
                },
                freqStd: {
                    low: Math.round(bl.freqStd.low * 1000) / 1000,
                    mid: Math.round(bl.freqStd.mid * 1000) / 1000,
                    high: Math.round(bl.freqStd.high * 1000) / 1000,
                },
                sampleCount: bl.sampleCount,
            };
            stmts.upsertUser.run(token, cfg.displayName || '???', JSON.stringify(cfg));
        } catch {}
    }
}, 60000);

// Charger la baseline depuis config_json au démarrage audio d'un user
function loadBaselineFromConfig(userId) {
    const token = tokenFor(userId);
    try {
        const row = stmts.getUserConfig.get(token);
        if (!row) return;
        const cfg = JSON.parse(row.config_json || '{}');
        if (!cfg.calibration || !cfg.calibration.dbMean) return;
        const cal = cfg.calibration;
        userBaseline.set(userId, {
            dbMean: cal.dbMean,
            dbStd: cal.dbStd || 0,
            freqMean: cal.freqMean || { low: 0, mid: 0, high: 0 },
            freqStd: cal.freqStd || { low: 0, mid: 0, high: 0 },
            sampleCount: cal.sampleCount || 0,
            lastUpdate: Date.now(),
            dirty: false,
        });
    } catch {}
}

function subscribeUser(receiver, userId, displayName) {
    // Charger baseline persistée si pas déjà en mémoire
    if (!userBaseline.has(userId)) loadBaselineFromConfig(userId);
    try {
        // Le flux opus est décodé en PCM 16-bit stéréo (48kHz).
        const opusStream = receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
        });
        const decoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 2,
            rate: AUDIO.sampleRate,
        });
        opusStream.pipe(decoder);
        let sumSq = 0,
            sampleCount = 0;
        const history = [];
        // Buffer circulaire pour les échantillons FFT (évite O(n) de Array.shift)
        const FREQ_BUF_CAP = AUDIO.fftSize * 2;
        const freqBuf = new Float32Array(FREQ_BUF_CAP);
        let freqBufLen = 0, freqBufStart = 0;
        if (!userFreqHistory.has(userId)) userFreqHistory.set(userId, []);
        const tick = setInterval(() => {
            if (!sampleCount) return;
            // RMS -> dB: mesure de niveau perçu. -100 dB sert de plancher "silence".
            const rms = Math.sqrt(sumSq / sampleCount) / 32768,
                db = rms > 0 ? 20 * Math.log10(rms) : -100,
                now = Date.now();
            // Fenêtre glissante pour lisser les micro-variations instantanées.
            history.push({ db, t: now });
            while (history.length && now - history[0].t > AUDIO.durationWindow)
                history.shift();
            const avgDb =
                history.reduce((a, v) => a + v.db, 0) / history.length;
            // Extraire les échantillons ordonnés du buffer circulaire pour FFT + ZCR
            const orderedBuf = new Float32Array(freqBufLen);
            for (let i = 0; i < freqBufLen; i++) {
                orderedBuf[i] = freqBuf[(freqBufStart + i) % FREQ_BUF_CAP];
            }
            const freqResult = computeFreqBands(orderedBuf);
            const freq = { low: freqResult.low, mid: freqResult.mid, high: freqResult.high };
            const centroid = freqResult.centroid;
            // ZCR (Zero Crossing Rate) — rugosité/agressivité de la voix
            let zc = 0;
            for (let i = 1; i < freqBufLen; i++) {
                if ((orderedBuf[i] >= 0) !== (orderedBuf[i - 1] >= 0)) zc++;
            }
            const zcr = freqBufLen > 1 ? Math.round(zc / (freqBufLen - 1) * 1000) / 1000 : 0;
            // Energy Variance — stabilité du volume (rire = instable, calme = stable)
            const dbVals = history.map(h => h.db);
            const dbMeanLocal = dbVals.reduce((a, v) => a + v, 0) / dbVals.length;
            const energyVar = dbVals.length > 1
                ? Math.round(dbVals.reduce((a, v) => a + (v - dbMeanLocal) ** 2, 0) / dbVals.length * 100) / 100
                : 0;
            // Calcul deltas fréquentiels (taux de changement)
            const fh = userFreqHistory.get(userId);
            fh.push({ ...freq, t: now });
            while (fh.length > 10) fh.shift();
            const freqDelta = { low: 0, mid: 0, high: 0 };
            if (fh.length >= 3) {
                const recent = fh.slice(-2);
                const older = fh.slice(0, Math.min(3, fh.length - 2));
                for (const band of ['low', 'mid', 'high']) {
                    const avgRecent = recent.reduce((s, b) => s + b[band], 0) / recent.length;
                    const avgOlder = older.reduce((s, b) => s + b[band], 0) / older.length;
                    freqDelta[band] = Math.round((avgRecent - avgOlder) * 1000) / 1000;
                }
            }
            // Mise à jour baseline vocale (EMA) — seulement quand on parle
            {
                const a = BASELINE_ALPHA;
                let bl = userBaseline.get(userId);
                if (!bl) {
                    bl = {
                        dbMean: avgDb, dbStd: 0,
                        freqMean: { ...freq }, freqStd: { low: 0, mid: 0, high: 0 },
                        sampleCount: 0, lastUpdate: now, dirty: false,
                    };
                    userBaseline.set(userId, bl);
                }
                bl.sampleCount++;
                const prevDbMean = bl.dbMean;
                bl.dbMean += a * (avgDb - bl.dbMean);
                bl.dbStd = Math.sqrt((1 - a) * (bl.dbStd ** 2 + a * (avgDb - prevDbMean) ** 2));
                for (const band of ['low', 'mid', 'high']) {
                    const prev = bl.freqMean[band];
                    bl.freqMean[band] += a * (freq[band] - prev);
                    bl.freqStd[band] = Math.sqrt((1 - a) * (bl.freqStd[band] ** 2 + a * (freq[band] - prev) ** 2));
                }
                bl.lastUpdate = now;
                bl.dirty = true;
            }

            // Détection émotion : manuelle (prioritaire) ou automatique (empreintes)
            const fpToken = uidToToken.get(userId) || tokenFor(userId);
            const manual = manualEmotion.get(fpToken);
            let detectedEmotion;
            if (manual) {
                if (Date.now() - manual.setAt > MANUAL_EMOTION_TIMEOUT_MS) {
                    manualEmotion.delete(fpToken);
                    detectedEmotion = detectEmotionFromFingerprints(fpToken, {
                        db: Math.round(avgDb * 100) / 100, freq, zcr, centroid, energyVar,
                    });
                } else {
                    detectedEmotion = manual.emotion;
                }
            } else {
                detectedEmotion = detectEmotionFromFingerprints(fpToken, {
                    db: Math.round(avgDb * 100) / 100, freq, zcr, centroid, energyVar,
                });
            }

            userLevels.set(userId, {
                db: Math.round(avgDb * 100) / 100,
                rms: Math.round(rms * 10000) / 10000,
                freq,
                freqDelta,
                zcr,
                centroid,
                energyVar,
                detectedEmotion,
                speaking: true,
                displayName,
                updated: now,
            });
            // Accumulation empreinte vocale si enregistrement actif
            const recToken = uidToToken.get(userId);
            const recSession = recToken ? recordingSessions.get(recToken) : null;
            if (recSession && now - recSession.startedAt < recSession.durationMs) {
                recSession.samples.push({
                    db: Math.round(avgDb * 100) / 100,
                    freq: { ...freq }, zcr, centroid, energyVar,
                });
            }
            sumSq = 0;
            sampleCount = 0;
        }, AUDIO.sampleInterval);
        decoder.on("data", (chunk) => {
            for (let i = 0; i < chunk.length; i += 2) {
                const s = chunk.readInt16LE(i);
                sumSq += s * s;
                sampleCount++;
                // Buffer circulaire O(1) au lieu de Array.shift() O(n)
                const writeIdx = (freqBufStart + freqBufLen) % FREQ_BUF_CAP;
                freqBuf[writeIdx] = s / 32768;
                if (freqBufLen < FREQ_BUF_CAP) freqBufLen++;
                else freqBufStart = (freqBufStart + 1) % FREQ_BUF_CAP;
            }
        });
        // Cleanup unique: centralise la fermeture des streams + reset état utilisateur.
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
                freqDelta: { low: 0, mid: 0, high: 0 },
                speaking: false,
                updated: Date.now(),
            });
            // Nettoyage différé des Maps mémoire (5 min après déconnexion)
            setTimeout(() => {
                // Ne nettoyer que si l'user n'est pas revenu (pas de données récentes)
                const cur = userLevels.get(userId);
                if (cur && !cur.speaking && Date.now() - cur.updated > 290_000) {
                    userFreqHistory.delete(userId);
                    const tk = uidToToken.get(userId) || tokenFor(userId);
                    emotionState.delete(tk);
                    stateSmooth.delete(tk);
                    manualEmotion.delete(tk);
                }
            }, 300_000);
        };
        opusStream.on("end", cleanup);
        opusStream.on("close", cleanup);
        decoder.on("end", cleanup);
        opusStream.on("error", (err) => {
            if (err?.code === "GenericFailure") return;
            console.error(`opusStream error [${userId}]:`, err.message || err);
        });
        decoder.on("error", (err) => {
            if (err?.message?.includes("corrupted")) return; // premiers paquets opus — normal
            console.error(`decoder error:`, err);
        });
    } catch (err) {
        console.error(`Audio error:`, err);
    }
}

// ════════════════════════════════════════════════════════════════
// DISCORD CLIENT
// ════════════════════════════════════════════════════════════════

// Reusable voice join logic — used by both !join command and /api/voice/join
async function connectToVoiceChannel(guildId, channelId) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error("Serveur non trouvé");
    const channel = guild.channels.cache.get(channelId);
    if (!channel) throw new Error("Canal non trouvé");

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
    });
    currentConnection = connection;
    connectedGuildId = guild.id;
    connectedChannelId = channel.id;

    // Debug: log chaque transition d'état de la connexion vocale
    connection.on("stateChange", (oldState, newState) => {
        console.log(`🔗 Voice: ${oldState.status} → ${newState.status}`);
    });

    // Attendre que la connexion vocale soit prête (UDP + encryption)
    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (err) {
        console.error("❌ Timeout connexion vocale:", err.message);
        console.error("   Status actuel:", connection.state.status);
        disconnectVoice();
        throw new Error("La connexion vocale n'a pas pu être établie");
    }
    console.log(`📍 Joined: ${guild.name} / ${channel.name}`);
    saveVoiceState();

    const receiver = connection.receiver;
    // Pré-enregistrer tous les membres non-bot dans userLevels (détection instantanée)
    const members = channel.members.filter((m) => !m.user.bot);
    for (const [, m] of members) {
        tokenFor(m.id);
        const dn = m.displayName || m.user?.username || "???";
        const existing = readCfg(m.id) || {};
        if (existing.displayName !== dn) writeCfg(m.id, { ...existing, displayName: dn });
        if (!userLevels.has(m.id)) {
            userLevels.set(m.id, { db: -100, rms: 0, freq: { low: 0, mid: 0, high: 0 }, freqDelta: { low: 0, mid: 0, high: 0 }, speaking: false, displayName: dn, updated: Date.now() });
        }
    }
    // Tracker les subscriptions actives pour éviter les doublons
    const activeSubscriptions = new Set();
    receiver.speaking.on("start", (userId) => {
        const member = guild.members.cache.get(userId);
        const displayName = member?.displayName || member?.user?.username || "???";
        if (!activeSubscriptions.has(userId)) {
            console.log(`🔊 ${displayName}`);
            activeSubscriptions.add(userId);
        }
        tokenFor(userId);
        const existing = readCfg(userId) || {};
        if (existing.displayName !== displayName)
            writeCfg(userId, { ...existing, displayName });
        subscribeUser(receiver, userId, displayName);
    });
    receiver.speaking.on("end", (userId) => {
        activeSubscriptions.delete(userId);
        const prev = userLevels.get(userId) || {};
        userLevels.set(userId, {
            ...prev,
            db: -100,
            rms: 0,
            freq: { low: 0, mid: 0, high: 0 },
            freqDelta: { low: 0, mid: 0, high: 0 },
            speaking: false,
            updated: Date.now(),
        });
    });

    return { guild, channel, members };
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});
// ── Slash Commands ─────────────────────────────────────────────
const slashCommands = [
    new SlashCommandBuilder()
        .setName('join')
        .setDescription('Rejoindre ton salon vocal pour animer ton PNGTuber'),
    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Ouvrir le panneau de configuration web'),
    new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Déconnecter le bot du salon vocal'),
].map(c => c.toJSON());

client.once("clientReady", async () => {
    botConnected = true;
    tokenRejected = false;
    console.log(`✓ Bot ready — ${client.user.tag}`);
    console.log("── Voice dependency report ──");
    console.log(generateDependencyReport());

    // Enregistrer les slash commands par serveur (instantané, pas de délai de propagation)
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        // Nettoyer les commandes globales éventuelles
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] }).catch(() => {});
        // Enregistrer sur chaque serveur du bot
        for (const [guildId, guild] of client.guilds.cache) {
            try {
                await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: slashCommands });
                console.log(`✓ Slash commands → ${guild.name}`);
            } catch (err) {
                console.warn(`⚠ Slash commands ${guild.name}: ${err.message}`);
            }
        }
    } catch (err) {
        console.warn("⚠ Échec enregistrement slash commands:", err.message);
    }

    // Auto-reconnect au dernier channel vocal si l'option est activée
    const voiceState = loadVoiceState();
    if (voiceState.autoReconnect && voiceState.guildId && voiceState.channelId) {
        console.log(`🔄 Auto-reconnect → guild:${voiceState.guildId} channel:${voiceState.channelId}`);
        try {
            await connectToVoiceChannel(voiceState.guildId, voiceState.channelId);
            console.log("✓ Auto-reconnect réussi");
        } catch (err) {
            console.warn("⚠ Auto-reconnect échoué:", err.message);
        }
    }
});
client.on("error", (err) => {
    if (err?.message?.includes("TOKEN_INVALID") || err?.code === 4004) {
        tokenRejected = true;
        console.error("❌ Token Discord invalide");
    }
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const cmd = message.content.trim().toLowerCase();
    if (cmd === "!join") {
        const channel = message.member?.voice.channel;
        if (!channel)
            return message.reply("❌ Tu dois être dans un canal vocal.");
        try {
            const result = await connectToVoiceChannel(channel.guild.id, channel.id);
            const baseUrl = getPublicUrl();
            const guildId = channel.guild.id;
            const links = [...result.members.values()]
                .filter(m => isAvatarAllowed(tokenFor(m.id), guildId))
                .map((m) => {
                    const t = tokenFor(m.id);
                    return `  • **${m.displayName || m.user?.username || "???"}** → \`${baseUrl}/viewer.html?t=${t}&guild=${guildId}\``;
                })
                .join("\n");
            return message.reply(
                `✅ Connecté à **${result.channel.name}** !\n\n` +
                    `⚙️ Config : \`${baseUrl}\`\n\n` +
                    `🎬 Viewers :\n${links || "  (aucun membre autorisé)"}`,
            );
        } catch (err) {
            console.error("Join error:", err);
            return message.reply("❌ Impossible de rejoindre le canal.");
        }
    }

    if (cmd === "!disconnect") {
        if (!currentConnection) return message.reply("❌ Pas connecté.");
        disconnectVoice();
        return message.reply("👋 Déconnecté du canal vocal.");
    }

    if (cmd === "!status") {
        const lines =
            [...userLevels.entries()]
                .map(
                    ([, v]) =>
                        `  • **${v.displayName || "???"}** — ${v.db} dB ${v.speaking ? "🎙" : "🔇"}`,
                )
                .join("\n") || "  (aucun)";
        return message.reply(
            `**Bot** Discord:${botConnected ? "✅" : "❌"} Voice:${connectedGuildId ? "✅" : "❌"}\n${lines}`,
        );
    }
});

// ── Slash command handler ──────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'join') {
        const channel = interaction.member?.voice?.channel;
        if (!channel) {
            return interaction.reply({ content: "❌ Tu dois être dans un salon vocal.", ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            const result = await connectToVoiceChannel(channel.guild.id, channel.id);
            const baseUrl = getPublicUrl();
            const guildId = channel.guild.id;
            const authorized = [];
            const denied = [];
            for (const [, m] of result.members) {
                const t = tokenFor(m.id);
                const name = m.displayName || m.user?.username || "???";
                if (isAvatarAllowed(t, guildId)) {
                    authorized.push(`✅ **${name}**\n\`\`\`\n${baseUrl}/viewer.html?t=${t}&guild=${guildId}\n\`\`\``);
                } else {
                    denied.push(`🔒 **${name}** — non autorisé sur ce serveur`);
                }
            }
            const parts = [`✅ Connecté à **${result.channel.name}** !`, `⚙️ Config : \`${baseUrl}\``];
            if (authorized.length) parts.push(`\n🎬 **Viewers autorisés :**\n${authorized.join("\n")}`);
            if (denied.length) parts.push(`\n${denied.join("\n")}`);
            if (!authorized.length && !denied.length) parts.push("\n(aucun membre)");
            return interaction.editReply(parts.join("\n"));
        } catch (err) {
            return interaction.editReply("❌ Impossible de rejoindre le salon.");
        }
    }

    if (commandName === 'config') {
        const baseUrl = getPublicUrl();
        return interaction.reply({
            content: `🔧 **Panneau de configuration PNGTuber**\n\n` +
                `Clique sur le lien ci-dessous pour configurer ton avatar, tes frames et tes seuils audio :\n` +
                `👉 ${baseUrl}`,
            ephemeral: true
        });
    }

    if (commandName === 'disconnect') {
        if (!currentConnection) {
            return interaction.reply({ content: "❌ Le bot n'est pas connecté à un salon vocal.", ephemeral: true });
        }
        disconnectVoice();
        return interaction.reply({ content: "👋 Déconnecté du salon vocal.", ephemeral: true });
    }
});

function getPublicUrl() {
    return BASE_URL;
}

client.on("voiceStateUpdate", (oldState, newState) => {
    // ── Mode suivi : si la cible change de canal, suivre ──
    if (followTarget && newState.id === followTarget.discordId) {
        if (newState.channelId && newState.channelId !== oldState.channelId) {
            const newChannel = newState.guild.channels.cache.get(newState.channelId);
            if (newChannel) {
                const botMember = newState.guild.members.me;
                const canConnect = botMember && newChannel.permissionsFor(botMember).has(PermissionFlagsBits.Connect);
                if (canConnect) {
                    connectToVoiceChannel(newState.guild.id, newState.channelId)
                        .then(() => console.log(`👣 Suivi: ${newState.member?.displayName} → ${newChannel.name}`))
                        .catch(() => broadcastFollowError(newChannel.name, followTarget.displayName));
                } else {
                    broadcastFollowError(newChannel.name, followTarget.displayName);
                }
            }
        }
        // Si la cible quitte le vocal complètement
        if (!newState.channelId) {
            console.log(`👣 Cible quitte le vocal, suivi désactivé`);
            followTarget = null;
            broadcastFollowStatus();
        }
    }

    // ── Déconnexion auto si le bot est seul ──
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
            console.log("🔇 Seul → déconnexion auto");
            disconnectVoice();
        }
    }, 5000);
});

if (!process.env.DISCORD_TOKEN) {
    console.warn(
        `⚠ DISCORD_TOKEN absent — configure-le via ${BASE_URL}/index.html`,
    );
} else {
    client.login(process.env.DISCORD_TOKEN).catch((err) => {
        tokenRejected = true;
        console.error("❌ Login échoué:", err.message);
    });
}
console.log("✓ Bot initialized");

// ════════════════════════════════════════════════════════════════
// SIGNAUX DE TERMINAISON
// ════════════════════════════════════════════════════════════════
process.on("SIGINT", () => shutdownApp());
process.on("SIGTERM", () => shutdownApp());
