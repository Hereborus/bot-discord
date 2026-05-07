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
import { users } from '../db/repos/users.js';

// Cache en mémoire : recalculer le HMAC à chaque requête serait inutile.
// Les maps sont peuplées au fur et à mesure des connexions vocales.
const tokenToUid = new Map(); // token → userId
const uidToToken = new Map(); // userId → token

// Format strict d'un token HMAC : 16 chars hex.
// Validation belt-and-suspenders avant toute operation fichier (defense-in-depth
// par rapport aux checks `path.resolve` + `startsWith` deja en place).
export const SAFE_TOKEN = /^[a-f0-9]{16}$/i;
export function isValidTokenFormat(token) {
    return typeof token === 'string' && SAFE_TOKEN.test(token);
}

// Lu lazily pour éviter que le module soit initialisé avant dotenv.config()
function hashUid(userId) {
    return crypto
        .createHmac('sha256', process.env.USER_HASH_SECRET)
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
    try { return !!users?.get?.get(token); } catch { return false; }
}
