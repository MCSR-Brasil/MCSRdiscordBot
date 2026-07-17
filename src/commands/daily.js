const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const daily = require('../lib/daily');
const { QUESTIONS } = require('../lib/dailyQuestions');

// Questions are now defined in src/lib/dailyQuestions.js

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTimeLeft(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function attachIfLocal(value, files) {
  if (!value || /^https?:\/\//i.test(value)) return;
  const localPath = path.isAbsolute(value) ? value : path.join(__dirname, '..', '..', value);
  if (fs.existsSync(localPath)) {
    files.push(new AttachmentBuilder(localPath, { name: path.basename(localPath) }));
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Responda uma pergunta diária (reseta à meia-noite, horário de Brasília - UTC-3).'),
  async execute(interaction) {
    const userId = interaction.user.id;

    // Cooldown check
    if (!daily.canClaim(userId)) {
      const left = daily.timeLeftMs(userId);
      return interaction.reply({ content: `Você já usou o daily. Tente novamente em ${formatTimeLeft(left)}.`, flags: MessageFlags.Ephemeral });
    }

    // Pick a random question and track its index
    const qIndex = Math.floor(Math.random() * QUESTIONS.length);
    const q = QUESTIONS[qIndex];
    // Keep options in the original order and track which one is correct
    const opts = q.options.map((text, idx) => ({ text, correct: idx === q.correctIndex }));

    const embed = new EmbedBuilder()
      .setColor(0x00b894)
      .setTitle('Pergunta Diaria')
      .setDescription(q.q)
      .setFooter({ text: 'Reseta à meia-noite (horário de Brasília - UTC-3)' })
      .setTimestamp(new Date());

    const files = [];
    let imageUrl = null;
    if (q.image) {
      if (/^https?:\/\//i.test(q.image)) {
        imageUrl = q.image;
      } else {
        attachIfLocal(q.image, files);
        imageUrl = `attachment://${path.basename(q.image)}`;
      }
    }
    if (imageUrl) embed.setImage(imageUrl);

    let content = undefined;
    if (q.video) {
      if (/^https?:\/\//i.test(q.video)) {
        content = q.video;
      } else {
        attachIfLocal(q.video, files);
      }
    }

    const row = new ActionRowBuilder().addComponents(
      ...opts.map((o, i) =>
        new ButtonBuilder()
          // Format: daily:<userId>:<choiceIndex>:<isCorrect:0|1>:<qIndex>
          .setCustomId(`daily:${userId}:${i}:${o.correct ? '1' : '0'}:${qIndex}`)
          .setLabel(o.text)
          .setStyle(ButtonStyle.Primary)
      )
    );

    const replyOptions = { embeds: [embed], components: [row], flags: MessageFlags.Ephemeral };
    if (content) replyOptions.content = content;
    if (files.length > 0) replyOptions.files = files;

    // Ephemeral to keep the channel clean (only user sees the buttons)
    return interaction.reply(replyOptions);
  },
};
