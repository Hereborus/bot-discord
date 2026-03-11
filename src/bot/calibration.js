/**
 * Calibration vocale — MODULE DORMANT (non importé)
 * ===================================================
 * Ce fichier est une archive isolée du code de calibration vocale
 * extrait de index.js. Il n'est PAS importé ailleurs dans le projet.
 *
 * Fonctionnalités archivées :
 *   - Enregistrement d'empreintes vocales par émotion (fingerprints)
 *   - Détection d'émotion par distance de Mahalanobis normalisée
 *   - Hystérésis d'émotion (confirmation + hold)
 *   - Calcul automatique de seuils (auto-thresholds)
 *   - Calcul automatique d'émotions de base (auto-emotions)
 *   - Routes HTTP : /calibration/:token/*
 *
 * Ces fonctionnalités ne sont plus exposées en production.
 * La détection d'émotion active est gérée par src/bot/audio.js.
 * L'émotion manuelle (override) reste dans index.js via handleGetEmotion/handleSetEmotion.
 *
 * Pour réactiver : importer ce module dans index.js et enregistrer les routes.
 */

// ── Dépendances (à décommenter si réactivation) ──────────────────
// import { tokenFor, uidFor } from '../services/tokenService.js';
// import { userBaseline, recordingSessions } from '../services/audioService.js';
// import { json, parseJsonBody } from '../http/helpers.js';
// import { requireAuth, requireClientOrAdmin } from '../http/middleware.js';
// import { loadTier, requirePremium } from '../services/tierService.js';
// import { db } from '../db/database.js';

// ── Cache des empreintes vocales ──────────────────────────────────

// Cache par token pour éviter les lectures SQLite à chaque tick audio.
// TTL : 5 secondes.
const fingerprintCache = new Map(); // token → { fingerprints, ts }
const FP_CACHE_TTL = 5000;

/**
 * Récupère les empreintes vocales d'un user depuis la DB (avec cache TTL).
 * @param {object} stmts - alias repos SQLite (stmts.getUserConfig)
 * @param {string} token - token opaque de l'utilisateur
 * @returns {object|null} Map emotionKey → fingerprint, ou null si absent
 */
function getFingerprints(stmts, token) {
    const cached = fingerprintCache.get(token);
    if (cached && Date.now() - cached.ts < FP_CACHE_TTL) return cached.fingerprints;
    const row = stmts.getUserConfig.get(token);
    if (!row) {
        fingerprintCache.set(token, { fingerprints: null, ts: Date.now() });
        return null;
    }
    let cfg;
    try { cfg = JSON.parse(row.config_json || '{}'); } catch { return null; }
    const fp = cfg.emotionFingerprints || null;
    fingerprintCache.set(token, { fingerprints: fp, ts: Date.now() });
    return fp;
}

/**
 * Invalide le cache fingerprint pour un token (après save/delete).
 * @param {string} token
 */
function invalidateFingerprintCache(token) {
    fingerprintCache.delete(token);
}

// ── Hystérésis d'émotion ──────────────────────────────────────────
// Requiert N détections consécutives avant de changer d'émotion,
// et maintient l'émotion pendant EMOTION_HOLD_MS après détection.

const emotionState = new Map(); // token → { current, candidate, confirmCount, holdUntil }
const EMOTION_CONFIRM_COUNT = 5;  // 5 × 50ms = 250ms avant de changer
const EMOTION_HOLD_MS = 800;      // Maintenir 800ms après la dernière détection

/**
 * Lisse les transitions d'émotion pour éviter les changements rapides.
 * @param {string} token
 * @param {string|null} rawEmotion - émotion brute détectée à cet instant
 * @returns {string|null} émotion stabilisée
 */
function stabilizeEmotion(token, rawEmotion) {
    const now = Date.now();
    let st = emotionState.get(token);
    if (!st) {
        st = { current: null, candidate: null, confirmCount: 0, holdUntil: 0 };
        emotionState.set(token, st);
    }

    if (rawEmotion) {
        if (rawEmotion === st.current) {
            // Même émotion → prolonger le hold
            st.holdUntil = now + EMOTION_HOLD_MS;
            st.candidate = null;
            st.confirmCount = 0;
            return st.current;
        }
        // Nouvelle émotion → accumuler les confirmations
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
        // Pas encore confirmé → conserver l'émotion actuelle
        return st.current;
    }

    // rawEmotion est null → plus d'émotion détectée
    st.candidate = null;
    st.confirmCount = 0;
    if (st.current && now < st.holdUntil) return st.current; // hold actif
    st.current = null;
    return null;
}

// ── Calcul d'empreinte vocale ─────────────────────────────────────

function fpAvg(arr) {
    return arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0;
}
function fpStd(arr) {
    if (arr.length < 2) return 0;
    const m = fpAvg(arr);
    return Math.sqrt(arr.reduce((a, v) => a + (v - m) ** 2, 0) / arr.length);
}

/**
 * Calcule une empreinte statistique (mean+std) sur un tableau d'échantillons audio.
 * @param {Array} samples - tableau d'objets { db, zcr, centroid, energyVar, freq: {low,mid,high} }
 * @returns {object} fingerprint : { db: {mean,std}, zcr: {mean,std}, ... }
 */
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

// ── Détection d'émotion par empreintes ───────────────────────────

/**
 * Détecte l'émotion d'un user par distance normalisée aux empreintes enregistrées.
 * Dead code : src/bot/audio.js a sa propre implémentation active.
 * @param {object} stmts - alias repos SQLite
 * @param {string} token
 * @param {object} features - features audio actuelles { db, zcr, centroid, energyVar, freq }
 * @returns {string|null} clé d'émotion détectée (stabilisée), ou null
 */
function detectEmotionFromFingerprints(stmts, token, features) {
    const fingerprints = getFingerprints(stmts, token);
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

// ── Route handlers calibration ────────────────────────────────────

/**
 * POST /calibration/:token/reset
 * Réinitialise la baseline vocale de l'utilisateur.
 */
async function handleCalibrationReset(req, res, ctx, { stmts, userBaseline, uidFor, isKnownToken, json }) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: 'token inconnu' }, 404, req);
    const uid = uidFor(token);
    if (uid) userBaseline.delete(uid);
    // Supprimer aussi la calibration persistée dans la config
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

/**
 * POST /calibration/:token/auto-thresholds
 * Calcule des seuils audio optimaux basés sur la baseline vocale.
 */
async function handleAutoThresholds(req, res, ctx, { stmts, userBaseline, uidFor, isKnownToken, json }) {
    const token = ctx.params.token;
    const uid = uidFor(token);
    if (!uid && !isKnownToken(token))
        return json(res, { error: 'token inconnu' }, 404, req);
    const bl = uid ? userBaseline.get(uid) : null;
    if (!bl || bl.sampleCount < 100)
        return json(res, { error: 'Calibration insuffisante', sampleCount: bl?.sampleCount || 0 }, 400, req);
    const mean = bl.dbMean;
    const std = Math.max(bl.dbStd, 2); // minimum 2 dB d'écart-type
    const thresholds = [
        { key: 'low',    db: Math.round(mean - 1.5 * std), label: 'Low',    color: '#4a90e2' },
        { key: 'medium', db: Math.round(mean - 0.3 * std), label: 'Medium', color: '#f0a500' },
        { key: 'high',   db: Math.round(mean + 1.2 * std), label: 'High',   color: '#e74c6c' },
    ];
    return json(res, {
        thresholds,
        baseline: { dbMean: Math.round(mean * 100) / 100, dbStd: Math.round(std * 100) / 100 },
    }, 200, req);
}

/**
 * POST /calibration/:token/auto-emotions
 * Calcule des définitions d'émotions adaptées à la baseline fréquentielle du user.
 */
async function handleAutoEmotions(req, res, ctx, { stmts, userBaseline, uidFor, isKnownToken, json }) {
    const token = ctx.params.token;
    const uid = uidFor(token);
    if (!uid && !isKnownToken(token))
        return json(res, { error: 'token inconnu' }, 404, req);
    const bl = uid ? userBaseline.get(uid) : null;
    if (!bl || bl.sampleCount < 100)
        return json(res, { error: 'Calibration insuffisante', sampleCount: bl?.sampleCount || 0 }, 400, req);
    const emotions = [
        {
            key: 'anger', label: 'Anger', minStatus: 'medium',
            freqMin: 20, freqMax: 400,
            sensitivity: 1.3,
            useBaseline: true, deviationDirection: 'below',
            deviationThreshold: 1.5,
        },
        {
            key: 'happy', label: 'Happy', minStatus: 'low',
            freqMin: 1500, freqMax: 6000,
            sensitivity: 1.3,
            useBaseline: true, deviationDirection: 'above',
            deviationThreshold: 1.2,
        },
        {
            key: 'scream', label: 'Scream', minStatus: 'high',
            freqMin: 800, freqMax: 4000,
            sensitivity: 1.5,
        },
    ];
    return json(res, {
        emotions,
        baseline: {
            freqMean: {
                low:  Math.round(bl.freqMean.low  * 1000) / 1000,
                mid:  Math.round(bl.freqMean.mid  * 1000) / 1000,
                high: Math.round(bl.freqMean.high * 1000) / 1000,
            },
            freqStd: {
                low:  Math.round(bl.freqStd.low  * 1000) / 1000,
                mid:  Math.round(bl.freqStd.mid  * 1000) / 1000,
                high: Math.round(bl.freqStd.high * 1000) / 1000,
            },
        },
    }, 200, req);
}

/**
 * POST /calibration/:token/record-start
 * Démarre une session d'enregistrement d'empreinte vocale.
 */
async function handleRecordStart(req, res, ctx, { stmts, recordingSessions, uidFor, isKnownToken, parseJsonBody, json }) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: 'token inconnu' }, 404, req);
    let durationMs = 5000;
    try {
        const body = await parseJsonBody(req);
        if (body.durationMs && typeof body.durationMs === 'number')
            durationMs = Math.min(Math.max(body.durationMs, 2000), 15000);
    } catch {}
    recordingSessions.set(token, { startedAt: Date.now(), durationMs, samples: [] });
    return json(res, { ok: true, durationMs }, 200, req);
}

/**
 * POST /calibration/:token/record-stop
 * Arrête l'enregistrement et retourne l'empreinte calculée.
 */
async function handleRecordStop(req, res, ctx, { recordingSessions, json }) {
    const token = ctx.params.token;
    const session = recordingSessions.get(token);
    if (!session) return json(res, { error: "Aucune session d'enregistrement active" }, 400, req);
    recordingSessions.delete(token);
    if (session.samples.length < 10)
        return json(res, { error: "Pas assez d'échantillons", count: session.samples.length }, 400, req);
    const fingerprint = computeFingerprint(session.samples);
    return json(res, { ok: true, fingerprint, sampleCount: session.samples.length }, 200, req);
}

/**
 * POST /calibration/:token/save-fingerprint
 * Sauvegarde une empreinte vocale dans la config de l'utilisateur.
 */
async function handleSaveFingerprint(req, res, ctx, { stmts, uidFor, isKnownToken, parseJsonBody, json }) {
    const token = ctx.params.token;
    if (!uidFor(token) && !isKnownToken(token))
        return json(res, { error: 'token inconnu' }, 404, req);
    let body;
    try { body = await parseJsonBody(req); } catch { return json(res, { error: 'JSON invalide' }, 400, req); }
    const { emotionKey, fingerprint } = body;
    if (!emotionKey || typeof emotionKey !== 'string') return json(res, { error: 'emotionKey requis' }, 400, req);
    if (!fingerprint || typeof fingerprint !== 'object') return json(res, { error: 'fingerprint requis' }, 400, req);
    const row = stmts.getUserConfig.get(token);
    const cfg = row ? JSON.parse(row.config_json || '{}') : {};
    if (!cfg.emotionFingerprints) cfg.emotionFingerprints = {};
    cfg.emotionFingerprints[emotionKey] = fingerprint;
    stmts.upsertUser.run(token, cfg.displayName || row?.display_name || '???', JSON.stringify(cfg));
    invalidateFingerprintCache(token);
    return json(res, { ok: true }, 200, req);
}

/**
 * DELETE /calibration/:token/fingerprint/:emotionKey
 * Supprime une empreinte vocale par clé d'émotion.
 */
async function handleDeleteFingerprint(req, res, ctx, { stmts, uidFor, isKnownToken, json }) {
    const token = ctx.params.token;
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
    invalidateFingerprintCache(token);
    return json(res, { ok: true }, 200, req);
}

// ── Enregistrement des routes (exemple — non branché dans index.js) ──
//
// Pour réactiver, importer ce module dans index.js et appeler registerCalibrationRoutes :
//
// import { registerCalibrationRoutes } from './src/bot/calibration.js';
// registerCalibrationRoutes({ route, requireAuth, requireClientOrAdmin, loadTier, requirePremium, deps });
//
// function registerCalibrationRoutes({ route, requireAuth, requireClientOrAdmin, loadTier, requirePremium, deps }) {
//     route('POST', '/calibration/:token/reset',            requireAuth, requireClientOrAdmin, (req,res,ctx) => handleCalibrationReset(req,res,ctx,deps));
//     route('POST', '/calibration/:token/auto-thresholds',  requireAuth, requireClientOrAdmin, (req,res,ctx) => handleAutoThresholds(req,res,ctx,deps));
//     route('POST', '/calibration/:token/auto-emotions',    requireAuth, requireClientOrAdmin, (req,res,ctx) => handleAutoEmotions(req,res,ctx,deps));
//     route('POST', '/calibration/:token/record-start',     requireAuth, requireClientOrAdmin, loadTier, requirePremium, (req,res,ctx) => handleRecordStart(req,res,ctx,deps));
//     route('POST', '/calibration/:token/record-stop',      requireAuth, requireClientOrAdmin, loadTier, requirePremium, (req,res,ctx) => handleRecordStop(req,res,ctx,deps));
//     route('POST', '/calibration/:token/save-fingerprint', requireAuth, requireClientOrAdmin, loadTier, requirePremium, (req,res,ctx) => handleSaveFingerprint(req,res,ctx,deps));
//     route('DELETE', '/calibration/:token/fingerprint/:emotionKey', requireAuth, requireClientOrAdmin, loadTier, requirePremium, (req,res,ctx) => handleDeleteFingerprint(req,res,ctx,deps));
// }

export {
    fingerprintCache, FP_CACHE_TTL,
    getFingerprints, invalidateFingerprintCache,
    emotionState, EMOTION_CONFIRM_COUNT, EMOTION_HOLD_MS, stabilizeEmotion,
    fpAvg, fpStd, computeFingerprint,
    detectEmotionFromFingerprints,
    handleCalibrationReset, handleAutoThresholds, handleAutoEmotions,
    handleRecordStart, handleRecordStop, handleSaveFingerprint, handleDeleteFingerprint,
};
