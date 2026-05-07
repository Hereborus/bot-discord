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

import {
    joinVoiceChannel,
    VoiceConnectionStatus,
    entersState,
    generateDependencyReport,
} from "@discordjs/voice";
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { spawn } from "child_process";
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
import { handleAuthLogin, handleAuthCallback, handleAuthLogout, handleAuthMe, handleTestMode } from './src/routes/auth.js';
import {
    handleGuilds, handleGuildChannels, handleGuildMembers,
    handleVoiceJoin, handleVoiceDisconnect, handleVoiceStatus,
    handleFollowStatus, handleVoiceFollow, handleVoiceUnfollow,
    handleGetAutoReconnect, handleSetAutoReconnect,
} from './src/routes/voice.js';
import {
    deviceAuthRequests,
    handleDeviceAuthorize, handleDevicePoll,
    handleDeviceVerifyPage, handleDeviceVerifySubmit,
    handleListAppTokens, handleRevokeAppToken,
} from './src/routes/device.js';
import { client, initBot, loginBot } from './src/bot/discord.js';
import {
    handleGetUserConfig, handlePostUserConfig,
    handleKnownUsers, handleBotToken,
    validateUserConfig, ALLOWED_CONFIG_KEYS,
} from './src/routes/config.js';
import {
    handleGetPermissions, handleSetPermission, handleDeletePermission,
    handleGetMyPermissions, handleMyToken,
    handleGetAvatarPerms, handleSetAvatarPerm, isAvatarAllowed as isAvatarAllowedFromModule,
} from './src/routes/permissions.js';
import {
    handleUpload, handleReorder, handleDeleteFrame, handleMoveFrame,
} from './src/routes/upload.js';
import {
    manualEmotion, setManualEmotion,
    handleGetEmotion, handleSetEmotion,
} from './src/routes/emotion.js';
import {
    computeFreqBands, subscribeUser,
    loadBaselineFromConfig, startBaselinePersistence,
} from './src/bot/audio.js';
// La calibration vocale (fingerprints, empreintes) est archivée dans src/bot/calibration.js (dormant, non importé)

const SOURCE_ROOT = process.cwd();
const STATIC_ROOT = SOURCE_ROOT;
const DATA_ROOT = process.env.DATA_ROOT || SOURCE_ROOT;

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

const IMAGES_DIR = path.join(DATA_ROOT, "images");
const META_DIR = path.join(DATA_ROOT, "meta");
const ENV_PATH = path.join(DATA_ROOT, ".env");

if (!fs.existsSync(DATA_ROOT)) fs.mkdirSync(DATA_ROOT, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

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
// getUserRole importé depuis src/services/authService.js
// loadPermissions, handleGetPermissions, handleSetPermission, handleDeletePermission,
// handleGetMyPermissions, handleMyToken, handleGetAvatarPerms, handleSetAvatarPerm,
// isAvatarAllowed → src/routes/permissions.js

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
// validateUserConfig, ALLOWED_CONFIG_KEYS → src/routes/config.js
// TIER_LIMITS, getUserTier, loadTier, requirePremium importés depuis src/services/tierService.js

// ════════════════════════════════════════════════════════════════
// MULTIPART PARSER → src/routes/upload.js (parser inclus dans le module)
// ════════════════════════════════════════════════════════════════
// SESSIONS & AUTHENTIFICATION OAuth2 Discord
// ════════════════════════════════════════════════════════════════
// sessions, oauthStates, AUTH_ENABLED, parseCookies, getSession,
// createSession, setSessionCookie, getUserRole importés depuis src/services/authService.js
// requireAuth, requireAdmin, requireClientOrAdmin importés depuis src/http/middleware.js

// deviceAuthRequests est géré dans src/routes/device.js (son nettoyage périodique aussi)

// Nettoyage périodique DB (sessions/auth nettoyées par authService.js, device auth par device.js)
setInterval(() => {
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

// POST /bot-token → src/routes/config.js (handleBotToken) — wrapper ci-dessous

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

// GET /user-config/:token → src/routes/config.js (handleGetUserConfig)
// POST /user-config/:token → src/routes/config.js (handlePostUserConfig)

// ── Émotion manuelle (override via raccourcis clavier / agent local) ──
// manualEmotion, setManualEmotion, handleGetEmotion, handleSetEmotion → src/routes/emotion.js
// Note : code de calibration vocale archivé dans src/bot/calibration.js (dormant)

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

// GET /api/emotion/:token → src/routes/emotion.js (handleGetEmotion)
// POST /api/emotion/:token → src/routes/emotion.js (handleSetEmotion)
// GET /known-users → src/routes/config.js (handleKnownUsers)

// POST /upload → src/routes/upload.js (handleUpload)
// POST /reorder → src/routes/upload.js (handleReorder)
// POST /delete-frame → src/routes/upload.js (handleDeleteFrame)
// POST /move-frame → src/routes/upload.js (handleMoveFrame)

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

// ── Auth route handlers — délégués à src/routes/auth.js ─────────
// handleAuthLogin, handleAuthCallback, handleAuthLogout, handleAuthMe,
// handleTestMode importés depuis src/routes/auth.js
// Wrappers pour injecter rateLimit dans les handlers qui en ont besoin.
const _handleAuthLogin = (req, res, ctx) => handleAuthLogin(req, res, ctx, rateLimit);

// ── Permission API handlers → src/routes/permissions.js ──────────
// handleGetPermissions, handleSetPermission, handleDeletePermission,
// handleGetMyPermissions, handleMyToken, handleGetAvatarPerms,
// handleSetAvatarPerm, isAvatarAllowed → src/routes/permissions.js

// ── Voice Browser API handlers — délégués à src/routes/voice.js ──
// handleGuilds, handleGuildChannels, handleGuildMembers, handleVoiceJoin,
// handleVoiceDisconnect, handleVoiceStatus, handleFollowStatus,
// handleVoiceFollow, handleVoiceUnfollow, handleGetAutoReconnect,
// handleSetAutoReconnect importés depuis src/routes/voice.js.
// Chaque handler reçoit un objet de dépendances (client, état, callbacks).

// ── Mode suivi — broadcast WebSocket ────────────────────────────
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
function setFollowTarget(target) { followTarget = target; }

// Objet d'état vocal passé aux handlers voice (évite les closures imbriquées)
function getVoiceDeps() {
    return {
        client, botConnected, connectedGuildId, connectedChannelId,
        currentConnection, followTarget, followError,
        connectToVoiceChannel, disconnectVoice,
        broadcastFollowStatus, broadcastFollowError, setFollowTarget,
    };
}

// Wrappers qui injectent les dépendances d'état courant
const _handleGuilds         = (req, res, ctx) => handleGuilds(req, res, ctx, getVoiceDeps());
const _handleGuildChannels  = (req, res, ctx) => handleGuildChannels(req, res, ctx, getVoiceDeps());
const _handleGuildMembers   = (req, res, ctx) => handleGuildMembers(req, res, ctx, getVoiceDeps());
const _handleVoiceJoin      = (req, res, ctx) => handleVoiceJoin(req, res, ctx, getVoiceDeps());
const _handleVoiceDisconnect= (req, res, ctx) => handleVoiceDisconnect(req, res, ctx, getVoiceDeps());
const _handleVoiceStatus    = (req, res, ctx) => handleVoiceStatus(req, res, ctx, getVoiceDeps());
const _handleFollowStatus   = (req, res, ctx) => handleFollowStatus(req, res, ctx, getVoiceDeps());
const _handleVoiceFollow    = (req, res, ctx) => handleVoiceFollow(req, res, ctx, getVoiceDeps());
const _handleVoiceUnfollow  = (req, res, ctx) => handleVoiceUnfollow(req, res, ctx, getVoiceDeps());

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
// DEVICE AUTH FLOW — délégué à src/routes/device.js
// ════════════════════════════════════════════════════════════════
// deviceAuthRequests, handleDeviceAuthorize, handleDevicePoll,
// handleDeviceVerifyPage, handleDeviceVerifySubmit,
// handleListAppTokens, handleRevokeAppToken importés depuis src/routes/device.js.
// Wrappers pour injecter rateLimit dans les handlers qui en ont besoin.
const _handleDeviceAuthorize    = (req, res, ctx) => handleDeviceAuthorize(req, res, ctx, rateLimit);
const _handleDevicePoll         = (req, res, ctx) => handleDevicePoll(req, res, ctx, rateLimit);
const _handleDeviceVerifySubmit = (req, res, ctx) => handleDeviceVerifySubmit(req, res, ctx, rateLimit);

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
// WRAPPERS — injection des dépendances dans les handlers extraits
// ════════════════════════════════════════════════════════════════

// isAvatarAllowed : wrapper local autour de src/routes/permissions.js
// Utilisé dans handleFrames (ci-dessus) et passé à initBot.
function isAvatarAllowed(token, guildId) {
    return isAvatarAllowedFromModule(stmts, token, guildId);
}

// Dépendances communes pour les handlers config, permissions, upload, emotion
function getConfigDeps()      { return { stmts, isKnownToken, broadcastConfigUpdate }; }
function getPermissionsDeps() { return { stmts, client, botConnected }; }
function getUploadDeps()      { return { stmts, db, IMAGES_DIR, rateLimit, getClientIp, isKnownToken, broadcastFrameUpdate }; }
function getEmotionDeps()     { return { isKnownToken }; }

// Wrappers handlers config
const _handleGetUserConfig  = (req, res, ctx) => handleGetUserConfig(req, res, ctx, getConfigDeps());
const _handlePostUserConfig = (req, res, ctx) => handlePostUserConfig(req, res, ctx, getConfigDeps());
// uidToToken n'est pas un vrai Map itérable — on reconstruit un itérable depuis userLevels
const _handleKnownUsers = (req, res, ctx) => {
    const activeUidToToken = [...userLevels.keys()].map(uid => [uid, tokenFor(uid)]);
    return handleKnownUsers(req, res, ctx, { stmts, uidToToken: activeUidToToken });
};
const _handleBotToken       = (req, res, ctx) => handleBotToken(req, res, ctx, { setEnvKey });

// Wrappers handlers permissions
const _handleGetPermissions    = (req, res, ctx) => handleGetPermissions(req, res, ctx, getPermissionsDeps());
const _handleSetPermission     = (req, res, ctx) => handleSetPermission(req, res, ctx, getPermissionsDeps());
const _handleDeletePermission  = (req, res, ctx) => handleDeletePermission(req, res, ctx, getPermissionsDeps());
const _handleGetMyPermissions  = (req, res, ctx) => handleGetMyPermissions(req, res, ctx, getPermissionsDeps());
const _handleGetAvatarPerms    = (req, res, ctx) => handleGetAvatarPerms(req, res, ctx, getPermissionsDeps());
const _handleSetAvatarPerm     = (req, res, ctx) => handleSetAvatarPerm(req, res, ctx, getPermissionsDeps());

// Wrappers handlers upload
const _handleUpload      = (req, res, ctx) => handleUpload(req, res, ctx, getUploadDeps());
const _handleReorder     = (req, res, ctx) => handleReorder(req, res, ctx, { stmts, db, isKnownToken });
const _handleDeleteFrame = (req, res, ctx) => handleDeleteFrame(req, res, ctx, { stmts, IMAGES_DIR, isKnownToken, broadcastFrameUpdate });
const _handleMoveFrame   = (req, res, ctx) => handleMoveFrame(req, res, ctx, { stmts, IMAGES_DIR, isKnownToken, broadcastFrameUpdate });

// Wrappers handlers emotion
const _handleSetEmotion = (req, res, ctx) => handleSetEmotion(req, res, ctx, getEmotionDeps());

// ════════════════════════════════════════════════════════════════
// ENREGISTREMENT DES ROUTES
// ════════════════════════════════════════════════════════════════

// Auth routes (publiques) — handlers depuis src/routes/auth.js
route('GET', '/auth/login', _handleAuthLogin);
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
route('GET', '/user-config/:token', _handleGetUserConfig);
route('GET', '/known-users', _handleKnownUsers);
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
route('POST', '/api/emotion/:token', requireAuth, requireClientOrAdmin, _handleSetEmotion);

// Viewer session (auth requise pour créer, public pour résoudre)
route('POST', '/api/viewer-session', requireAuth, requireClientOrAdmin, handleCreateViewerSession);

// Routes protégées — client-or-admin (owner can edit own data)
route('POST', '/upload', requireAuth, parseBodyToken, requireClientOrAdmin, loadTier, _handleUpload);
route('POST', '/reorder', requireAuth, parseBodyToken, requireClientOrAdmin, _handleReorder);
route('POST', '/delete-frame', requireAuth, parseBodyToken, requireClientOrAdmin, _handleDeleteFrame);
route('POST', '/move-frame', requireAuth, parseBodyToken, requireClientOrAdmin, _handleMoveFrame);
route('POST', '/user-config/:token', requireAuth, requireClientOrAdmin, loadTier, _handlePostUserConfig);

// Calibration routes — archivées dans src/bot/calibration.js (module dormant, non importé)

// Routes protégées — admin only
route('POST', '/bot-token', requireAuth, requireAdmin, _handleBotToken);
route('POST', '/delete-user/:token', requireAuth, requireAdmin, handleDeleteUser);

// Permission API
route('GET', '/api/permissions/me', requireAuth, _handleGetMyPermissions);
route('GET', '/api/permissions', requireAuth, requireAdmin, _handleGetPermissions);
route('POST', '/api/permissions', requireAuth, requireAdmin, _handleSetPermission);
route('DELETE', '/api/permissions/:discordId', requireAuth, requireAdmin, _handleDeletePermission);
route('GET', '/api/my-token', requireAuth, handleMyToken);

// Avatar permissions per server
route('GET', '/api/avatar-permissions/:token', requireAuth, _handleGetAvatarPerms);
route('POST', '/api/avatar-permissions', requireAuth, _handleSetAvatarPerm);

// Voice Browser API — handlers depuis src/routes/voice.js (via wrappers)
route('GET', '/api/guilds/:guildId/channels', requireAuth, _handleGuildChannels);
route('GET', '/api/guilds/:guildId/members', requireAuth, requireAdmin, _handleGuildMembers);
route('GET', '/api/guilds', requireAuth, _handleGuilds);
route('POST', '/api/voice/join', requireAuth, _handleVoiceJoin);
route('POST', '/api/voice/disconnect', requireAuth, requireAdmin, _handleVoiceDisconnect);
route('GET', '/api/voice/status', requireAuth, _handleVoiceStatus);

// Auto-reconnect — handlers depuis src/routes/voice.js
route('GET', '/api/auto-reconnect', requireAuth, requireAdmin, handleGetAutoReconnect);
route('POST', '/api/auto-reconnect', requireAuth, requireAdmin, handleSetAutoReconnect);

// Follow mode — handlers depuis src/routes/voice.js (via wrappers)
route('POST', '/api/voice/follow', requireAuth, requireAdmin, _handleVoiceFollow);
route('POST', '/api/voice/unfollow', requireAuth, requireAdmin, _handleVoiceUnfollow);
route('GET', '/api/voice/follow-status', requireAuth, _handleFollowStatus);

// DB Browser API (admin only)
route('GET', '/api/db/stats', requireAuth, requireAdmin, handleDbStats);
route('GET', '/api/db/frames', requireAuth, requireAdmin, handleDbFrames);

// ── Device Auth (mini-agent local) — handlers depuis src/routes/device.js ──
route('POST', '/api/device/authorize', _handleDeviceAuthorize);
route('POST', '/api/device/poll', _handleDevicePoll);
route('GET', '/api/device/verify', requireAuth, handleDeviceVerifyPage);
route('POST', '/api/device/verify', requireAuth, _handleDeviceVerifySubmit);
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
// viewer.html, styles.css restent dans SOURCE_ROOT (usage OBS standalone).
// positioner.html supprimé — remplacé par le composant React /positioner.
const DIST_ROOT  = path.join(SOURCE_ROOT, 'dist');
const REACT_BUILT = fs.existsSync(path.join(DIST_ROOT, 'index.html'));

const AUTH_PAGES = ['/index.html', '/']; // pages nécessitant auth (admin ou client)
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
    // 1. Assets Vite (dist/assets/*) — servis depuis DIST_ROOT
    if (REACT_BUILT && pathname.startsWith('/assets/')) {
        const fpAsset = path.resolve(path.join(DIST_ROOT, pathname));
        if (fpAsset.startsWith(path.resolve(DIST_ROOT)) && serveFile(res, fpAsset, req)) return;
    }
    // 2. Fichiers physiques depuis SOURCE_ROOT (styles.css, viewer.html, images/, etc.)
    //    Servis en priorité : le SPA fallback ne doit pas intercepter les vrais fichiers.
    const fpReal = path.resolve(path.join(STATIC_ROOT, pathname));
    if (!fpReal.startsWith(path.resolve(STATIC_ROOT))) { res.writeHead(403); res.end(); return; }
    if (serveFile(res, fpReal, req)) return;
    // 3. SPA fallback React : toute route inconnue → dist/index.html (React Router côté client)
    if (REACT_BUILT) {
        const fpSpa = path.join(DIST_ROOT, 'index.html');
        if (serveFile(res, fpSpa, req)) return;
    }
    res.writeHead(404);
    res.end("Not found");
}).listen(PORT, () => {
    console.log(`✓ HTTP → port ${PORT} (${BASE_URL})`);
    console.log(`  ├─ Config UI : ${BASE_URL}/index.html`);
    console.log(`  └─ API data  : ${BASE_URL}/levels`);
    if (AUTH_ENABLED) console.log(`  └─ Auth      : OAuth2 Discord activé`);
    else console.log(`  ⚠ Auth      : DÉSACTIVÉE — toutes les routes sont publiques (configurer DISCORD_CLIENT_ID pour sécuriser)`);
    if (!process.env.BASE_URL && !process.env.PNGTUBER_NO_BROWSER) openDefaultBrowser(`http://localhost:${PORT}`);
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
// FFT + AUDIO PIPELINE — délégués à src/bot/audio.js
// ════════════════════════════════════════════════════════════════
// computeFreqBands, subscribeUser, loadBaselineFromConfig,
// startBaselinePersistence importés depuis src/bot/audio.js.

// Démarrer la sauvegarde périodique de la baseline vocale (toutes les 60s)
startBaselinePersistence(stmts.getUserConfig.get.bind(stmts.getUserConfig), stmts.upsertUser.run.bind(stmts.upsertUser));

// Wrapper subscribeUser qui injecte les dépendances (manualEmotion, getUserConfig, upsertUser)
function _subscribeUser(receiver, userId, displayName) {
    return subscribeUser(receiver, userId, displayName, {
        manualEmotion,
        getUserConfig: (token) => stmts.getUserConfig.get(token),
        upsertUser:    (token, dn, cfg) => stmts.upsertUser.run(token, dn, cfg),
    });
}

// Shim conservé pour compatibilité avec les usages internes de computeFreqBands
// (smoothAndClassifyState, handleLevels) — la fonction est importée depuis src/bot/audio.js.

// computeFreqBands importé depuis src/bot/audio.js

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
    // Absorber les erreurs réseau Discord (ex: IP discovery / UDP socket) — évite un crash fatal
    connection.on("error", (err) => {
        console.error("⚠ Voice connection error (non-fatal):", err.message);
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
        _subscribeUser(receiver, userId, displayName);
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

// client, slashCommands, handlers d'événements Discord → src/bot/discord.js

// ── Initialisation du bot Discord — handlers via src/bot/discord.js ──────────
// getState : fournit l'état courant (closures sur les variables locales de index.js)
function getState() {
    return { followTarget, currentConnection, botConnected, connectedGuildId };
}

initBot({
    connectToVoiceChannel,
    disconnectVoice,
    isAvatarAllowed,
    getState,
    broadcastFollowStatus,
    broadcastFollowError,
    setFollowTarget,
    BASE_URL,
    onBotReady: () => {
        botConnected = true;
        tokenRejected = false;
        console.log("── Voice dependency report ──");
        console.log(generateDependencyReport());
    },
    onTokenRejected: () => { tokenRejected = true; },
});

if (!process.env.DISCORD_TOKEN) {
    console.warn(`⚠ DISCORD_TOKEN absent — configure-le via ${BASE_URL}/index.html`);
} else {
    loginBot(process.env.DISCORD_TOKEN, () => { tokenRejected = true; });
}
console.log("✓ Bot initialized");

// ════════════════════════════════════════════════════════════════
// SIGNAUX DE TERMINAISON
// ════════════════════════════════════════════════════════════════
process.on("SIGINT", () => shutdownApp());
process.on("SIGTERM", () => shutdownApp());
