const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const twitchStreamers = require('../lib/twitchStreamers');

const ALLOWED_USER_IDS = ['904123221685702657'];

function canManageStreamers(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (ALLOWED_USER_IDS.includes(interaction.user.id)) return true;
  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('twitch')
    .setDescription('Gerencia a lista de streamers monitorados')
    .addSubcommand(s => s
      .setName('listar')
      .setDescription('Mostra os streamers monitorados'))
    .addSubcommand(s => s
      .setName('adicionar')
      .setDescription('Adiciona um streamer à lista (admin)')
      .addStringOption(o => o
        .setName('login')
        .setDescription('Login da Twitch (ex.: subdas)')
        .setRequired(true))
      .addUserOption(o => o
        .setName('usuario')
        .setDescription('Membro do Discord que recebe o cargo de live')
        .setRequired(false)))
    .addSubcommand(s => s
      .setName('remover')
      .setDescription('Remove um streamer da lista (admin)')
      .addStringOption(o => o
        .setName('login')
        .setDescription('Login da Twitch a remover')
        .setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'listar') {
      const streamers = twitchStreamers.getStreamers();
      if (!streamers.length) {
        return interaction.reply({ content: 'Nenhum streamer na lista. Use `/twitch adicionar`.', flags: MessageFlags.Ephemeral });
      }
      const lines = streamers.map(s =>
        `• **${s.login}** — ${s.discordId ? `<@${s.discordId}>` : 'sem usuário vinculado'}`
      );
      return interaction.reply({ content: `📺 **Streamers monitorados:**\n${lines.join('\n')}`, flags: MessageFlags.Ephemeral });
    }

    if (!canManageStreamers(interaction)) {
      return interaction.reply({ content: 'Você não tem permissão para gerenciar a lista de streamers.', flags: MessageFlags.Ephemeral });
    }

    const login = interaction.options.getString('login', true).trim().toLowerCase();

    if (sub === 'adicionar') {
      const user = interaction.options.getUser('usuario');
      const result = twitchStreamers.addStreamer(login, user?.id || null);
      const suffix = user ? ` vinculado a ${user}` : ' (sem usuário vinculado ao cargo)';
      if (result.added) {
        return interaction.reply({ content: `✅ **${login}** adicionado à lista${suffix}.`, flags: MessageFlags.Ephemeral });
      }
      if (result.updated) {
        return interaction.reply({ content: `♻️ **${login}** já estava na lista — usuário atualizado${suffix}.`, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: `**${login}** já está na lista.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'remover') {
      const removed = twitchStreamers.removeStreamer(login);
      if (!removed) {
        return interaction.reply({ content: `**${login}** não está na lista.`, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: `🗑️ **${login}** removido da lista.`, flags: MessageFlags.Ephemeral });
    }
  },
};
