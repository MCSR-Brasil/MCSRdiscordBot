const { Events, MessageFlags } = require('discord.js');
const daily = require('../lib/daily');
const eventSignups = require('../lib/eventSignups');
const logger = require('../lib/logger');
const { QUESTIONS } = require('../lib/dailyQuestions');

module.exports = {
  name: Events.InteractionCreate,
  async execute(client, interaction) {
    // Buttons for /daily
    if (interaction.isButton()) {
      const id = interaction.customId || '';
      // Format (legacy): daily:<userId>:<isCorrect:0|1>
      // Format (new):    daily:<userId>:<choiceIndex>:<isCorrect:0|1>:<qIndex>
      if (id.startsWith('daily:')) {
        try {
          const parts = id.split(':');
          const targetUserId = parts[1];
          // Support both legacy 3-part and new 4-part format
          const isCorrect = (parts[3] ?? parts[2]) === '1';
          const qIndexRaw = parts[4];
          const qIndex = Number.isFinite(Number(qIndexRaw)) ? Number(qIndexRaw) : undefined;
          if (interaction.user.id !== targetUserId) {
            await interaction.reply({ content: 'Esse botão não é para você.', flags: MessageFlags.Ephemeral });
            return;
          }
          // Enforce 24h cooldown on first click
          if (!daily.canClaim(interaction.user.id)) {
            await interaction.update({ content: 'Você já usou o daily nas últimas 24h.', components: [] });
            return;
          }
          const stats = daily.registerAnswer(interaction.user.id, isCorrect);
          const statsLine = daily.formatStats(stats);
          try {
            const displayName = interaction.member?.displayName || interaction.user.username;
            const questionText = qIndex !== undefined ? QUESTIONS[qIndex].q : 'a pergunta diária';
            const msg = isCorrect
              ? `✅ **${displayName}** acertou a pergunta "${questionText}"\n-# ${statsLine}\n-# Use **/daily** para responder também`
              : `❌ **${displayName}** errou a pergunta "${questionText}"\n-# ${statsLine}\n-# Use **/daily** para responder também`;
            await interaction.channel?.send({ content: msg });
          } catch {}
          const content = isCorrect
            ? `✅ Resposta correta! ${statsLine}`
            : '❌ Resposta incorreta! Tente novamente amanhã.';
          await interaction.update({ content, components: [] });
        } catch (error) {
          logger.error('Daily button error:', error);
        }
        return;
      }

      const eventAction = eventSignups.parseEventCustomId(id);
      if (eventAction?.action === 'signup') {
        try {
          return await eventSignups.handleSignupButton(interaction, eventAction.slug);
        } catch (error) {
          logger.error('Event signup button error:', error);
        }
        return;
      }
      if (eventAction?.action === 'cancel') {
        try {
          return await eventSignups.handleCancelButton(interaction, eventAction.slug);
        } catch (error) {
          logger.error('Event cancel button error:', error);
        }
        return;
      }

      return; // other buttons ignored
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId !== 'paceman:notifications') return;
      const command = client.commands.get('paceman');
      if (!command?.handleNotificationSelection) return;
      try {
        await command.handleNotificationSelection(interaction);
      } catch (error) {
        logger.error('Error updating Paceman notifications:', error);
        try {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'Não foi possível atualizar suas notificações. Tente novamente.', flags: MessageFlags.Ephemeral });
          } else {
            await interaction.reply({ content: 'Não foi possível atualizar suas notificações. Verifique se o cargo do bot está acima dos cargos de notificação.', flags: MessageFlags.Ephemeral });
          }
        } catch {}
      }
      return;
    }

    // Autocomplete for slash commands
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        logger.error('Error running autocomplete:', error);
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const eventModal = eventSignups.parseEventCustomId(interaction.customId);
      if (eventModal?.action === 'modal') {
        try {
          return await eventSignups.handleModalSubmit(interaction, eventModal.slug);
        } catch (error) {
          logger.error('Event signup modal error:', error);
          if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Erro ao processar inscrição.', flags: MessageFlags.Ephemeral }).catch(() => {});
          }
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`No command handler found for ${interaction.commandName}`);
      return;
    }
    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error('Error executing command:', error);
      try {
        if (interaction.isRepliable()) {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
          } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
          }
        }
      } catch {}
    }
  },
};
