/**
 * Routes admin — permissions, DB browser, suppression d'utilisateur
 * ==================================================================
 * Endpoints réservés à l'administrateur :
 *   - GET    /api/permissions             : liste de tous les rôles
 *   - POST   /api/permissions             : attribuer un rôle
 *   - DELETE /api/permissions/:discordId  : révoquer un rôle
 *   - GET    /api/permissions/me          : mon propre rôle (tout utilisateur connecté)
 *   - GET    /api/db/stats                : statistiques globales (users, frames, taille)
 *   - GET    /api/db/frames               : liste complète des frames (DB browser)
 *   - POST   /delete-user/:token          : supprimer un utilisateur + toutes ses données
 *
 * handleDeleteUser effectue une suppression en cascade :
 *   fichiers disque → frames DB → user DB (dans cet ordre pour la cohérence).
 *
 * Dépendances : http/helpers, db/repos/permissions, db/repos/users,
 *               node:path, node:fs, db/database (import dynamique)
 */
import { json } from '../http/helpers.js';
import { permissions as permRepo } from '../db/repos/permissions.js';
import { users as userRepo, frames as frameRepo } from '../db/repos/users.js';
import path from 'node:path';
import fs from 'node:fs';

const DATA_ROOT  = process.env.DATA_ROOT || process.cwd();
const IMAGES_DIR = path.join(DATA_ROOT, 'images');

// GET /api/permissions
export async function handleGetPermissions(req, res, ctx) {
    const rows = permRepo.all.all();
    // Transformer la liste en objet indexé par discordId pour faciliter la lecture côté client
    const users = {};
    for (const r of rows) {
        users[r.discord_id] = {
            role: r.role, grantedBy: r.granted_by,
            grantedAt: r.granted_at, displayName: r.display_name,
            guilds: JSON.parse(r.guilds_json || '[]'),
        };
    }
    json(res, { version: 1, users }, 200, req);
}

// POST /api/permissions
export async function handleSetPermission(req, res, ctx) {
    const { discordId, role } = ctx._parsedBody || {};
    // Whitelist des rôles autorisés — évite d'insérer des valeurs arbitraires
    if (!discordId || !['admin', 'client', 'viewer'].includes(role))
        return json(res, { error: 'Données invalides' }, 400, req);
    permRepo.upsert.run(discordId, role, ctx.session.discordId, discordId, '[]');
    json(res, { ok: true }, 200, req);
}

// DELETE /api/permissions/:discordId
export async function handleDeletePermission(req, res, ctx) {
    permRepo.delete.run(ctx.params.discordId);
    json(res, { ok: true }, 200, req);
}

// GET /api/permissions/me (accessible à tout utilisateur connecté, pas admin uniquement)
export async function handlePermissionsMe(req, res, ctx) {
    const row = permRepo.get.get(ctx.session.discordId);
    json(res, { role: row?.role || 'viewer', discordId: ctx.session.discordId }, 200, req);
}

// GET /api/db/stats
export async function handleDbStats(req, res, ctx) {
    json(res, frameRepo.stats.get(), 200, req);
}

// GET /api/db/frames
export async function handleDbFrames(req, res, ctx) {
    json(res, { frames: frameRepo.allForAdmin.all() }, 200, req);
}

// POST /delete-user/:token
export async function handleDeleteUser(req, res, ctx) {
    const { token } = ctx.params;
    userRepo.get.get(token); // vérifier existence (non utilisé mais conservé pour la logique)
    frameRepo.deleteAll.run(token);
    // Supprimer le dossier d'images si l'utilisateur existe
    userRepo.get.get(token) && (() => {
        try { fs.rmSync(path.join(IMAGES_DIR, token), { recursive: true, force: true }); } catch {}
    })();
    // Import dynamique pour éviter une dépendance circulaire au niveau module
    const db = (await import('../db/database.js')).db;
    db.prepare('DELETE FROM users WHERE token = ?').run(token);
    json(res, { ok: true }, 200, req);
}
