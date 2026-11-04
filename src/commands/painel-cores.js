const {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { loadColors, IDS } = require('../lib/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel-cores')
    .setDescription('Posta o painel permanente de escolha de cor neste canal (somente admins).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const colors = loadColors();
    if (colors.length === 0) {
      return interaction.reply({
        content: '❌ Nenhuma cor configurada. Rode `/setup-cores` primeiro.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x3498DB) // detalhe azul
      .setTitle('🎨 Escolha a cor do seu nome!')
      .setTimestamp(new Date());

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(IDS.PANEL_BUTTON)
        .setLabel('🎨 Escolher cor')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Painel postado!', flags: MessageFlags.Ephemeral });
  },
};
