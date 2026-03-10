import { db } from '../database.js';

export const appTokens = {
  create:   db.prepare('INSERT INTO app_tokens (token_hash, discord_id, device_name) VALUES (?, ?, ?)'),
  get:      db.prepare('SELECT * FROM app_tokens WHERE token_hash = ? AND revoked_at IS NULL'),
  byUser:   db.prepare('SELECT id, device_name, last_used_at, created_at FROM app_tokens WHERE discord_id = ? AND revoked_at IS NULL'),
  revoke:   db.prepare("UPDATE app_tokens SET revoked_at = datetime('now') WHERE id = ? AND discord_id = ?"),
  touch:    db.prepare("UPDATE app_tokens SET last_used_at = datetime('now') WHERE token_hash = ?"),
  revokeAll: db.prepare("UPDATE app_tokens SET revoked_at = datetime('now') WHERE discord_id = ?"),
};

export const notifications = {
  create:      db.prepare('INSERT INTO notifications (discord_id, type, payload_json) VALUES (?, ?, ?)'),
  list:        db.prepare('SELECT * FROM notifications WHERE discord_id = ? ORDER BY created_at DESC LIMIT ?'),
  unread:      db.prepare('SELECT * FROM notifications WHERE discord_id = ? AND read = 0 ORDER BY created_at DESC LIMIT ?'),
  countUnread: db.prepare('SELECT COUNT(*) AS cnt FROM notifications WHERE discord_id = ? AND read = 0'),
  markRead:    db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND discord_id = ?'),
  markAllRead: db.prepare('UPDATE notifications SET read = 1 WHERE discord_id = ? AND read = 0'),
};
