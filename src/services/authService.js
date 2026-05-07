/**
 * Auth Service — sessions OAuth2, cookies signés, Bearer tokens
 * ==============================================================
 * Gère deux mécanismes d'authentification :
 *   1. Sessions navigateur : cookie "pngtuber_session" signé par HMAC
 *      pour prévenir la falsification côté client.
 *   2. Bearer tokens : app tokens (Device Auth Flow) stockés en DB
 *      sous forme de hash SHA-256 (jamais le token brut en DB).
 *
 * timingSafeEqual est utilisé pour la vérification des signatures
 * afin d'éviter les attaques par analyse du temps de réponse.
 *
 * Dépendances : node:crypto, node:fs, node:path, db/repos/permissions, db/repos/appTokens
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { permissions } from '../db/repos/permissions.js';
import { appTokens } from '../db/repos/appTokens.js';

// AUTH_ENABLED = false si DISCORD_CLIENT_ID absent → toutes les routes sont accessibles sans login
export const AUTH_ENABLED = Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);

// ── Garde-fou production ────────────────────────────────────────
// Refuse de démarrer en NODE_ENV=production sans auth, sauf override explicite.
// Empêche un déploiement accidentel sans DISCORD_CLIENT_ID d'exposer admin au monde.
if (!AUTH_ENABLED && process.env.NODE_ENV === 'production' && process.env.ALLOW_NO_AUTH !== 'true') {
    console.error(`
═══════════════════════════════════════════════════════════════
  REFUS DE DEMARRAGE — Auth desactivee en mode production
═══════════════════════════════════════════════════════════════
  DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET absents.
  Sans ces variables, AUCUNE authentification n'est appliquee
  et toutes les routes admin seraient publiques.

  Recommande :
    Configurer DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET dans .env

  Override explicite (a vos risques, dev seulement) :
    ALLOW_NO_AUTH=true npm start
═══════════════════════════════════════════════════════════════
`);
    process.exit(1);
}

// ── SESSION_SECRET persistant ───────────────────────────────────
// Si non défini en env, on persiste un secret aléatoire dans data/.session-secret
// pour que les sessions survivent au redémarrage du process.
const DATA_ROOT = process.env.DATA_ROOT || process.cwd();
function loadOrCreateSessionSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    const secretFile = path.join(DATA_ROOT, '.session-secret');
    try {
        if (fs.existsSync(secretFile)) {
            const stored = fs.readFileSync(secretFile, 'utf8').trim();
            if (stored.length === 64 && /^[0-9a-f]+$/i.test(stored)) return stored;
        }
    } catch {}
    const fresh = crypto.randomBytes(32).toString('hex');
    try {
        fs.mkdirSync(DATA_ROOT, { recursive: true });
        fs.writeFileSync(secretFile, fresh, { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
        console.warn(`⚠ SESSION_SECRET non-persiste (data dir non accessible): ${err.message}`);
        console.warn(`  Les sessions seront invalidees au prochain redemarrage.`);
    }
    return fresh;
}
const SESSION_SECRET = loadOrCreateSessionSecret();

export const sessions     = new Map(); // sessionId → { discordId, username, role, ... }
export const oauthStates  = new Map(); // state → { expiresAt, redirect? }

// ── Cookies signés ───────────────────────────────────────────────
// Format : "<valeur>.<signature_base64url>"
// La signature couvre uniquement la valeur, pas elle-même.
function sign(value) {
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
    return `${value}.${sig}`;
}

function verify(signed) {
    const idx = signed.lastIndexOf('.');
    if (idx === -1) return null;
    const value    = signed.slice(0, idx);
    const sig      = signed.slice(idx + 1);
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
    // Comparaison en temps constant pour éviter les timing attacks
    if (sig.length !== expected.length) return null;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? value : null;
}

// ── Session helpers ──────────────────────────────────────────────

export function parseCookies(req) {
    const out = {};
    (req.headers.cookie || '').split(';').forEach(pair => {
        const [k, ...v] = pair.trim().split('=');
        if (k) out[k.trim()] = v.join('=');
    });
    return out;
}

export function getSession(req) {
    const cookies  = parseCookies(req);
    const signed   = cookies['pngtuber_session'];
    if (!signed) return null;
    const sessionId = verify(signed);
    if (!sessionId) return null;
    const s = sessions.get(sessionId);
    // Supprimer la session expirée plutôt que de la laisser en mémoire
    if (!s || s.expiresAt < Date.now()) { sessions.delete(sessionId); return null; }
    return s;
}

export function createSession(discordUser, userGuildIds = []) {
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(id, {
        discordId:    discordUser.id,
        username:     discordUser.username,
        avatar:       discordUser.avatar,
        role:         getUserRole(discordUser.id),
        userGuildIds,
        expiresAt:    Date.now() + 7 * 86400_000, // 7 jours
    });
    return id;
}

export function setSessionCookie(res, sessionId, baseUrl, req = null) {
    const signed  = sign(sessionId);
    const maxAge  = 7 * 24 * 60 * 60;
    // Secure si TLS détecté : soit BASE_URL en https://, soit X-Forwarded-Proto=https
    // (uniquement si TRUST_PROXY=true pour éviter le spoof par le client direct).
    const trustProxy = process.env.TRUST_PROXY === 'true';
    const proxyProto = trustProxy ? req?.headers?.['x-forwarded-proto'] : null;
    const isHttps    = proxyProto === 'https' || baseUrl.startsWith('https://');
    const secure     = isHttps ? '; Secure' : '';
    res.setHeader('Set-Cookie', `pngtuber_session=${signed}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

export function getUserRole(discordId) {
    const row = permissions.get.get(discordId);
    return row?.role || 'viewer';
}

// ── GC périodique des sessions + oauthStates expirés ────────────
// Évite la fuite mémoire si des utilisateurs ne se déconnectent jamais.
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions)    if (s.expiresAt < now) sessions.delete(id);
    for (const [k, v] of oauthStates)  if (now > (v?.expiresAt ?? v)) oauthStates.delete(k);
}, 60_000);

// ── Résolution session depuis une requête HTTP ───────────────────
export function resolveAuth(req) {
    // 1. Bearer token (agent local / mini-app)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        const raw  = authHeader.slice(7);
        // Comparer le hash SHA-256, jamais le token brut, pour la sécurité en DB
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        const row  = appTokens.get.get(hash);
        if (row) {
            appTokens.touch.run(hash); // mise à jour last_used_at
            const actualRole = getUserRole(row.discord_id);
            // Les app tokens sont volontairement plafonnés au rôle client
            // même si l'utilisateur est admin — limiter la surface d'attaque.
            return {
                discordId:  row.discord_id,
                role:       actualRole === 'admin' ? 'client' : actualRole,
                actualRole,
                appAuth:    true,
                deviceName: row.device_name,
            };
        }
        return null; // token invalide ou révoqué
    }
    // 2. Cookie de session navigateur
    return getSession(req) || null;
}
