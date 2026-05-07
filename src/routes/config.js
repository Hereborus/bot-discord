/**
 * Routes configuration utilisateur et bot
 * ==========================================
 * Expose les endpoints de lecture/écriture de la config audio par user :
 *   GET  /user-config/:token  → lire la config audio d'un user
 *   POST /user-config/:token  → sauvegarder la config audio d'un user
 *   GET  /known-users         → liste des users connus (token + displayName)
 *   POST /bot-token           → valider et sauvegarder le token Discord du bot
 *
 * Dépendances injectées via l'objet `deps` :
 *   stmts, uidFor, isKnownToken, TIER_LIMITS, validateUserConfig,
 *   broadcastConfigUpdate, uidToToken, setEnvKey, json, readBody, parseJsonBody
 */

import { json, readBody } from '../http/helpers.js';
import { uidFor, tokenFor } from '../services/tokenService.js';
import { TIER_LIMITS } from '../services/tierService.js';

// ── Clés autorisées dans la config utilisateur ───────────────────
// Whitelist de clés acceptées en POST /user-config/:token.
// 'calibration' et 'emotionFingerprints' restent pour compatibilité lecture
// (les données existantes ne sont pas effacées), mais la validation stricte
// a été supprimée (feature archivée dans src/bot/calibration.js).
const ALLOWED_CONFIG_KEYS = [
    'displayName', 'thresholds', 'emotionHoldMs', 'frameSpeed',
    'emotions', 'blinkSettings', 'calibration', 'emotionFingerprints', 'emotionHotkeys',
];

/**
 * Valide la structure d'une config utilisateur (format libre avec whitelist de clés).
 * @param {object} cfg
 * @returns {boolean}
 */
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
    return true;
}

// ── Handlers ─────────────────────────────────────────────────────

/**
 * GET /user-config/:token
 * Retourne la config audio d'un utilisateur (publique — nécessaire pour le viewer OBS).
 */
export async function handleGetUserConfig(req, res, ctx, { stmts, isKnownToken }) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token)) return json(res, { error: 'token inconnu' }, 404, req);
    const row = stmts.getUserConfig.get(token);
    return json(res, row ? JSON.parse(row.config_json || '{}') : {}, 200, req);
}

/**
 * POST /user-config/:token
 * Sauvegarde la config audio d'un utilisateur (protégé : requireClientOrAdmin + loadTier).
 */
export async function handlePostUserConfig(req, res, ctx, { stmts, isKnownToken, broadcastConfigUpdate }) {
    try {
        const token = ctx.params.token;
        if (!uidFor(token) && !isKnownToken(token)) return json(res, { error: 'token inconnu' }, 404, req);
        const cfg = JSON.parse((await readBody(req)).toString());
        if (!validateUserConfig(cfg))
            return json(res, { error: 'Configuration invalide' }, 400, req);
        // Enforcement tier : strip les fonctionnalités premium pour le tier free
        const tierLimits = ctx.tierLimits || TIER_LIMITS.free;
        if (!tierLimits.emotionsEnabled) {
            delete cfg.emotions;
            delete cfg.emotionHotkeys;
        }
        stmts.upsertUser.run(token, cfg.displayName || '???', JSON.stringify(cfg));
        broadcastConfigUpdate(token);
        return json(res, { ok: true }, 200, req);
    } catch (err) {
        console.error('Config save error:', err);
        return json(res, { error: 'Erreur lors de la sauvegarde' }, 500, req);
    }
}

/**
 * GET /known-users
 * Retourne la liste des utilisateurs connus (token opaque + displayName).
 * Combine les users actifs en mémoire (via uidToToken) et persistés en DB.
 */
export async function handleKnownUsers(req, res, ctx, { stmts, uidToToken }) {
    const users = [];
    // Users actifs en mémoire (session vocale courante)
    for (const [uid, token] of uidToToken) {
        const row = stmts.getUser.get(token);
        const cfg = row ? JSON.parse(row.config_json || '{}') : null;
        users.push({
            token,
            displayName: cfg?.displayName || row?.display_name || '???',
            hasConfig: !!row,
        });
    }
    // Users persistés en base (sessions précédentes)
    for (const row of stmts.allUsers.all()) {
        if (users.find(u => u.token === row.token)) continue;
        users.push({
            token: row.token,
            displayName: row.display_name || '???',
            hasConfig: true,
            offline: true,
        });
    }
    return json(res, users, 200, req);
}

/**
 * POST /bot-token
 * Valide le token Discord du bot via l'API Discord, le persiste dans .env, et redémarre.
 * Réservé admin.
 */
export async function handleBotToken(req, res, ctx, { setEnvKey }) {
    try {
        const { token } = JSON.parse((await readBody(req)).toString());
        if (!token || token.trim().length < 50)
            return json(res, { ok: false, error: 'Token trop court' }, 400, req);
        const vRes = await fetch(
            'https://discord.com/api/v10/users/@me',
            { headers: { Authorization: `Bot ${token.trim()}` } },
        );
        if (!vRes.ok) {
            const e = await vRes.json().catch(() => ({}));
            return json(res, { ok: false, error: `Rejeté: ${e.message || vRes.status}` }, 401, req);
        }
        const botUser = await vRes.json();
        setEnvKey('DISCORD_TOKEN', token.trim());
        console.log('Token mis à jour → redémarrage...');
        setTimeout(() => process.exit(0), 500);
        return json(res, { ok: true, tag: botUser.username }, 200, req);
    } catch (err) {
        console.error('Bot token error:', err);
        return json(res, { ok: false, error: 'Erreur lors de la validation du token' }, 500, req);
    }
}

// Exporter aussi validateUserConfig et ALLOWED_CONFIG_KEYS pour usage éventuel externe
export { validateUserConfig, ALLOWED_CONFIG_KEYS };
