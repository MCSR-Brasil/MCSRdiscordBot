const { Events, MessageFlags } = require('discord.js');
const daily = require('../lib/daily');
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
        const parts = id.split(':');
        const targetUserId = parts[1];
        // Support both legacy 3-part and new 4-part format
        const isCorrect = (parts[3] ?? parts[2]) === '1';
        const qIndexRaw = parts[4];
        const qIndex = Number.isFinite(Number(qIndexRaw)) ? Number(qIndexRaw) : undefined;
        if (interaction.user.id !== targetUserId) {
          return interaction.reply({ content: 'Esse botão não é para você.', flags: MessageFlags.Ephemeral });
        }
        // Enforce 24h cooldown on first click
        if (!daily.canClaim(interaction.user.id)) {
          return interaction.update({ content: 'Você já usou o daily nas últimas 24h.', components: [] });
        }
        const stats = daily.registerAnswer(interaction.user.id, isCorrect);
        const statsLine = daily.formatStats(stats);
        if (isCorrect) {
          // Announce publicly in the channel without pinging the user or revealing the answer
          try {
            const displayName = interaction.member?.displayName || interaction.user.username;
            const questionText = qIndex !== undefined ? QUESTIONS[qIndex].q : 'a pergunta diária';
            const msg = `✅ **${displayName}** acertou a pergunta "${questionText}"\n-# ${statsLine}\n-# Use **/daily** para responder também`;
            await interaction.channel?.send({ content: msg });
          } catch {}
          return interaction.update({ content: `✅ Resposta correta! ${statsLine}`, components: [] });
        } else {
          try {
            const displayName = interaction.member?.displayName || interaction.user.username;
            const questionText = qIndex !== undefined ? QUESTIONS[qIndex].q : 'a pergunta diária';
            const msg = `❌ **${displayName}** errou a pergunta "${questionText}"\n-# ${statsLine}\n-# Use **/daily** para responder também`;
            await interaction.channel?.send({ content: msg });
          } catch {}

          return interaction.update({ content: '❌ Resposta incorreta! Tente novamente amanhã.', components: [] });
        }
      }
      return; // other buttons ignored
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
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
          await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
      }
    }
  },
};
