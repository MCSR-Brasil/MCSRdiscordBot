const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addToWhitelist, removeFromWhitelist, getWhitelistSet } = require('../lib/pacemanWhitelist');

const REQUIRED_ROLE_ID = process.env.PACEMAN_REQUIRED_ROLE_ID;
const REQUIRED_PERMISSION_NAME = process.env.PACEMAN_REQUIRED_PERMISSION;
const REQUIRED_PERMISSION = REQUIRED_PERMISSION_NAME && PermissionFlagsBits[REQUIRED_PERMISSION_NAME]
  ? PermissionFlagsBits[REQUIRED_PERMISSION_NAME]
  : null;

const data = new SlashCommandBuilder()
  .setName('paceman')
  .setDescription('Manage the Paceman whitelist');

if (REQUIRED_ROLE_ID) {
  // Role-based checks are done at runtime; don't hide the command by permission.
} else if (REQUIRED_PERMISSION) {
  data.setDefaultMemberPermissions(REQUIRED_PERMISSION);
} else {
  data.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
}

data
  .addSubcommand(sub => sub
    .setName('add')
    .setDescription('Add a Paceman nickname to the whitelist')
    .addStringOption(o => o
      .setName('nickname')
      .setDescription('Paceman nickname to whitelist')
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName('remove')
    .setDescription('Remove a Paceman nickname from the whitelist')
    .addStringOption(o => o
      .setName('nickname')
      .setDescription('Paceman nickname to remove')
      .setRequired(true)))
  .addSubcommand(sub => sub
    .setName('list')
    .setDescription('List whitelisted Paceman nicknames'));

module.exports = {
  data,

  async execute(interaction) {
    if (REQUIRED_ROLE_ID) {
      const hasRole = interaction.member.roles.cache.has(REQUIRED_ROLE_ID);
      const hasPermission = REQUIRED_PERMISSION && interaction.memberPermissions?.has(REQUIRED_PERMISSION);
      if (!hasRole && !hasPermission) {
        return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
      }
    } else if (REQUIRED_PERMISSION) {
      if (!interaction.memberPermissions?.has(REQUIRED_PERMISSION)) {
        return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
      }
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const nickname = interaction.options.getString('nickname', true);
      const added = addToWhitelist(nickname);
      return interaction.reply({
        content: added
          ? `\`${nickname}\` foi adicionado à whitelist do Paceman.`
          : `\`${nickname}\` já está na whitelist do Paceman.`,
        ephemeral: true,
      });
    }

    if (sub === 'remove') {
      const nickname = interaction.options.getString('nickname', true);
      const removed = removeFromWhitelist(nickname);
      return interaction.reply({
        content: removed
          ? `\`${nickname}\` foi removido da whitelist do Paceman.`
          : `\`${nickname}\` não está na whitelist do Paceman.`,
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const list = Array.from(getWhitelistSet()).sort();
      const text = list.length > 0
        ? `**Whitelist Paceman:**\n${list.map(n => `- ${n}`).join('\n')}`
        : 'A whitelist do Paceman está vazia.';
      return interaction.reply({ content: text, ephemeral: true });
    }
  },
};
