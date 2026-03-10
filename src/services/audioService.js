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
export const userLevels       = new Map(); // userId → { db, speaking, freq, ... }

// Historique glissant pour le lissage temporel (fenêtre de 100 ticks ~5s)
export const userFreqHistory  = new Map(); // userId → [{ db, freq, ts }]

// Baseline acoustique calculée à partir de l'historique (dbMean, dbStd, etc.)
export const userBaseline     = new Map(); // userId → { dbMean, dbStd, ... }

// Sessions d'enregistrement d'empreintes vocales (feature premium)
export const recordingSessions = new Map(); // token → { samples, startedAt }

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
