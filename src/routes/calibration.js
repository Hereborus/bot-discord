/**
 * Calibration vocale — empreintes d'émotions
 * ============================================
 * Gestion des empreintes d'émotions (fingerprints) enregistrées manuellement
 * par snapshot de l'état vocal courant.
 *
 * Aucun enregistrement temporisé : l'user parle dans l'état émotionnel voulu,
 * clique "Capturer" dans l'UI → le frontend lit les valeurs live depuis /levels
 * et calcule le fingerprint (mean = valeur courante, std = IQR/1.35 du profil vocal),
 * puis envoie à POST /calibration/:token/save-fingerprint.
 *
 * Routes exposées :
 *   POST   /calibration/:token/save-fingerprint       → sauvegarder une empreinte
 *   DELETE /calibration/:token/fingerprint/:emotionKey → supprimer une empreinte
 */

import { uidFor } from '../services/tokenService.js';
import { json, parseJsonBody } from '../http/helpers.js';

/**
 * POST /calibration/:token/save-fingerprint
 * Body : { emotionKey: string, fingerprint: { [feature]: { mean, std } } }
 */
async function handleSaveFingerprint(req, res, ctx, { stmts, isKnownToken, invalidateAudioFpCache }) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: 'token inconnu' }, 404, req);
    let body;
    try { body = await parseJsonBody(req); } catch { return json(res, { error: 'JSON invalide' }, 400, req); }
    const { emotionKey, fingerprint } = body;
    if (!emotionKey || typeof emotionKey !== 'string')
        return json(res, { error: 'emotionKey requis' }, 400, req);
    if (!fingerprint || typeof fingerprint !== 'object')
        return json(res, { error: 'fingerprint requis' }, 400, req);
    const row = stmts.getUserConfig.get(token);
    const cfg = row ? JSON.parse(row.config_json || '{}') : {};
    if (!cfg.emotionFingerprints) cfg.emotionFingerprints = {};
    cfg.emotionFingerprints[emotionKey] = fingerprint;
    stmts.upsertUser.run(token, cfg.displayName || row?.display_name || '???', JSON.stringify(cfg));
    if (invalidateAudioFpCache) invalidateAudioFpCache(token);
    return json(res, { ok: true }, 200, req);
}

/**
 * DELETE /calibration/:token/fingerprint/:emotionKey
 */
async function handleDeleteFingerprint(req, res, ctx, { stmts, isKnownToken, invalidateAudioFpCache }) {
    const token     = ctx.params.token;
    const emotionKey = ctx.params.emotionKey;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: 'token inconnu' }, 404, req);
    const row = stmts.getUserConfig.get(token);
    if (!row) return json(res, { error: 'config introuvable' }, 404, req);
    const cfg = JSON.parse(row.config_json || '{}');
    if (cfg.emotionFingerprints) {
        delete cfg.emotionFingerprints[emotionKey];
        if (Object.keys(cfg.emotionFingerprints).length === 0) delete cfg.emotionFingerprints;
    }
    stmts.upsertUser.run(token, cfg.displayName || row.display_name || '???', JSON.stringify(cfg));
    if (invalidateAudioFpCache) invalidateAudioFpCache(token);
    return json(res, { ok: true }, 200, req);
}

/**
 * Enregistre les routes de gestion des empreintes dans le routeur principal.
 */
export function registerCalibrationRoutes({ route, requireAuth, requireClientOrAdmin, stmts, isKnownToken, invalidateAudioFpCache }) {
    const deps = { stmts, isKnownToken, invalidateAudioFpCache };
    route('POST',   '/calibration/:token/save-fingerprint',
        requireAuth, requireClientOrAdmin,
        (req, res, ctx) => handleSaveFingerprint(req, res, ctx, deps));
    route('DELETE', '/calibration/:token/fingerprint/:emotionKey',
        requireAuth, requireClientOrAdmin,
        (req, res, ctx) => handleDeleteFingerprint(req, res, ctx, deps));
}

export { handleSaveFingerprint, handleDeleteFingerprint };
