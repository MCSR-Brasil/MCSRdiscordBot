const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { readJson, writeJson } = require('../lib/store');

const FILE = 'partidas.json';
const MANAGER_ROLE_ID = '1532757057550417950';

function load() {
  const list = readJson(FILE, []);
  return Array.isArray(list) ? list : [];
}

function canManage(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  return Boolean(interaction.member?.roles?.cache?.has(MANAGER_ROLE_ID));
}

function renderList(list) {
  const blocks = list.map((p, i) =>
    `**${i + 1}. ${p.participantes}**\n> 📅 ${p.day} · 🕐 ${p.time}`
  );
  return `📅 **Partidas agendadas**\n\n${blocks.join('\n\n')}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('partidas')
    .setDescription('Gerencia e lista partidas agendadas')
    .addSubcommand(s => s
      .setName('ver')
      .setDescription('Mostra as partidas agendadas'))
    .addSubcommand(s => s
      .setName('adicionar')
      .setDescription('Agenda uma partida (admin)')
      .addStringOption(o => o
        .setName('participantes')
        .setDescription('Quem joga (ex.: Badgamer vs ninapigs)')
        .setRequired(true))
      .addStringOption(o => o
        .setName('dia')
        .setDescription('Dia da partida (ex.: Domingo ou 27/12)')
        .setRequired(true))
      .addStringOption(o => o
        .setName('hora')
        .setDescription('Horário (ex.: 19h ou 21:00)')
        .setRequired(true)))
    .addSubcommand(s => s
      .setName('remover')
      .setDescription('Remove uma partida pelo número da lista (admin)')
      .addIntegerOption(o => o
        .setName('numero')
        .setDescription('Número da partida em /partidas ver')
        .setRequired(true)
        .setMinValue(1)))
    .addSubcommand(s => s
      .setName('limpartodas')
      .setDescription('Remove todas as partidas agendadas (admin)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(false);
    const list = load();

    if (!sub || sub === 'ver') {
      if (!list.length) {
        return interaction.reply({ content: '📅 Nenhuma partida agendada.', flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ content: renderList(list), allowedMentions: { parse: [] } });
    }

    if (!canManage(interaction)) {
      return interaction.reply({ content: 'Você não tem permissão para gerenciar partidas.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'adicionar') {
      const participantes = interaction.options.getString('participantes', true).trim();
      const dia = interaction.options.getString('dia', true).trim();
      const hora = interaction.options.getString('hora', true).trim();
      list.push({ participantes, day: dia, time: hora, by: interaction.user.id, createdAt: Date.now() });
      writeJson(FILE, list);
      return interaction.reply({
        content: `✅ Partida agendada!\n\n**${participantes}**\n> 📅 ${dia} · 🕐 ${hora}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'remover') {
      const numero = interaction.options.getInteger('numero', true);
      const removed = list.splice(numero - 1, 1)[0];
      if (!removed) {
        return interaction.reply({ content: `Não existe partida nº ${numero}. Use \`/partidas ver\`.`, flags: MessageFlags.Ephemeral });
      }
      writeJson(FILE, list);
      return interaction.reply({ content: `🗑️ Removida: **${removed.participantes}** (${removed.day} · ${removed.time})`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'limpartodas') {
      if (!list.length) {
        return interaction.reply({ content: 'Não há partidas para limpar.', flags: MessageFlags.Ephemeral });
      }
      writeJson(FILE, []);
      return interaction.reply({ content: `🗑️ ${list.length} partida(s) removida(s).`, flags: MessageFlags.Ephemeral });
    }
  },
};
