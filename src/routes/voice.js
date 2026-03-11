/**
 * Routes API Voice (contrôle du canal vocal)
 * ============================================
 * Expose le contrôle du bot vocal via HTTP pour le panneau React :
 *   GET  /api/guilds                     → liste des serveurs (filtré par membership)
 *   GET  /api/guilds/:guildId/channels   → canaux vocaux (filtré par permissions)
 *   GET  /api/guilds/:guildId/members    → membres d'un serveur (admin)
 *   POST /api/voice/join                 → rejoindre un canal vocal
 *   POST /api/voice/disconnect           → quitter le canal vocal
 *   GET  /api/voice/status               → état connexion (auth)
 *   GET  /api/voice/follow-status        → état du mode suivi
 *   POST /api/voice/follow               → activer le mode suivi (admin)
 *   POST /api/voice/unfollow             → désactiver le mode suivi (admin)
 *   GET  /api/auto-reconnect             → lire l'option auto-reconnect
 *   POST /api/auto-reconnect             → activer/désactiver auto-reconnect
 *
 * Ces routes dépendent de l'instance client Discord (passée à l'init) et
 * des fonctions connectToVoiceChannel/disconnectVoice (dans index.js).
 *
 * Dépendances : discord.js, services/voiceService, services/tokenService,
 *               http/helpers, node:crypto
 */
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getAutoReconnect, setAutoReconnect } from '../services/voiceService.js';
import { tokenFor, uidFor } from '../services/tokenService.js';
import { json, parseJsonBody, readBody } from '../http/helpers.js';

// GET /api/guilds — liste des serveurs Discord (filtré par membership pour non-admins)
export async function handleGuilds(req, res, ctx, { client, botConnected }) {
    if (!botConnected) return json(res, { error: 'Bot non connecté' }, 503, req);
    const isAdmin = (ctx.session?.testRole || ctx.session?.role) === 'admin';
    let guilds = client.guilds.cache;
    // Non-admin : ne montrer que les serveurs partagés avec l'utilisateur
    if (!isAdmin) {
        const userGuilds = ctx.session?.userGuildIds || [];
        guilds = guilds.filter(g => userGuilds.includes(g.id));
    }
    return json(res, guilds.map(g => ({
        id: g.id, name: g.name,
        icon: g.iconURL({ size: 64 }),
        memberCount: g.memberCount,
    })), 200, req);
}

// GET /api/guilds/:guildId/channels — canaux vocaux d'un serveur
export async function handleGuildChannels(req, res, ctx, { client, botConnected }) {
    if (!botConnected) return json(res, { error: 'Bot non connecté' }, 503, req);
    const guild = client.guilds.cache.get(ctx.params.guildId);
    if (!guild) return json(res, { error: 'Serveur non trouvé' }, 404, req);
    const isAdmin = (ctx.session?.testRole || ctx.session?.role) === 'admin';
    const discordId = ctx.session?.discordId;
    // Non-admin : vérifier l'appartenance au serveur
    if (!isAdmin) {
        const userGuilds = ctx.session?.userGuildIds || [];
        if (!userGuilds.includes(guild.id))
            return json(res, { error: 'Vous n\'êtes pas membre de ce serveur' }, 403, req);
    }
    // Tenter de récupérer le membre pour filtrer par permissions
    let member = discordId ? guild.members.cache.get(discordId) : null;
    if (!member && discordId && !isAdmin) {
        try { member = await guild.members.fetch(discordId); } catch {}
    }
    const { connectedChannelId } = await import('../services/voiceService.js');
    const voiceChannels = guild.channels.cache
        .filter(c => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
        .filter(c => {
            if (isAdmin) return true;
            if (!member) return true;
            try { return c.permissionsFor(member).has(PermissionFlagsBits.Connect); }
            catch { return false; }
        })
        .sort((a, b) => a.position - b.position)
        .map(c => ({
            id: c.id, name: c.name, type: c.type, position: c.position,
            members: c.members.map(m => ({
                token: tokenFor(m.id),
                displayName: m.displayName || m.user.username,
                bot: m.user.bot,
            })),
            botConnected: connectedChannelId === c.id,
        }));
    return json(res, voiceChannels, 200, req);
}

// GET /api/guilds/:guildId/members — membres d'un serveur (admin uniquement)
export async function handleGuildMembers(req, res, ctx, { client, botConnected }) {
    if (!botConnected) return json(res, { error: 'Bot non connecté' }, 503, req);
    const guild = client.guilds.cache.get(ctx.params.guildId);
    if (!guild) return json(res, { error: 'Serveur non trouvé' }, 404, req);
    const members = guild.members.cache
        .filter(m => !m.user.bot)
        .map(m => ({
            discordId: m.id,
            displayName: m.displayName || m.user.username,
            username: m.user.username,
            avatar: m.user.displayAvatarURL({ size: 64 }),
            inVoice: !!m.voice.channelId,
            voiceChannelName: m.voice.channel?.name || null,
        }));
    return json(res, { members, partial: true }, 200, req);
}

// POST /api/voice/join — rejoindre un canal vocal
export async function handleVoiceJoin(req, res, ctx, { connectToVoiceChannel, client }) {
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    if (!body.guildId || !body.channelId)
        return json(res, { error: 'guildId et channelId requis' }, 400, req);
    const isAdmin = (ctx.session?.testRole || ctx.session?.role) === 'admin';
    const discordId = ctx.session?.discordId;
    // Vérifier les permissions pour les non-admins
    if (!isAdmin) {
        const userGuilds = ctx.session?.userGuildIds || [];
        if (!userGuilds.includes(body.guildId))
            return json(res, { error: 'Vous n\'êtes pas membre de ce serveur' }, 403, req);
        const guild = client.guilds.cache.get(body.guildId);
        if (!guild) return json(res, { error: 'Serveur non trouvé' }, 404, req);
        let member = guild.members.cache.get(discordId);
        if (!member) { try { member = await guild.members.fetch(discordId); } catch {} }
        if (member) {
            const channel = guild.channels.cache.get(body.channelId);
            if (channel) {
                try {
                    if (!channel.permissionsFor(member).has(PermissionFlagsBits.Connect))
                        return json(res, { error: 'Pas de permission pour rejoindre ce channel' }, 403, req);
                } catch {}
            }
        }
    }
    try {
        const result = await connectToVoiceChannel(body.guildId, body.channelId);
        return json(res, {
            ok: true,
            guild: result.guild.name,
            channel: result.channel.name,
            memberCount: result.members.length,
        }, 200, req);
    } catch (err) {
        console.error('Voice join error:', err);
        return json(res, { error: 'Impossible de rejoindre le canal vocal' }, 400, req);
    }
}

// POST /api/voice/disconnect — déconnecter le bot du vocal
export async function handleVoiceDisconnect(req, res, ctx, { disconnectVoice, currentConnection }) {
    if (!currentConnection) return json(res, { error: 'Pas connecté' }, 400, req);
    disconnectVoice();
    return json(res, { ok: true }, 200, req);
}

// GET /api/voice/status — état actuel de la connexion vocale
export async function handleVoiceStatus(req, res, ctx, { client, connectedGuildId, connectedChannelId, currentConnection, followTarget, followError }) {
    if (!currentConnection || !connectedGuildId)
        return json(res, { connected: false }, 200, req);
    const guild = client.guilds.cache.get(connectedGuildId);
    const channel = guild?.channels.cache.get(connectedChannelId);
    return json(res, {
        connected: true,
        guildId: connectedGuildId,
        guildName: guild?.name,
        channelId: connectedChannelId,
        channelName: channel?.name,
        members: channel ? channel.members
            .filter(m => !m.user.bot)
            .map(m => ({
                token: tokenFor(m.id),
                displayName: m.displayName || m.user.username,
            })) : [],
        following: followTarget
            ? { token: tokenFor(followTarget.discordId), displayName: followTarget.displayName }
            : null,
        followError: followError && (Date.now() - followError.ts < 10000) ? followError : null,
    }, 200, req);
}

// GET /api/voice/follow-status — état actuel du mode suivi
export async function handleFollowStatus(req, res, ctx, { followTarget }) {
    return json(res, {
        following: followTarget
            ? { token: tokenFor(followTarget.discordId), displayName: followTarget.displayName }
            : null,
    }, 200, req);
}

// POST /api/voice/follow — activer le mode suivi sur un token
export async function handleVoiceFollow(req, res, ctx, { client, connectedGuildId, setFollowTarget, broadcastFollowStatus }) {
    const body = await parseJsonBody(req);
    const token = body?.token;
    if (!token) return json(res, { error: 'token requis' }, 400, req);
    const discordId = uidFor(token);
    if (!discordId) return json(res, { error: 'token inconnu' }, 404, req);
    let displayName = token;
    if (connectedGuildId) {
        const guild = client.guilds.cache.get(connectedGuildId);
        const member = guild?.members.cache.get(discordId);
        if (member) displayName = member.displayName || member.user.username;
    }
    setFollowTarget({ discordId, requestedBy: ctx.session?.discordId, displayName });
    broadcastFollowStatus();
    console.log(`Mode suivi activé: ${displayName}`);
    return json(res, { ok: true, following: { token, displayName } }, 200, req);
}

// POST /api/voice/unfollow — désactiver le mode suivi
export async function handleVoiceUnfollow(req, res, ctx, { setFollowTarget, broadcastFollowStatus }) {
    setFollowTarget(null);
    broadcastFollowStatus();
    console.log('Mode suivi désactivé');
    return json(res, { ok: true }, 200, req);
}

// GET /api/auto-reconnect — lire l'état de l'option
export function handleGetAutoReconnect(req, res) {
    return json(res, { enabled: getAutoReconnect() }, 200, req);
}

// POST /api/auto-reconnect — activer/désactiver l'option
export async function handleSetAutoReconnect(req, res, ctx) {
    const body = ctx._parsedBody || JSON.parse((await readBody(req)).toString());
    setAutoReconnect(!!body.enabled);
    return json(res, { ok: true, enabled: getAutoReconnect() }, 200, req);
}
