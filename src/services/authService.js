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
 * Dépendances : node:crypto, db/repos/permissions, db/repos/appTokens
 */
import crypto from 'node:crypto';
import { permissions } from '../db/repos/permissions.js';
import { appTokens } from '../db/repos/appTokens.js';

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
export const sessions     = new Map(); // sessionId → { discordId, username, role, ... }
export const oauthStates  = new Map(); // state → { expiresAt, redirect? }
// AUTH_ENABLED = false si DISCORD_CLIENT_ID absent → toutes les routes sont accessibles sans login
export const AUTH_ENABLED = Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);

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

export function setSessionCookie(res, sessionId, baseUrl) {
    const signed  = sign(sessionId);
    const maxAge  = 7 * 24 * 60 * 60;
    // Secure uniquement si le site est servi en HTTPS
    const secure  = baseUrl.startsWith('https://') ? '; Secure' : '';
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
