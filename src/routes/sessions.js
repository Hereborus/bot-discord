/**
 * Routes sessions collaboratives — création, participation, invitations
 * ====================================================================
 * Gère le cycle de vie complet des sessions PNGTuber :
 *   - POST /api/sessions                       : créer une session
 *   - GET  /api/sessions                       : mes sessions actives
 *   - GET  /api/sessions/:sessionId            : détails + participants
 *   - POST /api/sessions/:sessionId/end        : terminer (owner ou admin)
 *   - POST /api/sessions/:sessionId/leave      : quitter (soft delete)
 *   - GET  /api/sessions/:sessionId/participants
 *
 * Invitations :
 *   - POST /api/invitations                    : créer (ciblée ou ouverte)
 *   - POST /api/invitations/:id/accept         : accepter + rejoindre la session
 *   - POST /api/invitations/:id/decline        : refuser
 *   - GET  /api/my-invitations                 : invitations reçues en attente
 *
 * Une notification est créée automatiquement lors d'une invitation ciblée
 * et broadcastée en temps réel via WebSocket depuis index.js.
 *
 * Dépendances : node:crypto, http/helpers, db/repos/sessions,
 *               db/repos/appTokens (notifications), services/tokenService
 */
import crypto from 'node:crypto';
import { json } from '../http/helpers.js';
import { psessions, participants, invitations } from '../db/repos/sessions.js';
import { notifications as notifRepo } from '../db/repos/appTokens.js';
import { tokenFor } from '../services/tokenService.js';

// POST /api/sessions
export async function handleCreateSession(req, res, ctx) {
    const { name = 'Session', type = 'standalone', guildId = null, channelId = null, maxParticipants = 10 } = ctx._parsedBody || {};
    const id = crypto.randomUUID();
    psessions.create.run(id, ctx.session.discordId, name, type, guildId, channelId, maxParticipants);
    // Le créateur est automatiquement ajouté comme participant avec le rôle 'owner'
    const token = tokenFor(ctx.session.discordId);
    participants.add.run(id, ctx.session.discordId, token, 'owner');
    json(res, { ok: true, session: psessions.get.get(id) }, 201, req);
}

// GET /api/sessions
export async function handleGetSessions(req, res, ctx) {
    // byUser prend discordId deux fois : pour la clause owner ET la clause participant
    const list = psessions.byUser.all(ctx.session.discordId, ctx.session.discordId);
    json(res, { sessions: list }, 200, req);
}

// GET /api/sessions/:sessionId
export async function handleGetSession(req, res, ctx) {
    const s = psessions.get.get(ctx.params.sessionId);
    if (!s) return json(res, { error: 'Session introuvable' }, 404, req);
    const parts = participants.list.all(ctx.params.sessionId);
    json(res, { session: s, participants: parts }, 200, req);
}

// POST /api/sessions/:sessionId/end
export async function handleEndSession(req, res, ctx) {
    const s = psessions.get.get(ctx.params.sessionId);
    if (!s) return json(res, { error: 'Session introuvable' }, 404, req);
    // Seul le propriétaire ou un admin peut terminer une session
    if (s.owner_discord_id !== ctx.session.discordId && ctx.session.role !== 'admin')
        return json(res, { error: 'Accès refusé' }, 403, req);
    psessions.end.run(ctx.params.sessionId);
    json(res, { ok: true }, 200, req);
}

// POST /api/sessions/:sessionId/leave
export async function handleLeaveSession(req, res, ctx) {
    // Soft delete : left_at est posé, l'historique est conservé
    participants.remove.run(ctx.params.sessionId, ctx.session.discordId);
    json(res, { ok: true }, 200, req);
}

// GET /api/sessions/:sessionId/participants
export async function handleGetParticipants(req, res, ctx) {
    json(res, { participants: participants.list.all(ctx.params.sessionId) }, 200, req);
}

// POST /api/invitations
export async function handleCreateInvitation(req, res, ctx) {
    const { sessionId, invitedDiscordId = null, streamName = null, maxUses = 1, expiresAt = null } = ctx._parsedBody || {};
    if (!sessionId) return json(res, { error: 'sessionId requis' }, 400, req);
    const s = psessions.get.get(sessionId);
    if (!s) return json(res, { error: 'Session introuvable' }, 404, req);

    const id = crypto.randomUUID();
    invitations.create.run(id, sessionId, ctx.session.discordId, invitedDiscordId, maxUses, streamName, expiresAt);

    // Notification persistée uniquement pour les invitations ciblées (pas les liens ouverts)
    if (invitedDiscordId) {
        const payload = JSON.stringify({ inviterName: ctx.session.username, sessionName: s.name, streamName, invitationId: id });
        notifRepo.create.run(invitedDiscordId, 'invitation', payload);
    }
    json(res, { ok: true, invitation: invitations.get.get(id) }, 201, req);
}

// POST /api/invitations/:id/accept
export async function handleAcceptInvitation(req, res, ctx) {
    const inv = invitations.get.get(ctx.params.id);
    if (!inv || inv.status !== 'pending') return json(res, { error: 'Invitation invalide' }, 400, req);
    invitations.updateStatus.run('accepted', ctx.params.id);
    invitations.incrementUse.run(ctx.params.id);
    // Ajouter l'accepteur comme participant avec son token
    const token = tokenFor(ctx.session.discordId);
    participants.add.run(inv.session_id, ctx.session.discordId, token, 'participant');
    json(res, { ok: true }, 200, req);
}

// POST /api/invitations/:id/decline
export async function handleDeclineInvitation(req, res, ctx) {
    invitations.updateStatus.run('declined', ctx.params.id);
    json(res, { ok: true }, 200, req);
}

// GET /api/my-invitations
export async function handleMyInvitations(req, res, ctx) {
    json(res, { invitations: invitations.pending.all(ctx.session.discordId) }, 200, req);
}
