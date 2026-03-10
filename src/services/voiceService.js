// ── Service vocal Discord ────────────────────────────────────────
// Encapsule l'état de connexion vocale et les opérations join/leave/follow.
// Singleton de module — l'état vit ici, pas dans des variables globales index.js.
import path from 'node:path';
import fs from 'node:fs';

const DATA_ROOT       = process.env.DATA_ROOT || process.cwd();
const VOICE_STATE_PATH = path.join(DATA_ROOT, 'voice-state.json');

// ── État en mémoire ──────────────────────────────────────────────
export let botConnected     = false;
export let currentConnection = null;
export let connectedGuildId  = null;
export let connectedChannelId = null;
export let followTarget      = null; // { discordId, requestedBy, displayName }
export let followError       = null; // { channelName, userName, ts }

export function setState(patch) {
    if ('botConnected'     in patch) botConnected      = patch.botConnected;
    if ('currentConnection' in patch) currentConnection = patch.currentConnection;
    if ('connectedGuildId'  in patch) connectedGuildId  = patch.connectedGuildId;
    if ('connectedChannelId' in patch) connectedChannelId = patch.connectedChannelId;
    if ('followTarget'      in patch) followTarget      = patch.followTarget;
    if ('followError'       in patch) followError       = patch.followError;
    saveVoiceState();
}

// ── Persistance voice-state.json ────────────────────────────────
export function saveVoiceState() {
    try {
        fs.writeFileSync(VOICE_STATE_PATH, JSON.stringify({
            autoReconnect: getAutoReconnect(),
            guildId:       connectedGuildId,
            channelId:     connectedChannelId,
        }));
    } catch {}
}

export function loadVoiceState() {
    try {
        if (fs.existsSync(VOICE_STATE_PATH))
            return JSON.parse(fs.readFileSync(VOICE_STATE_PATH, 'utf-8'));
    } catch {}
    return { autoReconnect: false, guildId: null, channelId: null };
}

export function getAutoReconnect() {
    return loadVoiceState().autoReconnect ?? false;
}

export function setAutoReconnect(val) {
    const state = loadVoiceState();
    state.autoReconnect = !!val;
    try { fs.writeFileSync(VOICE_STATE_PATH, JSON.stringify(state)); } catch {}
}
