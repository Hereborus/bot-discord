/**
 * Voice Service — état de connexion vocale Discord
 * =================================================
 * Encapsule l'état de la connexion vocale du bot en tant que singleton
 * de module. Remplace les variables globales éparpillées dans index.js.
 *
 * La persistance dans voice-state.json permet l'auto-reconnexion au
 * redémarrage : le bot retrouve le canal qu'il occupait avant l'arrêt.
 * setState() centralise toutes les mutations d'état + persiste automatiquement.
 *
 * Dépendances : node:path, node:fs
 */
import path from 'node:path';
import fs from 'node:fs';

const DATA_ROOT       = process.env.DATA_ROOT || process.cwd();
const VOICE_STATE_PATH = path.join(DATA_ROOT, 'voice-state.json');

// ── État en mémoire ──────────────────────────────────────────────
// Les exports let permettent aux importeurs de lire l'état courant directement.
export let botConnected     = false;
export let currentConnection = null;  // instance VoiceConnection discord.js
export let connectedGuildId  = null;
export let connectedChannelId = null;
export let followTarget      = null;  // { discordId, requestedBy, displayName }
export let followError       = null;  // { channelName, userName, ts }

// setState applique un patch partiel et persiste — évite les mutations directes
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
// Seul l'état nécessaire à l'auto-reconnexion est persisté (pas currentConnection
// qui est un objet runtime non sérialisable).
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

// Lecture de l'option autoReconnect depuis le fichier persisté
export function getAutoReconnect() {
    return loadVoiceState().autoReconnect ?? false;
}

// Mise à jour isolée de autoReconnect sans toucher au reste de l'état
export function setAutoReconnect(val) {
    const state = loadVoiceState();
    state.autoReconnect = !!val;
    try { fs.writeFileSync(VOICE_STATE_PATH, JSON.stringify(state)); } catch {}
}
