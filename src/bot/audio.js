/**
 * Pipeline audio Discord → analyse vocale
 * =========================================
 * Traite le flux Opus de chaque utilisateur vocal en temps réel :
 *
 * Chaîne : Opus (Discord) → PCM 16-bit stéréo 48kHz (prism-media)
 *          → RMS/dB → lissage glissant → FFT (fft-js) → bandes de fréquences
 *          → ZCR → Energy Variance → Centroïde spectral → LPC → formants
 *          → baseline EMA
 *
 * Métriques calculées toutes les 50ms (AUDIO.sampleInterval) :
 *   - db / rms    : niveau sonore instantané et lissé
 *   - freq        : énergie par bande (low/mid/high)
 *   - freqDelta   : taux de changement des bandes (10 derniers ticks)
 *   - zcr         : Zero Crossing Rate (rugosité vocale)
 *   - centroid    : centroïde spectral (brillance)
 *   - energyVar   : variance d'énergie (stabilité volume)
 *   - formants    : formants vocaux F1/F2/F3 via LPC ordre 12 (Levinson-Durbin)
 *
 * La baseline vocale (EMA, alpha=0.005) est persistée dans la config
 * utilisateur toutes les 60s pour alimenter la calibration automatique.
 *
 * Dépendances : prism-media, fft-js, @discordjs/voice,
 *               services/audioService, services/tokenService
 */
import prism from 'prism-media';
import fftPkg from 'fft-js';
import { EndBehaviorType } from '@discordjs/voice';
import {
    userLevels, userFreqHistory, userBaseline,
    recordingSessions, AUDIO,
} from '../services/audioService.js';
import { tokenFor } from '../services/tokenService.js';

const { fft, util: fftUtil } = fftPkg;

// Coefficient de lissage de la baseline vocale (~10s de convergence à 20Hz)
const BASELINE_ALPHA = 0.005;

// ── Constantes LPC — analyse des formants vocaux ──────────────────────────
const LPC_ORDER  = 12;  // ordre du prédicteur (standard pour la voix à 48kHz)
const LPC_N_EVAL = 512; // points d'évaluation de l'enveloppe spectrale

// Buffers pré-alloués (évite la pression GC à chaque tick 50ms)
const _lpcX    = new Float64Array(1024); // signal pré-accentué + fenêtré
const _lpcR    = new Float64Array(LPC_ORDER + 1); // autocorrélation R[0..p]
const _lpcA    = new Float64Array(LPC_ORDER + 1); // coefficients LPC a[1..p]
const _lpcPrev = new Float64Array(LPC_ORDER + 1); // copie itération précédente
const _lpcEnv  = new Float64Array(LPC_N_EVAL);    // enveloppe spectrale 1/|A(ω)|

// ── Hystérésis d'émotion ──────────────────────────────────────────────────
// Évite les changements trop rapides : requiert N confirmations consécutives
// avant d'accepter un changement, puis maintient l'émotion pendant un hold.
const emotionState = new Map(); // token → { current, candidate, confirmCount, holdUntil }
const EMOTION_CONFIRM_COUNT = 5;  // 5 × 50ms = 250ms avant changement
const EMOTION_HOLD_MS = 800;      // maintenir 800ms après la dernière détection

function stabilizeEmotion(token, rawEmotion) {
    const now = Date.now();
    let st = emotionState.get(token);
    if (!st) {
        st = { current: null, candidate: null, confirmCount: 0, holdUntil: 0 };
        emotionState.set(token, st);
    }
    if (rawEmotion) {
        if (rawEmotion === st.current) {
            st.holdUntil = now + EMOTION_HOLD_MS;
            st.candidate = null;
            st.confirmCount = 0;
            return st.current;
        }
        if (rawEmotion === st.candidate) {
            st.confirmCount++;
        } else {
            st.candidate = rawEmotion;
            st.confirmCount = 1;
        }
        if (st.confirmCount >= EMOTION_CONFIRM_COUNT) {
            st.current = rawEmotion;
            st.holdUntil = now + EMOTION_HOLD_MS;
            st.candidate = null;
            st.confirmCount = 0;
            return st.current;
        }
        if (st.current && now < st.holdUntil) return st.current;
        return st.current;
    }
    // rawEmotion null : plus de détection
    st.candidate = null;
    st.confirmCount = 0;
    if (st.current && now < st.holdUntil) return st.current;
    st.current = null;
    return null;
}

// Cache des empreintes vocales (évite la lecture SQLite à chaque tick)
const fingerprintCache = new Map(); // token → { fingerprints, ts }
const FP_CACHE_TTL = 5000; // 5s

// Récupère les empreintes d'un token (lecture différée via injection de stmts)
function getFingerprints(token, getUserConfig) {
    const cached = fingerprintCache.get(token);
    if (cached && Date.now() - cached.ts < FP_CACHE_TTL) return cached.fingerprints;
    const row = getUserConfig(token);
    if (!row) { fingerprintCache.set(token, { fingerprints: null, ts: Date.now() }); return null; }
    let cfg;
    try { cfg = JSON.parse(row.config_json || '{}'); } catch { return null; }
    const fp = cfg.emotionFingerprints || null;
    fingerprintCache.set(token, { fingerprints: fp, ts: Date.now() });
    return fp;
}

export function invalidateFingerprintCache(token) {
    fingerprintCache.delete(token);
}

// Détection d'émotion par comparaison aux empreintes enregistrées
function detectEmotionFromFingerprints(token, features, getUserConfig) {
    const fingerprints = getFingerprints(token, getUserConfig);
    if (!fingerprints || typeof fingerprints !== 'object') return stabilizeEmotion(token, null);
    let bestKey = null, bestDist = Infinity;
    for (const [key, fp] of Object.entries(fingerprints)) {
        let dist = 0, count = 0;
        for (const f of Object.keys(fp)) {
            let current;
            if (f.startsWith('freq_')) current = features.freq?.[f.slice(5)];
            else if (f.startsWith('formant_')) current = features.formants?.[f.slice(8)];
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

// ── FFT — décomposition fréquentielle ────────────────────────────────────
export function computeFreqBands(buffer) {
    if (buffer.length < AUDIO.fftSize) return { low: 0, mid: 0, high: 0, centroid: 0 };
    try {
        const mags = fftUtil.fftMag(fft(buffer.slice(0, AUDIO.fftSize)));
        const binHz = AUDIO.sampleRate / AUDIO.fftSize;
        const result = {};
        for (const [name, band] of Object.entries(AUDIO.freqBands)) {
            let sum = 0, count = 0;
            for (
                let i = Math.floor(band.min / binHz);
                i <= Math.ceil(band.max / binHz) && i < mags.length;
                i++
            ) {
                sum += mags[i];
                count++;
            }
            result[name] = count ? Math.round((sum / count) * 1000) / 1000 : 0;
        }
        // Centroïde spectral : centre de gravité fréquentiel en Hz
        let wSum = 0, mSum = 0;
        for (let i = 0; i < mags.length; i++) {
            wSum += mags[i] * (i * binHz);
            mSum += mags[i];
        }
        result.centroid = mSum > 0 ? Math.round(wSum / mSum) : 0;
        return result;
    } catch {
        return { low: 0, mid: 0, high: 0, centroid: 0 };
    }
}

// ── LPC — formants vocaux F1/F2/F3 ───────────────────────────────────────
// Méthode : pré-accentuation → fenêtrage Hann → autocorrélation →
//           Levinson-Durbin → évaluation |H(ω)| sur demi-cercle unité →
//           détection des pics locaux = formants.
//
// F1 (250–1000 Hz) corrèle avec l'ouverture de la bouche / l'arousal émotionnel.
// F2 (800–2500 Hz) corrèle avec la position de la langue / la valence.
// F3 (1500–3500 Hz) discrimine voix tendues vs relâchées.
export function computeFormants(buffer) {
    const N = Math.min(1024, buffer.length);
    if (N < LPC_ORDER * 4) return { f1: 0, f2: 0, f3: 0 };

    // Pré-accentuation : H(z) = 1 − 0.97z⁻¹  (compense le roll-off vocal)
    _lpcX[0] = buffer[0];
    for (let i = 1; i < N; i++) _lpcX[i] = buffer[i] - 0.97 * buffer[i - 1];

    // Fenêtre de Hann (réduit les artefacts de bord FFT/LPC)
    for (let i = 0; i < N; i++) {
        _lpcX[i] *= 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
    }

    // Autocorrélation R[0..LPC_ORDER]
    for (let lag = 0; lag <= LPC_ORDER; lag++) {
        let s = 0;
        for (let i = 0; i < N - lag; i++) s += _lpcX[i] * _lpcX[i + lag];
        _lpcR[lag] = s;
    }
    if (_lpcR[0] < 1e-10) return { f1: 0, f2: 0, f3: 0 }; // silence

    // Levinson-Durbin : R[0..p] → coefficients LPC a[1..p]
    _lpcA.fill(0);
    let e = _lpcR[0];
    for (let m = 1; m <= LPC_ORDER; m++) {
        let sum = _lpcR[m];
        for (let j = 1; j < m; j++) sum += _lpcA[j] * _lpcR[m - j];
        const k = -sum / e;
        for (let j = 1; j < m; j++) _lpcPrev[j] = _lpcA[j];
        for (let j = 1; j < m; j++) _lpcA[j] = _lpcPrev[j] + k * _lpcPrev[m - j];
        _lpcA[m] = k;
        e *= (1 - k * k);
        if (e <= 1e-10) break;
    }

    // Évaluation de l'enveloppe spectrale |H(ω)| = 1/|A(ω)| sur 250–4500 Hz
    const binHz = 48000 / (2 * LPC_N_EVAL); // ~46.875 Hz par bin
    const minBin = Math.max(1, Math.floor(250 / binHz));
    const maxBin = Math.min(LPC_N_EVAL - 1, Math.ceil(4500 / binHz));

    for (let k = minBin; k <= maxBin; k++) {
        const omega = Math.PI * k / LPC_N_EVAL;
        let re = 1, im = 0;
        for (let j = 1; j <= LPC_ORDER; j++) {
            re += _lpcA[j] * Math.cos(j * omega);
            im -= _lpcA[j] * Math.sin(j * omega);
        }
        const mag = Math.sqrt(re * re + im * im);
        _lpcEnv[k] = mag > 1e-10 ? 1.0 / mag : 0;
    }

    // Détection des maxima locaux → formants
    const peaks = [];
    for (let k = minBin + 1; k < maxBin; k++) {
        if (_lpcEnv[k] > _lpcEnv[k - 1] && _lpcEnv[k] > _lpcEnv[k + 1]) {
            peaks.push({ freq: Math.round(k * binHz), mag: _lpcEnv[k] });
        }
    }
    // Garder les 5 pics les plus forts, puis trier par fréquence croissante → F1 < F2 < F3
    peaks.sort((a, b) => b.mag - a.mag);
    const top = peaks.slice(0, 5).sort((a, b) => a.freq - b.freq);

    return {
        f1: top[0]?.freq || 0,
        f2: top[1]?.freq || 0,
        f3: top[2]?.freq || 0,
    };
}

// ── Chargement de la baseline persistée ─────────────────────────────────
export function loadBaselineFromConfig(userId, getUserConfig) {
    const token = tokenFor(userId);
    try {
        const row = getUserConfig(token);
        if (!row) return;
        const cfg = JSON.parse(row.config_json || '{}');
        if (!cfg.calibration || !cfg.calibration.dbMean) return;
        const cal = cfg.calibration;
        userBaseline.set(userId, {
            dbMean: cal.dbMean,
            dbStd: cal.dbStd || 0,
            freqMean: cal.freqMean || { low: 0, mid: 0, high: 0 },
            freqStd: cal.freqStd || { low: 0, mid: 0, high: 0 },
            sampleCount: cal.sampleCount || 0,
            lastUpdate: Date.now(),
            dirty: false,
        });
    } catch {}
}

// ── Sauvegarde périodique de la baseline (toutes les 60s) ────────────────
export function startBaselinePersistence(getUserConfig, upsertUser) {
    return setInterval(() => {
        for (const [userId, bl] of userBaseline) {
            if (!bl.dirty) continue;
            bl.dirty = false;
            const token = tokenFor(userId);
            try {
                const row = getUserConfig(token);
                const cfg = row ? JSON.parse(row.config_json || '{}') : {};
                cfg.calibration = {
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
                };
                upsertUser(token, cfg.displayName || '???', JSON.stringify(cfg));
            } catch {}
        }
    }, 60_000);
}

// ── subscribeUser — attache le pipeline Opus/PCM à un utilisateur ─────────
/**
 * @param {object} receiver    - VoiceReceiver de discord.js
 * @param {string} userId      - ID Discord de l'utilisateur
 * @param {string} displayName - Nom affiché (pour userLevels)
 * @param {object} deps        - { manualEmotion, getUserConfig, upsertUser }
 */
export function subscribeUser(receiver, userId, displayName, { manualEmotion, getUserConfig, upsertUser }) {
    // Charger la baseline persistée si elle n'est pas déjà en mémoire
    if (!userBaseline.has(userId)) loadBaselineFromConfig(userId, getUserConfig);
    try {
        const opusStream = receiver.subscribe(userId, {
            end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
        });
        const decoder = new prism.opus.Decoder({
            frameSize: 960,
            channels: 2,
            rate: AUDIO.sampleRate,
        });
        opusStream.pipe(decoder);

        let sumSq = 0, sampleCount = 0;
        const history = [];
        // Buffer circulaire pour les échantillons FFT (évite O(n) des Array.shift)
        const FREQ_BUF_CAP = AUDIO.fftSize * 2;
        const freqBuf = new Float32Array(FREQ_BUF_CAP);
        let freqBufLen = 0, freqBufStart = 0;

        if (!userFreqHistory.has(userId)) userFreqHistory.set(userId, []);

        const tick = setInterval(() => {
            if (!sampleCount) return;
            const rms = Math.sqrt(sumSq / sampleCount) / 32768;
            const db = rms > 0 ? 20 * Math.log10(rms) : -100;
            const now = Date.now();

            // Fenêtre glissante pour lisser les micro-variations
            history.push({ db, t: now });
            while (history.length && now - history[0].t > AUDIO.durationWindow) history.shift();
            const avgDb = history.reduce((a, v) => a + v.db, 0) / history.length;

            // Extraire les échantillons ordonnés du buffer circulaire pour FFT + ZCR
            const orderedBuf = new Float32Array(freqBufLen);
            for (let i = 0; i < freqBufLen; i++) {
                orderedBuf[i] = freqBuf[(freqBufStart + i) % FREQ_BUF_CAP];
            }
            const freqResult = computeFreqBands(orderedBuf);
            const freq = { low: freqResult.low, mid: freqResult.mid, high: freqResult.high };
            const centroid = freqResult.centroid;
            const formants = computeFormants(orderedBuf);

            // ZCR (Zero Crossing Rate) — rugosité/agressivité vocale
            let zc = 0;
            for (let i = 1; i < freqBufLen; i++) {
                if ((orderedBuf[i] >= 0) !== (orderedBuf[i - 1] >= 0)) zc++;
            }
            const zcr = freqBufLen > 1 ? Math.round(zc / (freqBufLen - 1) * 1000) / 1000 : 0;

            // Energy Variance — stabilité du volume
            const dbVals = history.map(h => h.db);
            const dbMeanLocal = dbVals.reduce((a, v) => a + v, 0) / dbVals.length;
            const energyVar = dbVals.length > 1
                ? Math.round(dbVals.reduce((a, v) => a + (v - dbMeanLocal) ** 2, 0) / dbVals.length * 100) / 100
                : 0;

            // Deltas fréquentiels (taux de changement sur 10 ticks)
            const fh = userFreqHistory.get(userId);
            fh.push({ ...freq, t: now });
            while (fh.length > 10) fh.shift();
            const freqDelta = { low: 0, mid: 0, high: 0 };
            if (fh.length >= 3) {
                const recent = fh.slice(-2);
                const older = fh.slice(0, Math.min(3, fh.length - 2));
                for (const band of ['low', 'mid', 'high']) {
                    const avgRecent = recent.reduce((s, b) => s + b[band], 0) / recent.length;
                    const avgOlder = older.reduce((s, b) => s + b[band], 0) / older.length;
                    freqDelta[band] = Math.round((avgRecent - avgOlder) * 1000) / 1000;
                }
            }

            // Mise à jour de la baseline vocale (EMA) — converge lentement
            {
                const a = BASELINE_ALPHA;
                let bl = userBaseline.get(userId);
                if (!bl) {
                    bl = {
                        dbMean: avgDb, dbStd: 0,
                        freqMean: { ...freq }, freqStd: { low: 0, mid: 0, high: 0 },
                        sampleCount: 0, lastUpdate: now, dirty: false,
                    };
                    userBaseline.set(userId, bl);
                }
                bl.sampleCount++;
                const prevDbMean = bl.dbMean;
                bl.dbMean += a * (avgDb - bl.dbMean);
                bl.dbStd = Math.sqrt((1 - a) * (bl.dbStd ** 2 + a * (avgDb - prevDbMean) ** 2));
                for (const band of ['low', 'mid', 'high']) {
                    const prev = bl.freqMean[band];
                    bl.freqMean[band] += a * (freq[band] - prev);
                    bl.freqStd[band] = Math.sqrt((1 - a) * (bl.freqStd[band] ** 2 + a * (freq[band] - prev) ** 2));
                }
                bl.lastUpdate = now;
                bl.dirty = true;
            }

            // Détection d'émotion : manuelle (prioritaire) ou automatique (empreintes)
            const fpToken = tokenFor(userId);
            const manual = manualEmotion.get(fpToken);
            const MANUAL_EMOTION_TIMEOUT_MS = 30 * 60 * 1000;
            let detectedEmotion;
            if (manual) {
                if (Date.now() - manual.setAt > MANUAL_EMOTION_TIMEOUT_MS) {
                    manualEmotion.delete(fpToken);
                    detectedEmotion = detectEmotionFromFingerprints(fpToken, {
                        db: Math.round(avgDb * 100) / 100, freq, zcr, centroid, energyVar, formants,
                    }, getUserConfig);
                } else {
                    detectedEmotion = manual.emotion;
                }
            } else {
                detectedEmotion = detectEmotionFromFingerprints(fpToken, {
                    db: Math.round(avgDb * 100) / 100, freq, zcr, centroid, energyVar, formants,
                }, getUserConfig);
            }

            userLevels.set(userId, {
                db: Math.round(avgDb * 100) / 100,
                rms: Math.round(rms * 10000) / 10000,
                freq, freqDelta, zcr, centroid, energyVar, formants,
                detectedEmotion,
                speaking: true,
                displayName,
                updated: now,
            });

            // Accumulation d'empreinte vocale si enregistrement actif (feature premium)
            const recSession = recordingSessions.get(fpToken);
            if (recSession && now - recSession.startedAt < recSession.durationMs) {
                recSession.samples.push({
                    db: Math.round(avgDb * 100) / 100,
                    freq: { ...freq }, zcr, centroid, energyVar,
                    formants: { ...formants },
                });
            }

            sumSq = 0;
            sampleCount = 0;
        }, AUDIO.sampleInterval);

        decoder.on('data', (chunk) => {
            for (let i = 0; i < chunk.length; i += 2) {
                const s = chunk.readInt16LE(i);
                sumSq += s * s;
                sampleCount++;
                // Buffer circulaire O(1) — évite Array.shift() O(n)
                const writeIdx = (freqBufStart + freqBufLen) % FREQ_BUF_CAP;
                freqBuf[writeIdx] = s / 32768;
                if (freqBufLen < FREQ_BUF_CAP) freqBufLen++;
                else freqBufStart = (freqBufStart + 1) % FREQ_BUF_CAP;
            }
        });

        // Cleanup centralisé : ferme les streams et réinitialise l'état utilisateur
        const cleanup = () => {
            clearInterval(tick);
            try { opusStream.destroy(); } catch (_) {}
            try { decoder.destroy(); } catch (_) {}
            const prev = userLevels.get(userId) || {};
            userLevels.set(userId, {
                ...prev,
                db: -100, rms: 0,
                freq: { low: 0, mid: 0, high: 0 },
                freqDelta: { low: 0, mid: 0, high: 0 },
                speaking: false,
                updated: Date.now(),
            });
            // Nettoyage différé des Maps mémoire (5 min après déconnexion)
            setTimeout(() => {
                const cur = userLevels.get(userId);
                if (cur && !cur.speaking && Date.now() - cur.updated > 290_000) {
                    userFreqHistory.delete(userId);
                    const tk = tokenFor(userId);
                    emotionState.delete(tk);
                }
            }, 300_000);
        };

        opusStream.on('end', cleanup);
        opusStream.on('close', cleanup);
        decoder.on('end', cleanup);
        opusStream.on('error', (err) => {
            if (err?.code === 'GenericFailure') return;
            console.error(`opusStream error [${userId}]:`, err.message || err);
        });
        decoder.on('error', (err) => {
            if (err?.message?.includes('corrupted')) return; // premiers paquets opus — normal
            console.error('decoder error:', err);
        });
    } catch (err) {
        console.error('Audio error:', err);
    }
}
