const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const dailyGoals = require('../lib/dailyGoals');

const ALLOWED_USER_IDS = ['904123221685702657'];

function canManageGoals(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (ALLOWED_USER_IDS.includes(interaction.user.id)) return true;
  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dailygoals')
    .setDescription('Gerencia as metas de acertos do daily quiz')
    .addSubcommand(s => s
      .setName('ver')
      .setDescription('Mostra as metas e o progresso atual'))
    .addSubcommand(s => s
      .setName('definir')
      .setDescription('Cria ou edita uma meta (admin)')
      .addIntegerOption(o => o
        .setName('pontos')
        .setDescription('Total de acertos necessários para atingir a meta')
        .setRequired(true)
        .setMinValue(1))
      .addStringOption(o => o
        .setName('recompensa')
        .setDescription('Nome/descrição da recompensa (ex.: "Cargo especial")')
        .setRequired(true)))
    .addSubcommand(s => s
      .setName('remover')
      .setDescription('Remove uma meta (admin)')
      .addIntegerOption(o => o
        .setName('pontos')
        .setDescription('Pontuação da meta a remover')
        .setRequired(true)
        .setMinValue(1))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'ver') {
      return interaction.reply({ embeds: [dailyGoals.buildGoalsEmbed()] });
    }

    if (!canManageGoals(interaction)) {
      return interaction.reply({ content: 'Você não tem permissão para gerenciar as metas.', flags: MessageFlags.Ephemeral });
    }

    const pontos = interaction.options.getInteger('pontos', true);

    if (sub === 'definir') {
      const recompensa = interaction.options.getString('recompensa', true).trim();
      const goals = dailyGoals.setGoal(pontos, recompensa);
      return interaction.reply({
        content: `✅ Meta salva: **${pontos} acertos** → **${recompensa}** (${goals.length} meta(s) no total)`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'remover') {
      const result = dailyGoals.removeGoal(pontos);
      if (result === null) {
        return interaction.reply({ content: `Nenhuma meta encontrada com **${pontos}** pontos.`, flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: `🗑️ Meta de **${pontos} pontos** removida.`, flags: MessageFlags.Ephemeral });
    }
  },
};
