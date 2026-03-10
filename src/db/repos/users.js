/**
 * Repository users & frames — accès aux données des avatars
 * ===========================================================
 * Regroupe les prepared statements pour les tables `users` et `frames`.
 * Les statements sont compilés une seule fois au chargement du module et
 * réutilisés à chaque appel — plus performant que de préparer à la volée.
 * La séparation code/données prévient les injections SQL.
 *
 * Dépendances : db/database
 */
import { db } from '../database.js';

export const users = {
  get:    db.prepare('SELECT * FROM users WHERE token = ?'),
  // UPSERT : crée l'utilisateur ou met à jour display_name et config si il existe déjà
  upsert: db.prepare(`
    INSERT INTO users (token, display_name, config_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(token) DO UPDATE SET
      display_name = excluded.display_name,
      config_json  = excluded.config_json,
      updated_at   = datetime('now')
  `),
  getConfig: db.prepare('SELECT config_json FROM users WHERE token = ?'),
  setConfig: db.prepare("UPDATE users SET config_json = ?, updated_at = datetime('now') WHERE token = ?"),
  all:       db.prepare('SELECT token, display_name, config_json FROM users'),
};

export const frames = {
  // Récupère toutes les frames triées par state puis par order — utilisé pour /frames/:token
  byToken:     db.prepare('SELECT filename, state_key, sort_order FROM frames WHERE token = ? ORDER BY state_key, sort_order'),
  byState:     db.prepare('SELECT filename FROM frames WHERE token = ? AND state_key = ? ORDER BY sort_order'),
  insert:      db.prepare('INSERT OR IGNORE INTO frames (token, state_key, filename, sort_order, original_ext, file_size) VALUES (?, ?, ?, ?, ?, ?)'),
  delete:      db.prepare('DELETE FROM frames WHERE token = ? AND state_key = ? AND filename = ?'),
  deleteAll:   db.prepare('DELETE FROM frames WHERE token = ?'),
  updateOrder: db.prepare('UPDATE frames SET sort_order = ? WHERE token = ? AND state_key = ? AND filename = ?'),
  // COALESCE(-1) → la prochaine frame sera à l'index 0 si la table est vide
  maxOrder:    db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM frames WHERE token = ? AND state_key = ?'),
  move:        db.prepare('UPDATE frames SET state_key = ? WHERE token = ? AND state_key = ? AND filename = ?'),
  // Requêtes pour le DB browser (admin)
  stats:       db.prepare('SELECT (SELECT COUNT(*) FROM users) AS user_count, (SELECT COUNT(*) FROM frames) AS frame_count, (SELECT COALESCE(SUM(file_size),0) FROM frames) AS total_size'),
  allForAdmin: db.prepare('SELECT f.token, f.state_key, f.filename, f.original_ext, f.file_size, f.created_at, u.display_name FROM frames f LEFT JOIN users u ON f.token = u.token ORDER BY f.token, f.state_key, f.sort_order'),
};
