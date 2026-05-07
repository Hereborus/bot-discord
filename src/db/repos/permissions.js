/**
 * Repository permissions & avatar_permissions — rôles et accès par guilde
 * =========================================================================
 * Gère deux tables :
 *   - `permissions` : rôle global d'un utilisateur Discord (admin / client / viewer)
 *   - `avatar_permissions` : visibilité d'un avatar dans une guilde spécifique
 *
 * Les rôles sont stockés par discordId (pas par token) pour que l'admin
 * puisse attribuer un rôle avant même que l'utilisateur se connecte.
 *
 * Dépendances : db/database
 */
import { db } from '../database.js';

export const permissions = {
  get:    db.prepare('SELECT * FROM permissions WHERE discord_id = ?'),
  // UPSERT : met à jour le rôle et les métadonnées si l'entrée existe déjà
  upsert: db.prepare(`
    INSERT INTO permissions (discord_id, role, granted_by, display_name, guilds_json)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      role = excluded.role, granted_by = excluded.granted_by,
      display_name = excluded.display_name, guilds_json = excluded.guilds_json,
      granted_at = datetime('now')
  `),
  delete: db.prepare('DELETE FROM permissions WHERE discord_id = ?'),
  all:    db.prepare('SELECT * FROM permissions'),
};

// Contrôle d'accès granulaire par guilde — non utilisé activement dans l'UI actuelle
export const avatarPerms = {
  byToken: db.prepare('SELECT guild_id, allowed FROM avatar_permissions WHERE token = ?'),
  get:     db.prepare('SELECT allowed FROM avatar_permissions WHERE token = ? AND guild_id = ?'),
  upsert:  db.prepare(`
    INSERT INTO avatar_permissions (token, guild_id, allowed, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(token, guild_id) DO UPDATE SET
      allowed = excluded.allowed, updated_at = datetime('now')
  `),
};
