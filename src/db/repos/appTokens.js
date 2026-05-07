/**
 * Repository app_tokens & notifications
 * ======================================
 * Gère deux tables regroupées dans ce fichier par cohérence fonctionnelle
 * (les notifications sont liées aux actions des app tokens / invitations) :
 *   - `app_tokens` : tokens Bearer pour les agents locaux (Device Auth Flow)
 *   - `notifications` : notifications persistées par discordId
 *
 * Les tokens ne sont jamais stockés en clair — uniquement leur hash SHA-256.
 * La révocation est douce (revoked_at) pour conserver l'historique d'audit.
 *
 * Dépendances : db/database
 */
import { db } from '../database.js';

export const appTokens = {
  create:    db.prepare('INSERT INTO app_tokens (token_hash, discord_id, device_name) VALUES (?, ?, ?)'),
  // Filtre les tokens révoqués — revoked_at IS NULL = token actif
  get:       db.prepare('SELECT * FROM app_tokens WHERE token_hash = ? AND revoked_at IS NULL'),
  // N'expose pas token_hash dans la liste (pas besoin côté client)
  byUser:    db.prepare('SELECT id, device_name, last_used_at, created_at FROM app_tokens WHERE discord_id = ? AND revoked_at IS NULL'),
  // Révocation par ID + discordId pour éviter qu'un user révoque le token d'un autre
  revoke:    db.prepare("UPDATE app_tokens SET revoked_at = datetime('now') WHERE id = ? AND discord_id = ?"),
  // touch met à jour last_used_at à chaque requête authentifiée par Bearer
  touch:     db.prepare("UPDATE app_tokens SET last_used_at = datetime('now') WHERE token_hash = ?"),
  revokeAll: db.prepare("UPDATE app_tokens SET revoked_at = datetime('now') WHERE discord_id = ?"),
};

export const notifications = {
  create:      db.prepare('INSERT INTO notifications (discord_id, type, payload_json) VALUES (?, ?, ?)'),
  list:        db.prepare('SELECT * FROM notifications WHERE discord_id = ? ORDER BY created_at DESC LIMIT ?'),
  unread:      db.prepare('SELECT * FROM notifications WHERE discord_id = ? AND read = 0 ORDER BY created_at DESC LIMIT ?'),
  countUnread: db.prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE discord_id = ? AND read = 0'),
  markRead:    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND discord_id = ?'),
  // Vérifier le discordId évite de marquer les notifs d'un autre utilisateur comme lues
  markAllRead: db.prepare('UPDATE notifications SET read = 1 WHERE discord_id = ? AND read = 0'),
};
