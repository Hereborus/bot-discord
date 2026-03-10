// ── Service de tokenisation HMAC ────────────────────────────────
// Le userId Discord ne sort jamais de ce module en clair.
// token = HMAC-SHA256(userId, SECRET).slice(0,16) → 16 chars hex déterministes.
import crypto from 'node:crypto';

const HASH_SECRET = process.env.USER_HASH_SECRET;

// Cache en mémoire : recalculer le HMAC à chaque requête serait inutile.
const tokenToUid = new Map(); // token → userId
const uidToToken = new Map(); // userId → token

function hashUid(userId) {
    return crypto
        .createHmac('sha256', HASH_SECRET)
        .update(String(userId))
        .digest('hex')
        .slice(0, 16);
}

export function tokenFor(userId) {
    if (uidToToken.has(userId)) return uidToToken.get(userId);
    const token = hashUid(userId);
    tokenToUid.set(token, userId);
    uidToToken.set(userId, token);
    return token;
}

export function uidFor(token) {
    return tokenToUid.get(token) || null;
}

export function isKnownToken(token) {
    if (tokenToUid.has(token)) return true;
    // Fallback DB (token d'un user qui n'a pas encore parlé)
    const { users } = await import('../db/repos/users.js').catch(() => ({ users: null }));
    return users ? !!users.get.get(token) : false;
}
