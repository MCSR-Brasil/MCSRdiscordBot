const { ActionRowBuilder, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder } = require('discord.js');
const { addToWhitelist, removeFromWhitelist, getWhitelistSet } = require('../lib/pacemanWhitelist');
const { syncRankedBrazilianToPacemanWhitelist } = require('../lib/rankedWhitelistSync');
const { TIER_ROLE_IDS } = require('../lib/pacemanPingSystem');

const REQUIRED_ROLE_ID = process.env.PACEMAN_REQUIRED_ROLE_ID;
const REQUIRED_PERMISSION_NAME = process.env.PACEMAN_REQUIRED_PERMISSION;
const PACEMAN_CHANNEL_ID = process.env.PACEMAN_CHANNEL_ID;
const REQUIRED_PERMISSION = REQUIRED_PERMISSION_NAME && PermissionFlagsBits[REQUIRED_PERMISSION_NAME]
  ? PermissionFlagsBits[REQUIRED_PERMISSION_NAME]
  : null;

const data = new SlashCommandBuilder()
  .setName('paceman')
  .setDescription('Paceman: notificações e whitelist');

function canManageWhitelist(interaction) {
  if (REQUIRED_ROLE_ID) {
    return interaction.member.roles.cache.has(REQUIRED_ROLE_ID)
      || Boolean(REQUIRED_PERMISSION && interaction.memberPermissions?.has(REQUIRED_PERMISSION));
  }
  if (REQUIRED_PERMISSION) return interaction.memberPermissions?.has(REQUIRED_PERMISSION);
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

function getNotificationLevel(member) {
  let level = -1;
  for (let i = 0; i < TIER_ROLE_IDS.length; i++) {
    if (TIER_ROLE_IDS[i] && member.roles.cache.has(TIER_ROLE_IDS[i])) level = i;
  }
  return level;
}

function notificationSelector(level) {
  const channel = PACEMAN_CHANNEL_ID ? `<#${PACEMAN_CHANNEL_ID}>` : 'o canal de Paceman';
  const current = level === -1
    ? 'Você ainda não recebe alertas.'
    : 'Sua seleção atual está salva.';
  const embed = new EmbedBuilder()
    .setColor(0x9146ff)
    .setTitle('🔔 Notificações do Paceman')
    .setDescription([
      '**Acompanhe as runs ao vivo sem perder o que importa.**',
      `Você será pingado em ${channel} quando uma run alcançar os tempos da opção escolhida.`,
      '',
      `-# ${current}`,
    ].join('\n'));

  const select = new StringSelectMenuBuilder()
    .setCustomId('paceman:notifications')
    .setPlaceholder('Escolha suas notificações')
    .addOptions(
      {
        label: 'Somente as melhores runs',
        description: 'Portal <5:40 • Stronghold <6:50 • End <7:10',
        value: '0',
        emoji: '🏆',
        default: level === 0,
      },
      {
        label: 'Runs muito rápidas',
        description: 'Inclui o anterior + Portal <7:00 • Stronghold <9:00 • End <10:00',
        value: '1',
        emoji: '⚡',
        default: level === 1,
      },
      {
        label: 'Todas as notificações',
        description: 'Inclui os anteriores + Portal <8:00 • Stronghold <12:00 • End <13:00',
        value: '2',
        emoji: '🔔',
        default: level === 2,
      },
      {
        label: 'Desativar notificações',
        description: 'Remover todos os alertas do Paceman',
        value: 'none',
        emoji: '🔕',
        default: level === -1,
      },
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
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
    .setDescription('List whitelisted Paceman nicknames'))
  .addSubcommand(sub => sub
    .setName('cargos')
    .setDescription('Escolha suas notificações do Paceman'))
  .addSubcommand(sub => sub
    .setName('sync-ranked')
    .setDescription('Sync Brazilian players from ranked leaderboard to Paceman whitelist')); 

module.exports = {
  data,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'cargos') {
      if (!interaction.inGuild()) {
        return interaction.reply({ content: 'Esse comando só pode ser usado em um servidor.', ephemeral: true });
      }
      const member = await interaction.guild.members.fetch(interaction.user.id);
      return interaction.reply({ ...notificationSelector(getNotificationLevel(member)), ephemeral: true });
    }

    if (sub === 'sync-ranked') {
      if (!canManageWhitelist(interaction)) {
        return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      try {
        const result = await syncRankedBrazilianToPacemanWhitelist();
        const lines = [
          'Sincronização com o ranked concluída.',
          `Fonte: ${result.source}`,
          `Jogadores brasileiros encontrados: ${result.found}`,
          `Adicionados à whitelist: ${result.added}`,
          `Já presentes: ${result.alreadyPresent}`,
        ];
        if (result.addedNames.length > 0) {
          lines.push(`Novos: ${result.addedNames.map(n => `\`${n}\``).join(', ')}`);
        }
        if (result.errors.length > 0) {
          lines.push(`Erros: ${result.errors.join('; ')}`);
        }
        return interaction.editReply({ content: lines.join('\n'), ephemeral: true });
      } catch (e) {
        return interaction.editReply({ content: `Erro ao sincronizar: ${e.message}`, ephemeral: true });
      }
    }

    if (!canManageWhitelist(interaction)) {
      return interaction.reply({ content: 'Você não tem permissão para usar este comando.', ephemeral: true });
    }

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

  async handleNotificationSelection(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'Esse menu só pode ser usado em um servidor.', ephemeral: true });
    }

    const configuredRoleIds = TIER_ROLE_IDS.filter(Boolean);
    if (configuredRoleIds.length !== TIER_ROLE_IDS.length) {
      return interaction.reply({ content: 'As notificações do Paceman ainda não foram configuradas.', ephemeral: true });
    }

    const notificationRoles = configuredRoleIds.map(id => interaction.guild.roles.cache.get(id));
    if (notificationRoles.some(role => !role)) {
      return interaction.reply({ content: 'Um cargo de notificação configurado não foi encontrado neste servidor.', ephemeral: true });
    }
    if (notificationRoles.some(role => !role.editable)) {
      return interaction.reply({ content: 'Não consigo gerenciar os cargos de notificação. Mova o cargo do bot acima deles.', ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const selected = interaction.values[0];
    const level = selected === 'none' ? -1 : Number(selected);
    if (!Number.isInteger(level) || level < -1 || level >= TIER_ROLE_IDS.length) {
      return interaction.reply({ content: 'Opção de notificação inválida.', ephemeral: true });
    }

    const selectedRoleId = level >= 0 ? TIER_ROLE_IDS[level] : null;
    const currentNotificationRoleIds = configuredRoleIds.filter(roleId => member.roles.cache.has(roleId));
    const rolesToRemove = currentNotificationRoleIds.filter(roleId => roleId !== selectedRoleId);

    if (rolesToRemove.length > 0) await member.roles.remove(rolesToRemove);
    if (selectedRoleId && !member.roles.cache.has(selectedRoleId)) await member.roles.add(selectedRoleId);

    const content = level === -1
      ? '🔕 Notificações do Paceman desativadas.'
      : '✅ Notificações atualizadas.';
    return interaction.update({ content, ...notificationSelector(level) });
  },
};
