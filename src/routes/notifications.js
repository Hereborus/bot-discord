/**
 * Routes notifications — lecture et marquage
 * ===========================================
 * Trois endpoints pour la gestion des notifications in-app :
 *   - GET  /api/notifications        : liste (tout ou non-lues uniquement)
 *   - POST /api/notifications/:id/read    : marquer une notification comme lue
 *   - POST /api/notifications/read-all   : tout marquer comme lu
 *
 * Les notifications sont créées par d'autres routes (sessions.js pour les
 * invitations) et broadcastées en temps réel via WebSocket depuis index.js.
 *
 * Dépendances : http/helpers, db/repos/appTokens (notifications)
 */
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
    // Le discordId est passé pour éviter qu'un user marque les notifs d'un autre
    notifRepo.markRead.run(Number(ctx.params.id), ctx.session.discordId);
    json(res, { ok: true }, 200, req);
}

// POST /api/notifications/read-all
export async function handleMarkAllRead(req, res, ctx) {
    notifRepo.markAllRead.run(ctx.session.discordId);
    json(res, { ok: true }, 200, req);
}
