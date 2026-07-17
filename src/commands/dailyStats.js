const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const daily = require('../lib/daily');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dailystats')
    .setDescription('Mostra o ranking do daily (top 8)')
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  async execute(interaction) {
    await interaction.deferReply();
    const embed = await daily.buildLeaderboardEmbed(interaction.client, 8, '🏆 Daily Leaderboard');
    await interaction.editReply({ embeds: [embed] });
  },
};
