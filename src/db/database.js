/**
 * Database — initialisation SQLite + schema initial + runner de migrations
 * =========================================================================
 * Exporte une instance `db` unique (singleton de module ES). Tous les
 * repositories importent cette même instance — une seule connexion est
 * partagée, ce qui est correct pour SQLite en mono-processus.
 *
 * Le schema initial reste idempotent (CREATE IF NOT EXISTS). Les evolutions
 * de schema posterieures passent par le runner de migrations (voir bas du
 * fichier) qui applique les fichiers SQL versionnes de src/db/migrations/
 * dans l'ordre lexicographique. Une table _migrations garde la trace de
 * ce qui est applique pour eviter les replays.
 *
 * Dépendances : better-sqlite3, node:path, node:fs, node:url
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA_ROOT = process.env.DATA_ROOT || process.cwd();
// Créer le répertoire si nécessaire (premier lancement Docker)
if (!fs.existsSync(DATA_ROOT)) fs.mkdirSync(DATA_ROOT, { recursive: true });

const DB_PATH = path.join(DATA_ROOT, 'pngtuber.db');
export const db = new Database(DB_PATH);

// WAL : lectures non bloquées par les écritures — important pour le polling fréquent de /levels
db.pragma('journal_mode = WAL');
// Appliquer les ON DELETE CASCADE définis dans le schéma
db.pragma('foreign_keys = ON');

// ── Schéma ───────────────────────────────────────────────────────
// Toutes les tables sont créées en une seule transaction implicite.
// Les index sont définis ici pour couvrir les requêtes fréquentes (byToken, byUser...).
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

// ── Runner de migrations versionnees ────────────────────────────
// Les migrations sont des fichiers SQL dans src/db/migrations/, nommes
// avec un prefixe lexicographiquement ordonne (ex: 001_add_foo.sql,
// 002_add_bar.sql). Le runner applique celles non-encore appliquees.
//
// Pour ajouter une migration : cree un fichier 00X_description.sql dans
// src/db/migrations/, idempotent (CREATE IF NOT EXISTS, ALTER TABLE..ADD
// COLUMN IF NOT EXISTS via PRAGMA, etc.). Le runner l'applique en transaction.
db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
        name        TEXT PRIMARY KEY,
        applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function runMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return; // pas de migrations -> ok
    const applied = new Set(
        db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
    );
    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
    for (const file of files) {
        if (applied.has(file)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        const tx = db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO _migrations(name) VALUES (?)').run(file);
        });
        try {
            tx();
            console.log(`  ↳ migration appliquee : ${file}`);
        } catch (err) {
            console.error(`  ✗ migration ECHEC ${file}: ${err.message}`);
            throw err; // refus de demarrer si une migration echoue
        }
    }
}

runMigrations();

console.log('✓ SQLite initialise:', DB_PATH);
