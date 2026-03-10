/**
 * Token Service — tokenisation HMAC des IDs Discord
 * ===================================================
 * Les IDs Discord (userId) ne sortent jamais en clair via HTTP.
 * Chaque userId est converti en un token hex de 16 caractères via
 * HMAC-SHA256 avec USER_HASH_SECRET. Ce hash est déterministe :
 * le même userId produit toujours le même token, ce qui permet
 * de l'utiliser comme clé stable dans les URLs et la DB.
 *
 * Dépendances : node:crypto, db/repos/users (fallback DB)
 */
import crypto from 'node:crypto';

const HASH_SECRET = process.env.USER_HASH_SECRET;

// Cache en mémoire : recalculer le HMAC à chaque requête serait inutile.
// Les maps sont peuplées au fur et à mesure des connexions vocales.
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
    // Fallback DB pour un user connu en DB mais pas encore passé par le pipeline audio
    const { users } = await import('../db/repos/users.js').catch(() => ({ users: null }));
    return users ? !!users.get.get(token) : false;
}
