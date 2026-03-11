/**
 * Bot Discord — client, slash commands, événements
 * ==================================================
 * Encapsule tout ce qui est lié au client Discord.js :
 *   - Création du client avec les intents nécessaires
 *   - Enregistrement des slash commands par serveur (pas global — instantané)
 *   - Handlers d'événements : clientReady, voiceStateUpdate, messageCreate,
 *     interactionCreate
 *   - Commandes texte : !join, !disconnect, !status
 *   - Commandes slash : /join, /config, /disconnect
 *
 * Ce module dépend de l'instance de connexion vocale courante via les
 * callbacks connectToVoiceChannel / disconnectVoice injectés depuis index.js.
 * Les variables d'état (botConnected, currentConnection, etc.) sont gérées
 * dans voiceService.js et lues depuis index.js.
 *
 * Dépendances : discord.js, @discordjs/voice, services/voiceService,
 *               services/tokenService, services/audioService
 */
import {
    Client, GatewayIntentBits, REST, Routes,
    SlashCommandBuilder, PermissionFlagsBits,
} from 'discord.js';
import { getVoiceConnection, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { loadVoiceState, saveVoiceState } from '../services/voiceService.js';
import { tokenFor } from '../services/tokenService.js';
import { userLevels } from '../services/audioService.js';

// ── Slash Commands déclarées ──────────────────────────────────────────────
const slashCommands = [
    new SlashCommandBuilder()
        .setName('join')
        .setDescription('Rejoindre ton salon vocal pour animer ton PNGTuber'),
    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Ouvrir le panneau de configuration web'),
    new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Déconnecter le bot du salon vocal'),
].map(c => c.toJSON());

// ── Création du client Discord ────────────────────────────────────────────
export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

/**
 * Initialise les événements du bot Discord.
 * Doit être appelé après la création de tous les handlers.
 *
 * @param {object} deps - Dépendances injectées depuis index.js :
 *   { connectToVoiceChannel, disconnectVoice, isAvatarAllowed,
 *     getState, broadcastFollowStatus, broadcastFollowError, setFollowTarget,
 *     BASE_URL }
 */
export function initBot(deps) {
    const {
        connectToVoiceChannel, disconnectVoice,
        isAvatarAllowed, getState,
        broadcastFollowStatus, broadcastFollowError, setFollowTarget,
        BASE_URL,
    } = deps;

    // ── ready ────────────────────────────────────────────────────────────
    client.once('clientReady', async () => {
        deps.onBotReady?.();
        console.log(`Bot ready — ${client.user.tag}`);

        // Enregistrer les slash commands sur chaque serveur (propagation instantanée)
        try {
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            // Nettoyer les commandes globales résiduelles
            await rest.put(Routes.applicationCommands(client.user.id), { body: [] }).catch(() => {});
            for (const [guildId, guild] of client.guilds.cache) {
                try {
                    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: slashCommands });
                    console.log(`Slash commands enregistrées → ${guild.name}`);
                } catch (err) {
                    console.warn(`Slash commands ${guild.name}: ${err.message}`);
                }
            }
        } catch (err) {
            console.warn('Échec enregistrement slash commands:', err.message);
        }

        // Auto-reconnect au dernier canal vocal si l'option est activée
        const voiceState = loadVoiceState();
        if (voiceState.autoReconnect && voiceState.guildId && voiceState.channelId) {
            console.log(`Auto-reconnect → guild:${voiceState.guildId} channel:${voiceState.channelId}`);
            try {
                await connectToVoiceChannel(voiceState.guildId, voiceState.channelId);
                console.log('Auto-reconnect réussi');
            } catch (err) {
                console.warn('Auto-reconnect échoué:', err.message);
            }
        }
    });

    // ── Erreur de connexion (token invalide) ─────────────────────────────
    client.on('error', (err) => {
        if (err?.message?.includes('TOKEN_INVALID') || err?.code === 4004) {
            deps.onTokenRejected?.();
            console.error('Token Discord invalide');
        }
    });

    // ── Commandes texte !join / !disconnect / !status ────────────────────
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        const cmd = message.content.trim().toLowerCase();

        if (cmd === '!join') {
            const channel = message.member?.voice.channel;
            if (!channel) return message.reply('Tu dois être dans un canal vocal.');
            try {
                const result = await connectToVoiceChannel(channel.guild.id, channel.id);
                const guildId = channel.guild.id;
                const links = [...result.members.values()]
                    .filter(m => isAvatarAllowed(tokenFor(m.id), guildId))
                    .map(m => {
                        const t = tokenFor(m.id);
                        return `  • **${m.displayName || m.user?.username || '???'}** → \`${BASE_URL}/viewer.html?t=${t}&guild=${guildId}\``;
                    })
                    .join('\n');
                return message.reply(
                    `Connecté à **${result.channel.name}** !\n\nConfig : \`${BASE_URL}\`\n\nViewers :\n${links || '  (aucun membre autorisé)'}`,
                );
            } catch (err) {
                console.error('Join error:', err);
                return message.reply('Impossible de rejoindre le canal.');
            }
        }

        if (cmd === '!disconnect') {
            const { currentConnection } = getState();
            if (!currentConnection) return message.reply('Pas connecté.');
            disconnectVoice();
            return message.reply('Déconnecté du canal vocal.');
        }

        if (cmd === '!status') {
            const lines = [...userLevels.entries()]
                .map(([, v]) => `  • **${v.displayName || '???'}** — ${v.db} dB ${v.speaking ? '(parle)' : '(silence)'}`)
                .join('\n') || '  (aucun)';
            const { botConnected, connectedGuildId } = getState();
            return message.reply(
                `**Bot** Discord:${botConnected ? 'oui' : 'non'} Voice:${connectedGuildId ? 'oui' : 'non'}\n${lines}`,
            );
        }
    });

    // ── Slash commands /join /config /disconnect ─────────────────────────
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isChatInputCommand()) return;
        const { commandName } = interaction;

        if (commandName === 'join') {
            const channel = interaction.member?.voice?.channel;
            if (!channel) {
                return interaction.reply({ content: 'Tu dois être dans un salon vocal.', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            try {
                const result = await connectToVoiceChannel(channel.guild.id, channel.id);
                const guildId = channel.guild.id;
                const authorized = [], denied = [];
                for (const [, m] of result.members) {
                    const t = tokenFor(m.id);
                    const name = m.displayName || m.user?.username || '???';
                    if (isAvatarAllowed(t, guildId)) {
                        authorized.push(`**${name}**\n\`\`\`\n${BASE_URL}/viewer.html?t=${t}&guild=${guildId}\n\`\`\``);
                    } else {
                        denied.push(`**${name}** — non autorisé sur ce serveur`);
                    }
                }
                const parts = [`Connecté à **${result.channel.name}** !`, `Config : \`${BASE_URL}\``];
                if (authorized.length) parts.push(`\n**Viewers autorisés :**\n${authorized.join('\n')}`);
                if (denied.length) parts.push(`\n${denied.join('\n')}`);
                if (!authorized.length && !denied.length) parts.push('\n(aucun membre)');
                return interaction.editReply(parts.join('\n'));
            } catch (err) {
                return interaction.editReply('Impossible de rejoindre le salon.');
            }
        }

        if (commandName === 'config') {
            return interaction.reply({
                content: `**Panneau de configuration PNGTuber**\n\nClique sur le lien ci-dessous :\n${BASE_URL}`,
                ephemeral: true,
            });
        }

        if (commandName === 'disconnect') {
            const { currentConnection } = getState();
            if (!currentConnection) {
                return interaction.reply({ content: 'Le bot n\'est pas connecté à un salon vocal.', ephemeral: true });
            }
            disconnectVoice();
            return interaction.reply({ content: 'Déconnecté du salon vocal.', ephemeral: true });
        }
    });

    // ── voiceStateUpdate — mode suivi + déconnexion auto ─────────────────
    client.on('voiceStateUpdate', (oldState, newState) => {
        const { followTarget, currentConnection: conn } = getState();

        // Mode suivi : si la cible change de canal, le bot la suit
        if (followTarget && newState.id === followTarget.discordId) {
            if (newState.channelId && newState.channelId !== oldState.channelId) {
                const newChannel = newState.guild.channels.cache.get(newState.channelId);
                if (newChannel) {
                    const botMember = newState.guild.members.me;
                    const canConnect = botMember && newChannel.permissionsFor(botMember).has(PermissionFlagsBits.Connect);
                    if (canConnect) {
                        connectToVoiceChannel(newState.guild.id, newState.channelId)
                            .then(() => console.log(`Suivi: ${newState.member?.displayName} → ${newChannel.name}`))
                            .catch(() => broadcastFollowError(newChannel.name, followTarget.displayName));
                    } else {
                        broadcastFollowError(newChannel.name, followTarget.displayName);
                    }
                }
            }
            // La cible quitte le vocal → désactiver le suivi
            if (!newState.channelId) {
                console.log('Cible quitte le vocal, suivi désactivé');
                setFollowTarget(null);
                broadcastFollowStatus();
            }
        }

        // Déconnexion automatique si le bot est seul dans le canal
        const guild = oldState.guild;
        if (!guild) return;
        const connection = getVoiceConnection(guild.id);
        if (!connection) return;
        const channel = guild.channels.cache.get(connection.joinConfig.channelId);
        if (!channel) return;
        if (channel.members.filter(m => !m.user.bot).size > 0) return;
        setTimeout(() => {
            const ch = guild.channels.cache.get(connection.joinConfig.channelId);
            if (ch?.members.filter(m => !m.user.bot).size === 0) {
                console.log('Seul dans le canal → déconnexion auto');
                disconnectVoice();
            }
        }, 5000);
    });
}

/**
 * Lance la connexion du bot Discord avec le token fourni.
 * @param {string} token - Token Discord du bot
 * @param {function} onReject - Callback si le token est invalide
 */
export async function loginBot(token, onReject) {
    if (!token) return;
    try {
        await client.login(token);
    } catch (err) {
        onReject?.(err);
        console.error('Login échoué:', err.message);
    }
}
