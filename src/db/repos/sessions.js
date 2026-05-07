/**
 * Repository sessions, participants & invitations
 * ================================================
 * Gère trois tables liées par CASCADE :
 *   - `pngtuber_sessions` : session collaborative (voice ou standalone)
 *   - `session_participants` : qui participe, avec quel token, quel rôle
 *   - `invitations` : invitations ciblées ou ouvertes vers une session
 *
 * La suppression d'une session (ON DELETE CASCADE) entraîne automatiquement
 * la suppression de ses participants et invitations associées.
 *
 * Dépendances : db/database
 */
import { db } from '../database.js';

export const psessions = {
  create:      db.prepare('INSERT INTO pngtuber_sessions (id, owner_discord_id, name, type, guild_id, channel_id, status, max_participants) VALUES (?, ?, ?, ?, ?, ?, \'active\', ?)'),
  get:         db.prepare('SELECT * FROM pngtuber_sessions WHERE id = ?'),
  end:         db.prepare("UPDATE pngtuber_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?"),
  // Retrouver une session vocale active pour un canal donné (auto-création à la connexion)
  activeVoice: db.prepare("SELECT * FROM pngtuber_sessions WHERE guild_id = ? AND channel_id = ? AND status = 'active' LIMIT 1"),
  // Sessions où l'utilisateur est owner OU participant actif (left_at IS NULL)
  byUser:      db.prepare(`
    SELECT DISTINCT s.* FROM pngtuber_sessions s
    LEFT JOIN session_participants sp ON s.id = sp.session_id
    WHERE (s.owner_discord_id = ? OR (sp.discord_id = ? AND sp.left_at IS NULL))
    AND s.status = 'active' ORDER BY s.created_at DESC
  `),
};

export const participants = {
  add:    db.prepare('INSERT OR IGNORE INTO session_participants (session_id, discord_id, token, role) VALUES (?, ?, ?, ?)'),
  // Quitter une session : on pose left_at plutôt que de supprimer (historique conservé)
  remove: db.prepare("UPDATE session_participants SET left_at = datetime('now') WHERE session_id = ? AND discord_id = ? AND left_at IS NULL"),
  list:   db.prepare('SELECT * FROM session_participants WHERE session_id = ? AND left_at IS NULL'),
  check:  db.prepare('SELECT 1 FROM session_participants WHERE session_id = ? AND discord_id = ? AND left_at IS NULL'),
};

export const invitations = {
  create:       db.prepare('INSERT INTO invitations (id, session_id, invited_by, invited_discord_id, max_uses, stream_name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  // Joint avec pngtuber_sessions pour exposer session_name et owner_discord_id en une requête
  get:          db.prepare('SELECT i.*, s.name AS session_name, s.owner_discord_id FROM invitations i JOIN pngtuber_sessions s ON i.session_id = s.id WHERE i.id = ?'),
  updateStatus: db.prepare('UPDATE invitations SET status = ? WHERE id = ?'),
  incrementUse: db.prepare('UPDATE invitations SET use_count = use_count + 1 WHERE id = ?'),
  // Invitations en attente pour un utilisateur (pour la cloche de notification)
  pending:      db.prepare("SELECT i.*, s.name AS session_name FROM invitations i JOIN pngtuber_sessions s ON i.session_id = s.id WHERE i.invited_discord_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC"),
  bySession:    db.prepare('SELECT * FROM invitations WHERE session_id = ? ORDER BY created_at DESC'),
};
