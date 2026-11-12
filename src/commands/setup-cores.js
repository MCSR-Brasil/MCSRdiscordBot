const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { loadColors, saveColors } = require('../lib/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup-cores')
    .setDescription('Cria os cargos de cor configurados em config/colors.json (somente admins).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const colors = loadColors();
    if (colors.length === 0) {
      return interaction.editReply('❌ Nenhuma cor encontrada em `config/colors.json`.');
    }

    const created = [];
    const adopted = [];
    const skipped = [];
    const failed = [];

    for (const color of colors) {
      // Pula se o roleId já existe no servidor
      if (color.roleId) {
        const existing = interaction.guild.roles.cache.get(color.roleId)
          ?? await interaction.guild.roles.fetch(color.roleId).catch(() => null);
        if (existing) {
          skipped.push(`${color.emoji} **${color.name}**`);
          continue;
        }
        // roleId salvo aponta para um cargo que não existe mais
        color.roleId = null;
      }

      // Se já existe um cargo com esse nome, adota o ID em vez de criar duplicado
      const byName = interaction.guild.roles.cache.find(r => r.name === color.name)
        ?? (await interaction.guild.roles.fetch()).find(r => r.name === color.name);
      if (byName) {
        color.roleId = byName.id;
        adopted.push(`${color.emoji} **${color.name}**`);
        continue;
      }

      try {
        const role = await interaction.guild.roles.create({
          name: color.name,
          color: color.hex,
          permissions: [],
          hoist: false,
          mentionable: false,
          reason: `Cargo de cor criado via /setup-cores por ${interaction.user.tag}`,
        });
        color.roleId = role.id;
        created.push(`${color.emoji} **${color.name}**`);
      } catch (error) {
        failed.push(`${color.emoji} **${color.name}** (${error.message})`);
      }
    }

    // Persiste os roleIds criados de volta no arquivo de configuração
    saveColors(colors);

    // Aviso de hierarquia: o bot só consegue dar cargos que estejam abaixo do seu cargo mais alto
    const botTop = interaction.guild.members.me.roles.highest.position;
    const unreachable = colors
      .filter(c => c.roleId && interaction.guild.roles.cache.get(c.roleId)?.position >= botTop);

    const lines = [];
    if (created.length) lines.push(`✅ **Criados (${created.length}):** ${created.join(', ')}`);
    if (adopted.length) lines.push(`🔗 **Vinculados (${adopted.length}):** ${adopted.join(', ')}`);
    if (skipped.length) lines.push(`⏭️ **Já existiam (${skipped.length}):** ${skipped.join(', ')}`);
    if (failed.length) lines.push(`❌ **Falhas (${failed.length}):** ${failed.join(', ')}`);
    if (unreachable.length) {
      lines.push(
        '⚠️ **Atenção à hierarquia:** os cargos de cor ficaram acima do cargo mais alto do bot, ' +
        'então não vou conseguir atribuí-los. Arraste o cargo do bot para cima dos cargos de cor ' +
        'em **Configurações do Servidor → Cargos**.'
      );
    }
    if (!lines.length) lines.push('Nada a fazer.');

    return interaction.editReply(lines.join('\n'));
  },
};
