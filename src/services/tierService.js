// ── Système de tiers premium ─────────────────────────────────────
// Résolution dans l'ordre : abonnement direct → seat streamer → free
import { subscriptions, seats } from '../db/repos/subscriptions.js';

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
    // 1. Abonnement direct actif
    const sub = subscriptions.get.get(discordId);
    if (sub) {
        if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
            subscriptions.expire.run(); // nettoyer les expirés
        } else {
            return sub.tier;
        }
    }
    // 2. Couvert par un pack streamer (seat)
    const seat = seats.byUser.get(discordId);
    if (seat && seat.sub_status === 'active') return 'premium';
    return 'free';
}

// Middleware : injecte ctx.tier et ctx.tierLimits
export function loadTier(req, res, ctx) {
    if (!ctx.session) return true;
    ctx.tier = getUserTier(ctx.session.discordId);
    ctx.tierLimits = TIER_LIMITS[ctx.tier] || TIER_LIMITS.free;
    return true;
}

// Middleware : bloque si tier free
export function requirePremium(req, res, ctx) {
    if (!ctx.tier || ctx.tier === 'free') {
        return false; // réponse gérée par l'appelant
    }
    return true;
}
