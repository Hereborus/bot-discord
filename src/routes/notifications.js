// ── Routes notifications ─────────────────────────────────────────
import { json } from '../http/helpers.js';
import { notifications as notifRepo } from '../db/repos/appTokens.js';

// GET /api/notifications
export async function handleGetNotifications(req, res, ctx) {
    const discordId = ctx.session.discordId;
    const limit     = parseInt(ctx.url.searchParams.get('limit') || '20', 10);
    const unreadOnly = ctx.url.searchParams.get('unread') === 'true';
    const rows = unreadOnly
        ? notifRepo.unread.all(discordId, limit)
        : notifRepo.list.all(discordId, limit);
    json(res, { notifications: rows }, 200, req);
}

// POST /api/notifications/:id/read
export async function handleMarkRead(req, res, ctx) {
    notifRepo.markRead.run(Number(ctx.params.id), ctx.session.discordId);
    json(res, { ok: true }, 200, req);
}

// POST /api/notifications/read-all
export async function handleMarkAllRead(req, res, ctx) {
    notifRepo.markAllRead.run(ctx.session.discordId);
    json(res, { ok: true }, 200, req);
}
