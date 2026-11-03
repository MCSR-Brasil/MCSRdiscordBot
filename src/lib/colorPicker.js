const {
  ModalBuilder, LabelBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, MessageFlags,
} = require('discord.js');
const { IDS, REMOVE_VALUE, loadColors, currentColorOf } = require('./colors');
const logger = require('./logger');

// Clique no botão do painel: showModal() DEVE ser a primeira resposta (limite de 3s, sem defer)
async function handlePanelButton(interaction) {
  const colors = loadColors();
  const current = currentColorOf(interaction.member, colors);

  const options = colors.map(c =>
    new StringSelectMenuOptionBuilder()
      .setLabel(c.name)
      .setValue(c.key)
      .setDescription(c.description)
      .setEmoji(c.emoji)
      .setDefault(current?.key === c.key)
  );
  options.push(
    new StringSelectMenuOptionBuilder()
      .setLabel('Remover minha cor')
      .setValue(REMOVE_VALUE)
      .setDescription('Tira o cargo de cor atual')
      .setEmoji('❌')
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(IDS.SELECT)
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1)
    .setOptions(options);

  const modal = new ModalBuilder()
    .setCustomId(IDS.MODAL)
    .setTitle('🎨 Escolha sua cor')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Qual cor você quer?')
        .setDescription('Sua cor atual será substituída pela escolhida.')
        .setStringSelectMenuComponent(select)
    );

  await interaction.showModal(modal);
}

// Envio do modal: troca/atribui/remove o cargo de cor
async function handleModalSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const colors = loadColors();
  const [value] = interaction.fields.getStringSelectValues(IDS.SELECT);
  const member = interaction.member;
  const reason = `Cor escolhida via painel por ${interaction.user.tag}`;

  // Painel é exclusivo de Nitro Boosters (varredura diária remove cores de ex-boosters)
  const boosterRoleId = process.env.BOOSTER_ROLE_ID;
  if (boosterRoleId && !member.roles.cache.has(boosterRoleId)) {
    return interaction.editReply('💎 Esse painel é exclusivo para **Nitro Boosters** do servidor.');
  }

  // Opção de remoção
  if (value === REMOVE_VALUE) {
    const toRemove = colors.filter(c => c.roleId && member.roles.cache.has(c.roleId));
    if (toRemove.length === 0) {
      return interaction.editReply('Você não tem nenhuma cor para remover.');
    }
    await member.roles.remove(toRemove.map(c => c.roleId), reason);
    return interaction.editReply('✅ Sua cor foi removida!');
  }

  // WHITELIST: só aceita chaves presentes em colors.json — o cliente pode enviar qualquer valor
  const chosen = colors.find(c => c.key === value);
  if (!chosen) {
    return interaction.editReply('❌ Cor inválida. Tente abrir o painel novamente.');
  }

  // Já tem essa cor? Não faz nada
  if (member.roles.cache.has(chosen.roleId)) {
    return interaction.editReply(`Você já está usando ${chosen.emoji} **${chosen.name}**!`);
  }

  // Verifica se o cargo ainda existe e se o bot consegue gerenciá-lo (hierarquia)
  const role = interaction.guild.roles.cache.get(chosen.roleId)
    ?? await interaction.guild.roles.fetch(chosen.roleId).catch(() => null);
  if (!role) {
    return interaction.editReply('❌ O cargo dessa cor não existe mais. Avise um administrador para rodar `/setup-cores`.');
  }
  if (!role.editable) {
    return interaction.editReply(
      '❌ Não consigo te dar essa cor: o cargo dela está acima do meu cargo mais alto. ' +
      'Um administrador precisa arrastar o meu cargo para cima em **Configurações do Servidor → Cargos**.'
    );
  }

  // Remove todas as outras cores configuradas e adiciona a escolhida
  const others = colors.filter(c => c.roleId && c.key !== chosen.key && member.roles.cache.has(c.roleId));
  if (others.length) {
    await member.roles.remove(others.map(c => c.roleId), reason);
  }
  await member.roles.add(role, reason);

  return interaction.editReply(`${chosen.emoji} Pronto! Agora a cor do seu nome é **${chosen.name}**.`);
}

// Wrapper com um único try/catch e resposta de erro segura
async function handle(interaction) {
  try {
    if (interaction.isButton() && interaction.customId === IDS.PANEL_BUTTON) {
      return await handlePanelButton(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId === IDS.MODAL) {
      return await handleModalSubmit(interaction);
    }
  } catch (error) {
    logger.error('Color picker error:', error);
    try {
      const content = '❌ Ocorreu um erro ao processar sua escolha. Tente novamente ou avise um administrador.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      } else if (interaction.isRepliable()) {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
}

module.exports = { handle };
