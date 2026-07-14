const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { fetchProfile, buildProfileEmbed } = require('../lib/profile');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('Visualize o perfil e ranking de um jogador')
    .addStringOption(opt => opt
      .setName('nome')
      .setDescription('Nome do jogador')
      .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  async execute(interaction) {
    const name = interaction.options.getString('nome', true);

    await interaction.deferReply();

    try {
      const profile = await fetchProfile(name);
      const embed = buildProfileEmbed(profile);
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: err.message || 'Não foi possível carregar o perfil.' });
    }
  },
};
