/**
 * Tier Service — système de tiers et limites premium
 * ====================================================
 * Définit les trois niveaux d'accès (free / premium / streamer) et leurs
 * limites respectives. La résolution du tier d'un utilisateur suit cet
 * ordre de priorité : abonnement direct actif → seat dans un pack streamer
 * → free par défaut.
 *
 * Dépendances : db/repos/subscriptions
 */
import { subscriptions, seats } from '../db/repos/subscriptions.js';

// Limites par tier — Infinity = pas de limite imposée par le code
export const TIER_LIMITS = {
    free: {
        maxStates: 2, maxClosedStates: 2, maxFramesPerState: 3,
        emotionsEnabled: false, hotkeysEnabled: false,
        miniAppEnabled: false, calibrationEnabled: false,
        maxSessionParticipants: 3,
    },
    premium: {
        maxStates: Infinity, maxClosedStates: Infinity, maxFramesPerState: Infinity,
        emotionsEnabled: true, hotkeysEnabled: true,
        miniAppEnabled: true, calibrationEnabled: true,
        maxSessionParticipants: 10,
    },
    streamer: {
        maxStates: Infinity, maxClosedStates: Infinity, maxFramesPerState: Infinity,
        emotionsEnabled: true, hotkeysEnabled: true,
        miniAppEnabled: true, calibrationEnabled: true,
        maxSessionParticipants: 20,
    },
};

export function getUserTier(discordId) {
    // 1. Abonnement direct actif — le plus prioritaire
    const sub = subscriptions.get.get(discordId);
    if (sub) {
        if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
            // Nettoyer en base plutôt que laisser des abonnements expirés trainer
            subscriptions.expire.run();
        } else {
            return sub.tier;
        }
    }
    // 2. Couvert par un pack streamer (seat alloué par un autre abonné)
    const seat = seats.byUser.get(discordId);
    if (seat && seat.sub_status === 'active') return 'premium';
    // 3. Tier par défaut
    return 'free';
}

// Middleware : injecte ctx.tier et ctx.tierLimits pour les routes qui en ont besoin
export function loadTier(req, res, ctx) {
    if (!ctx.session) return true;
    ctx.tier = getUserTier(ctx.session.discordId);
    ctx.tierLimits = TIER_LIMITS[ctx.tier] || TIER_LIMITS.free;
    return true;
}

// Middleware : bloque l'accès si l'utilisateur est sur le tier free
export function requirePremium(req, res, ctx) {
    if (!ctx.tier || ctx.tier === 'free') {
        return false; // réponse gérée par l'appelant (ex: 403)
    }
    return true;
}
