// ── Routes abonnements ────────────────────────────────────────────
import { json, parseJsonBody } from '../http/helpers.js';
import { subscriptions as subRepo, seats as seatsRepo } from '../db/repos/subscriptions.js';
import { getUserTier, TIER_LIMITS } from '../services/tierService.js';

// GET /api/subscription
export async function handleGetSubscription(req, res, ctx) {
    const sub  = subRepo.get.get(ctx.session.discordId);
    const tier = getUserTier(ctx.session.discordId);
    json(res, { subscription: sub || null, tier, tierLimits: TIER_LIMITS[tier] }, 200, req);
}

// POST /api/subscription (admin)
export async function handleSetSubscription(req, res, ctx) {
    const { discordId, tier, maxSeats = 1, expiresAt = null } = ctx._parsedBody || {};
    if (!discordId || !tier) return json(res, { error: 'Données manquantes' }, 400, req);
    subRepo.upsert.run(discordId, tier, maxSeats, expiresAt);
    json(res, { ok: true }, 200, req);
}

// DELETE /api/subscription/:discordId (admin)
export async function handleCancelSubscription(req, res, ctx) {
    subRepo.cancel.run(ctx.params.discordId);
    json(res, { ok: true }, 200, req);
}

// GET /api/subscription/seats
export async function handleGetSeats(req, res, ctx) {
    const sub = subRepo.get.get(ctx.session.discordId);
    if (!sub) return json(res, { seats: [] }, 200, req);
    json(res, { seats: seatsRepo.bySub.all(sub.id) }, 200, req);
}

// POST /api/subscription/seats
export async function handleAddSeat(req, res, ctx) {
    const { discordId } = ctx._parsedBody || {};
    if (!discordId) return json(res, { error: 'discordId requis' }, 400, req);
    const sub = subRepo.get.get(ctx.session.discordId);
    if (!sub) return json(res, { error: 'Aucun abonnement actif' }, 400, req);
    const count = seatsRepo.count.get(sub.id)?.cnt || 0;
    if (count >= sub.max_seats) return json(res, { error: 'Nombre de sièges maximum atteint' }, 400, req);
    seatsRepo.add.run(sub.id, discordId);
    json(res, { ok: true }, 200, req);
}

// DELETE /api/subscription/seats/:discordId
export async function handleRemoveSeat(req, res, ctx) {
    const sub = subRepo.get.get(ctx.session.discordId);
    if (!sub) return json(res, { error: 'Aucun abonnement actif' }, 400, req);
    seatsRepo.remove.run(sub.id, ctx.params.discordId);
    json(res, { ok: true }, 200, req);
}
