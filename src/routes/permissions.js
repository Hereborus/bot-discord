/**
 * Routes API Permissions et Avatar
 * ==================================
 * Gère les rôles utilisateurs et les autorisations d'avatar par serveur :
 *   GET    /api/permissions             → liste permissions (admin)
 *   POST   /api/permissions             → ajouter/modifier permission (admin)
 *   DELETE /api/permissions/:discordId  → supprimer permission (admin)
 *   GET    /api/permissions/me          → mes permissions (auth)
 *   GET    /api/my-token                → mon token opaque (auth)
 *   GET    /api/avatar-permissions/:token → autorisations serveur d'un user
 *   POST   /api/avatar-permissions       → définir une autorisation serveur
 *
 * Dépendances injectées via `deps` :
 *   stmts, getUserRole, tokenFor, getSession, json, readBody
 */

import { json, readBody } from '../http/helpers.js';
import { tokenFor } from '../services/tokenService.js';
import { getUserRole, getSession } from '../services/authService.js';

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Charge toutes les permissions depuis la DB et les retourne sous forme de dictionnaire.
 * @param {object} stmts - alias repos SQLite
 * @returns {{ version: number, users: object }}
 */
function loadPermissions(stmts) {
    const rows = stmts.allPermissions.all();
    const users = {};
    for (const r of rows) {
        users[r.discord_id] = {
            role: r.role,
            grantedBy: r.granted_by,
            grantedAt: r.granted_at,
            displayName: r.display_name,
            guilds: JSON.parse(r.guilds_json || '[]'),
        };
    }
    return { version: 1, users };
}

/**
 * Vérifie si un token est autorisé sur un guild Discord.
 * Retourne true si aucun contexte serveur (rétrocompatibilité).
 * @param {object} stmts - alias repos SQLite
 * @param {string} token
 * @param {string} guildId
 * @returns {boolean}
 */
export function isAvatarAllowed(stmts, token, guildId) {
    if (!guildId) return true; // pas de contexte serveur → autorisé
    const row = stmts.getAvatarPerm.get(token, guildId);
    return row ? !!row.allowed : true; // autorisé par défaut si aucune règle explicite
}

// ── Handlers permission ───────────────────────────────────────────

/**
 * GET /api/permissions — liste toutes les permissions (admin uniquement)
 */
export async function handleGetPermissions(req, res, ctx, { stmts }) {
    return json(res, loadPermissions(stmts), 200, req);
}

/**
 * POST /api/permissions — ajouter ou modifier un rôle (admin uniquement)
 */
export async function handleSetPermission(req, res, ctx, { stmts }) {
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    if (!body.discordId || !body.role) return json(res, { error: 'discordId et role requis' }, 400, req);
    if (!['admin', 'client', 'viewer'].includes(body.role)) return json(res, { error: 'Rôle invalide' }, 400, req);
    stmts.upsertPermission.run(
        body.discordId, body.role,
        ctx.session?.discordId || null,
        body.displayName || 'Unknown',
        JSON.stringify(body.guilds || []),
    );
    return json(res, { ok: true }, 200, req);
}

/**
 * DELETE /api/permissions/:discordId — supprimer une permission (admin uniquement)
 */
export async function handleDeletePermission(req, res, ctx, { stmts }) {
    stmts.deletePermission.run(ctx.params.discordId);
    return json(res, { ok: true }, 200, req);
}

/**
 * GET /api/permissions/me — retourne le rôle et les guilds de l'utilisateur connecté
 */
export async function handleGetMyPermissions(req, res, ctx, { stmts }) {
    const session = ctx.session || getSession(req);
    if (!session) return json(res, { error: 'Non authentifié' }, 401, req);
    const role = getUserRole(session.discordId);
    const row = stmts.getPermission.get(session.discordId);
    const guilds = row ? JSON.parse(row.guilds_json || '[]') : null;
    return json(res, { role, guilds }, 200, req);
}

/**
 * GET /api/my-token — retourne le token opaque de l'utilisateur connecté
 */
export async function handleMyToken(req, res, ctx) {
    const session = ctx.session || getSession(req);
    if (!session) return json(res, { error: 'Non authentifié' }, 401, req);
    const token = tokenFor(session.discordId);
    return json(res, { token, displayName: session.username }, 200, req);
}

// ── Handlers avatar permissions ───────────────────────────────────

/**
 * GET /api/avatar-permissions/:token
 * Liste les autorisations serveur d'un utilisateur.
 * Enrichit avec les noms de serveurs si le bot est connecté.
 */
export async function handleGetAvatarPerms(req, res, ctx, { stmts, client, botConnected }) {
    const token = ctx.params.token;
    const rows = stmts.getAvatarPerms.all(token);
    const perms = rows.map(r => {
        const guild = botConnected ? client.guilds.cache.get(r.guild_id) : null;
        return {
            guildId: r.guild_id,
            guildName: guild?.name || r.guild_id,
            guildIcon: guild?.iconURL({ size: 64 }) || null,
            allowed: !!r.allowed,
        };
    });
    return json(res, perms, 200, req);
}

/**
 * POST /api/avatar-permissions
 * Définit l'autorisation d'un avatar sur un serveur.
 * Vérifie que le user est propriétaire du token (ou admin).
 */
export async function handleSetAvatarPerm(req, res, ctx, { stmts }) {
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    if (!body.token || !body.guildId) return json(res, { error: 'token et guildId requis' }, 400, req);
    // Vérifier que le user est autorisé (admin ou propriétaire du token)
    const isAdmin = (ctx.session?.testRole || ctx.session?.role) === 'admin';
    if (!isAdmin) {
        const myToken = tokenFor(ctx.session.discordId);
        if (body.token !== myToken) return json(res, { error: 'Non autorisé' }, 403, req);
    }
    stmts.upsertAvatarPerm.run(body.token, body.guildId, body.allowed ? 1 : 0);
    return json(res, { ok: true }, 200, req);
}
