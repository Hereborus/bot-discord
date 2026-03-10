// ── Service audio — pipeline Opus → PCM → RMS → FFT ─────────────
// Singleton de module : userLevels, baselines, etc. vivent ici.
// subscribeUser() est appelé depuis le Discord client à chaque connexion vocale.
export const userLevels       = new Map(); // userId → { db, speaking, freq, ... }
export const userFreqHistory  = new Map(); // userId → [{ db, freq, ts }]
export const userBaseline     = new Map(); // userId → { dbMean, dbStd, ... }
export const recordingSessions = new Map(); // token → { samples, startedAt }

// Config audio centralisée
export const AUDIO = {
    sampleRate:    48000,
    sampleInterval: 50,
    durationWindow: 100,
    fftSize:        1024,
    freqBands: {
        low:  { min: 20,   max: 500   },
        mid:  { min: 500,  max: 2000  },
        high: { min: 2000, max: 10000 },
    },
};

// Les fonctions subscribeUser, computeFreqBands, computeEmotion restent
// dans index.js pour l'instant — elles dépendent de prism-media, fft-js
// et du client Discord (receiver). Migration complète = étape suivante.
