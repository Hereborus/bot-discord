// ── Initialisation SQLite ────────────────────────────────────────
// Ce module exporte une instance db unique (singleton de module ES).
// Tous les repositories importent cette instance — une seule connexion
// est partagée, ce qui est correct pour SQLite mono-processus.
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DATA_ROOT = process.env.DATA_ROOT || process.cwd();
if (!fs.existsSync(DATA_ROOT)) fs.mkdirSync(DATA_ROOT, { recursive: true });

const DB_PATH = path.join(DATA_ROOT, 'pngtuber.db');
export const db = new Database(DB_PATH);

// WAL : lectures non bloquées par les écritures
db.pragma('journal_mode = WAL');
// Appliquer les ON DELETE CASCADE définis dans le schéma
db.pragma('foreign_keys = ON');

// ── Schéma ───────────────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        token        TEXT PRIMARY KEY,
        display_name TEXT DEFAULT '???',
        config_json  TEXT DEFAULT '{}',
        created_at   TEXT DEFAULT (datetime('now')),
        updated_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS frames (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        token        TEXT NOT NULL,
        state_key    TEXT NOT NULL,
        filename     TEXT NOT NULL,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        original_ext TEXT,
        file_size    INTEGER DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now')),
        UNIQUE(token, state_key, filename)
    );
    CREATE INDEX IF NOT EXISTS idx_frames_token_state ON frames(token, state_key);
    CREATE TABLE IF NOT EXISTS permissions (
        discord_id   TEXT PRIMARY KEY,
        role         TEXT NOT NULL DEFAULT 'viewer',
        granted_by   TEXT,
        granted_at   TEXT DEFAULT (datetime('now')),
        display_name TEXT DEFAULT 'Unknown',
        guilds_json  TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS avatar_permissions (
        token     TEXT NOT NULL,
        guild_id  TEXT NOT NULL,
        allowed   INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY(token, guild_id)
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id    TEXT NOT NULL UNIQUE,
        tier          TEXT NOT NULL DEFAULT 'free',
        status        TEXT NOT NULL DEFAULT 'active',
        max_seats     INTEGER NOT NULL DEFAULT 1,
        stripe_sub_id TEXT,
        started_at    TEXT DEFAULT (datetime('now')),
        expires_at    TEXT,
        created_at    TEXT DEFAULT (datetime('now')),
        updated_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS subscription_seats (
        subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
        discord_id      TEXT NOT NULL,
        added_at        TEXT DEFAULT (datetime('now')),
        UNIQUE(subscription_id, discord_id)
    );
    CREATE INDEX IF NOT EXISTS idx_seats_sub  ON subscription_seats(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_seats_user ON subscription_seats(discord_id);
    CREATE TABLE IF NOT EXISTS pngtuber_sessions (
        id               TEXT PRIMARY KEY,
        owner_discord_id TEXT NOT NULL,
        name             TEXT DEFAULT 'Session',
        type             TEXT NOT NULL DEFAULT 'voice',
        guild_id         TEXT,
        channel_id       TEXT,
        status           TEXT NOT NULL DEFAULT 'active',
        max_participants INTEGER DEFAULT 10,
        created_at       TEXT DEFAULT (datetime('now')),
        ended_at         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_psessions_owner ON pngtuber_sessions(owner_discord_id);
    CREATE INDEX IF NOT EXISTS idx_psessions_guild ON pngtuber_sessions(guild_id, channel_id);
    CREATE TABLE IF NOT EXISTS session_participants (
        session_id TEXT NOT NULL REFERENCES pngtuber_sessions(id) ON DELETE CASCADE,
        discord_id TEXT NOT NULL,
        token      TEXT NOT NULL,
        role       TEXT NOT NULL DEFAULT 'participant',
        joined_at  TEXT DEFAULT (datetime('now')),
        left_at    TEXT,
        PRIMARY KEY(session_id, discord_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sparticipants_user ON session_participants(discord_id);
    CREATE TABLE IF NOT EXISTS invitations (
        id                 TEXT PRIMARY KEY,
        session_id         TEXT NOT NULL REFERENCES pngtuber_sessions(id) ON DELETE CASCADE,
        invited_by         TEXT NOT NULL,
        invited_discord_id TEXT,
        status             TEXT NOT NULL DEFAULT 'pending',
        max_uses           INTEGER DEFAULT 1,
        use_count          INTEGER DEFAULT 0,
        stream_name        TEXT,
        expires_at         TEXT,
        created_at         TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invitations_session ON invitations(session_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_invited ON invitations(invited_discord_id);
    CREATE TABLE IF NOT EXISTS app_tokens (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash   TEXT NOT NULL UNIQUE,
        discord_id   TEXT NOT NULL,
        device_name  TEXT DEFAULT 'Agent',
        last_used_at TEXT,
        revoked_at   TEXT,
        created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_app_tokens_discord ON app_tokens(discord_id);
    CREATE TABLE IF NOT EXISTS notifications (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id   TEXT NOT NULL,
        type         TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        read         INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(discord_id, read);
`);

console.log('✓ SQLite initialisé:', DB_PATH);
