/**
 * Audio Service — état partagé du pipeline audio
 * ================================================
 * Ce module exporte les structures de données utilisées par le pipeline
 * audio (Opus → PCM → RMS/dB → FFT → bandes de fréquences). Il sert de
 * source de vérité unique pour les niveaux audio en mémoire.
 *
 * Note d'architecture : les fonctions de traitement (subscribeUser,
 * computeFreqBands, computeEmotion) restent dans index.js car elles
 * dépendent de prism-media, fft-js et de l'instance Discord client.
 * Ce module sera enrichi lors de la migration complète du pipeline.
 *
 * Dépendances : aucune (module de données pur)
 */

// Niveaux audio courants par utilisateur, mis à jour toutes les ~50ms
export const userLevels       = new Map(); // userId → { db, speaking, freq, formants, ... }

// Historique glissant pour le lissage temporel (fenêtre de 100 ticks ~5s)
export const userFreqHistory  = new Map(); // userId → [{ db, freq, ts }]

// Baseline acoustique EMA (dB + bandes de fréquence) pour l'auto-seuillage
export const userBaseline     = new Map(); // userId → { dbMean, dbStd, freqMean, freqStd, ... }

// ── Profil vocal passif ──────────────────────────────────────────────────────
// Enregistrement automatique de 10 marqueurs spectraux/fréquentiels pendant la parole.
// Aucune action utilisateur requise — s'auto-construit par écoute passive.
// Format DB : cfg.voiceProfile = { n, markers: { [key]: { min,p10,p25,p50,p75,p90,max,mean } }, updatedAt }

// 10 marqueurs couvrant les dimensions clés de la voix humaine
export const PROFILE_MARKERS = [
    'db',        // niveau sonore moyen (dB)
    'zcr',       // zero-crossing rate (rugosité/agressivité)
    'centroid',  // centroïde spectral (brillance/aigu)
    'energyVar', // variance d'énergie (stabilité)
    'freq_low',  // énergie basse fréquence (fondamentale)
    'freq_mid',  // énergie médium (présence vocale)
    'freq_high', // énergie haute (sibilance/tension)
    'f1',        // 1er formant — ouverture / arousal
    'f2',        // 2ème formant — position langue / valence
    'f3',        // 3ème formant — tension vocale
];
export const PROFILE_BUF_SIZE    = 1000; // ~50s de parole à 50ms/tick, fenêtre glissante
export const PROFILE_STATS_EVERY = 50;   // recalculer les stats tous les 50 nouveaux samples

// Buffers circulaires bruts (mémoire) — un Float32Array par marqueur par user
export const voiceProfiles   = new Map(); // userId → { bufs, head, filled, total, dirty }

// Cache des stats calculées (min/p10..p90/max/mean) — mis à jour tous les PROFILE_STATS_EVERY ticks
// Utilisé par computeFormants() pour l'affinage adaptatif sans tri en hot-path
export const voiceStatsCache  = new Map(); // userId → { n, markers: { [key]: stats } }

// Config audio centralisée — référence unique pour les constantes du pipeline
export const AUDIO = {
    sampleRate:    48000,  // fréquence Opus Discord standard
    sampleInterval: 50,    // ms entre deux ticks d'analyse
    durationWindow: 100,   // nombre de ticks dans la fenêtre glissante
    fftSize:        1024,  // points FFT (compromis résolution/perfo à 48kHz)
    freqBands: {
        low:  { min: 20,   max: 500   }, // graves (voix fondamentale)
        mid:  { min: 500,  max: 2000  }, // médiums (présence vocale)
        high: { min: 2000, max: 10000 }, // aigus (sibilances, émotion)
    },
};
