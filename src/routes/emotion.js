/**
 * Route émotion manuelle (override)
 * ====================================
 * Permet de définir ou effacer une émotion manuelle pour un utilisateur.
 * Priorité sur la détection automatique (empreintes vocales dans audio.js).
 *
 *   GET  /api/emotion/:token  → état de l'émotion manuelle active
 *   POST /api/emotion/:token  → définir ou effacer l'émotion manuelle
 *
 * La Map `manualEmotion` est exportée pour être utilisée dans index.js
 * (passée à _subscribeUser et utilisée dans handleLevels / WS broadcast).
 *
 * Timeout de sécurité : 30 minutes max avant auto-effacement.
 *
 * Dépendances injectées via `deps` :
 *   uidFor, isKnownToken, json, parseJsonBody
 */

import { json, parseJsonBody } from '../http/helpers.js';
import { uidFor } from '../services/tokenService.js';

// ── Émotion manuelle ──────────────────────────────────────────────
// Override de l'émotion automatique via raccourcis clavier ou agent local.
// Expire automatiquement après MANUAL_EMOTION_TIMEOUT_MS.
export const manualEmotion = new Map(); // token → { emotion, setAt }
const MANUAL_EMOTION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes de sécurité

/**
 * Définit ou efface l'émotion manuelle d'un utilisateur.
 * @param {string} token - token opaque de l'utilisateur
 * @param {string|null} emotion - clé d'émotion ou null pour effacer
 * @returns {string|null} l'émotion active après modification
 */
export function setManualEmotion(token, emotion) {
    if (!emotion) {
        manualEmotion.delete(token);
        return null;
    }
    manualEmotion.set(token, { emotion, setAt: Date.now() });
    return emotion;
}

// Nettoyage périodique des émotions manuelles expirées (toutes les 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [token, e] of manualEmotion) {
        if (now - e.setAt > MANUAL_EMOTION_TIMEOUT_MS) manualEmotion.delete(token);
    }
}, 5 * 60_000);

// ── Handlers ─────────────────────────────────────────────────────

/**
 * GET /api/emotion/:token
 * Retourne l'émotion manuelle active pour un token, ou null si aucune.
 */
export async function handleGetEmotion(req, res, ctx) {
    const token = ctx.params.token;
    const manual = manualEmotion.get(token);
    return json(res, { active: manual?.emotion || null }, 200, req);
}

/**
 * POST /api/emotion/:token  { emotion: "anger" | null }
 * Définit ou efface l'émotion manuelle.
 * Protégé : requireAuth + requireClientOrAdmin (route enregistrée dans index.js).
 */
export async function handleSetEmotion(req, res, ctx, { isKnownToken }) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: 'token inconnu' }, 404, req);
    let body;
    try { body = await parseJsonBody(req); } catch { return json(res, { error: 'JSON invalide' }, 400, req); }
    const emotion = typeof body.emotion === 'string' ? body.emotion : null;
    const active = setManualEmotion(token, emotion);
    return json(res, { ok: true, active }, 200, req);
}
