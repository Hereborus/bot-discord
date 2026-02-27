import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel } from "@discordjs/voice";
import dotenv from "dotenv";

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

client.once("ready", () => {
    console.log("Bot is ready!");
});

client.login(process.env.DISCORD_TOKEN);

client.on("messageCreate", async (message) => {
    if (message.content === "!join") {
        const channel = message.member.voice.channel;

        if (!channel) {
            return message.reply("You need to be in a voice channel first!");
        }

        joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        connection.receiver.speaking.on("start", (userId) => {
            console.log(`🔊 ${userId} commence à parler`);
        });

        connection.receiver.speaking.on("end", (userId) => {
            console.log(`🔇 ${userId} a arrêté`);
        });

        message.reply("Je rejoins le vocal 👀");
    }
});

import { getVoiceConnection } from "@discordjs/voice";

client.on("voiceStateUpdate", (oldState, newState) => {
    const connection = getVoiceConnection(oldState.guild.id);
    if (!connection) return;

    const channel = oldState.guild.channels.cache.get(
        connection.joinConfig.channelId,
    );
    if (!channel) return;

    // Compte les membres NON bot
    const nonBotMembers = channel.members.filter((member) => !member.user.bot);

    if (nonBotMembers.size === 0) {
        setTimeout(() => {
            const refreshedChannel = oldState.guild.channels.cache.get(
                connection.joinConfig.channelId,
            );
            const stillAlone = refreshedChannel.members.filter(
                (m) => !m.user.bot,
            );

            if (stillAlone.size === 0) {
                console.log("Toujours seul, je quitte");
                connection.destroy();
            }
        }, 5000); // attend 5 secondes
    }
});
