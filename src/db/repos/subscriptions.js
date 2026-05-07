/**
 * Repository subscriptions & seats — abonnements et places streamer
 * ==================================================================
 * Gère deux tables :
 *   - `subscriptions` : abonnement direct d'un utilisateur (free/premium/streamer)
 *   - `subscription_seats` : places allouées par un abonné streamer à d'autres users
 *
 * Le système de seats permet à un abonné streamer de distribuer des accès
 * premium à un nombre limité d'utilisateurs (max_seats).
 *
 * Dépendances : db/database
 */
import { db } from '../database.js';

export const subscriptions = {
  // Récupère uniquement les abonnements actifs (status = 'active')
  get:     db.prepare("SELECT * FROM subscriptions WHERE discord_id = ? AND status = 'active'"),
  getById: db.prepare('SELECT * FROM subscriptions WHERE id = ?'),
  // UPSERT : crée ou renouvelle un abonnement en une seule requête
  upsert:  db.prepare(`
    INSERT INTO subscriptions (discord_id, tier, status, max_seats, expires_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, datetime('now'))
    ON CONFLICT(discord_id) DO UPDATE SET
      tier = excluded.tier, status = 'active',
      max_seats = excluded.max_seats, expires_at = excluded.expires_at,
      updated_at = datetime('now')
  `),
  cancel:  db.prepare("UPDATE subscriptions SET status = 'cancelled', updated_at = datetime('now') WHERE discord_id = ?"),
  // expire est appelé proactivement lors de la résolution du tier d'un utilisateur
  expire:  db.prepare("UPDATE subscriptions SET status = 'expired', updated_at = datetime('now') WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < datetime('now')"),
};

export const seats = {
  // Vérifie si un utilisateur bénéficie d'un seat actif (joint avec subscriptions pour le statut)
  byUser:  db.prepare(`
    SELECT ss.*, s.discord_id AS owner_discord_id, s.tier, s.status AS sub_status
    FROM subscription_seats ss JOIN subscriptions s ON ss.subscription_id = s.id
    WHERE ss.discord_id = ? AND s.status = 'active'
  `),
  bySub:   db.prepare('SELECT * FROM subscription_seats WHERE subscription_id = ?'),
  count:   db.prepare('SELECT COUNT(*) AS cnt FROM subscription_seats WHERE subscription_id = ?'),
  add:     db.prepare('INSERT OR IGNORE INTO subscription_seats (subscription_id, discord_id) VALUES (?, ?)'),
  remove:  db.prepare('DELETE FROM subscription_seats WHERE subscription_id = ? AND discord_id = ?'),
};
