const { EmbedBuilder } = require('discord.js');
const { readJson, writeJson } = require('./store');
const daily = require('./daily');

const GOALS_FILE = 'daily_goals.json';
const BAR_SIZE = 15;
const BAR_FILLED = '🟩';
const BAR_EMPTY = '⬜';

function getGoals() {
  const db = readJson(GOALS_FILE, { goals: [] });
  const list = Array.isArray(db.goals) ? db.goals : [];
  return list
    .map(g => ({ points: Number(g.points), reward: String(g.reward || '').trim() }))
    .filter(g => Number.isFinite(g.points) && g.points > 0 && g.reward)
    .sort((a, b) => a.points - b.points);
}

function saveGoals(goals) {
  writeJson(GOALS_FILE, { goals });
}

function setGoal(points, reward) {
  const goals = getGoals();
  const existing = goals.findIndex(g => g.points === points);
  if (existing >= 0) {
    goals[existing].reward = reward;
  } else {
    goals.push({ points, reward });
    goals.sort((a, b) => a.points - b.points);
  }
  saveGoals(goals);
  return goals;
}

function removeGoal(points) {
  const goals = getGoals();
  const filtered = goals.filter(g => g.points !== points);
  if (filtered.length === goals.length) return null;
  saveGoals(filtered);
  return filtered;
}

function buildProgressBar(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  const filled = Math.round(clamped * BAR_SIZE);
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(BAR_SIZE - filled);
}

function buildGoalsEmbed() {
  const goals = getGoals();
  const total = daily.getTotalCorrect();

  const embed = new EmbedBuilder()
    .setColor(0x00b894)
    .setTitle('🎯 Metas do Daily Quiz')
    .setTimestamp()
    .setFooter({ text: 'Atualizado às 00:15 (horário de Brasília - UTC-3)' });

  if (!goals.length) {
    embed.setDescription(
      `**Total de acertos: ${total}**\n\nNenhuma meta configurada ainda. Use \`/dailygoals definir\` para criar uma.`
    );
    return embed;
  }

  const completed = goals.filter(g => total >= g.points);
  const current = goals.find(g => total < g.points) || null;
  const upcoming = current ? goals.filter(g => g.points > current.points) : [];

  const lines = [`**Total de acertos: ${total}**`];

  for (const g of completed) {
    lines.push(`✅ ~~${g.points}~~ — **${g.reward}**`);
  }

  if (current) {
    const progress = total / current.points;
    const pct = Math.floor(progress * 100);
    const remaining = current.points - total;
    lines.push(
      '',
      `🎯 **Próxima meta: ${current.reward}** (${current.points} acertos)`,
      `${buildProgressBar(progress)}  **${total} / ${current.points}** (${pct}%)`,
      `-# Faltam ${remaining} acertos`
    );
  } else {
    lines.push('', '🏆 **Todas as metas foram concluídas!**');
  }

  for (const g of upcoming) {
    lines.push(`🔒 ${g.points} — ${g.reward}`);
  }

  embed.setDescription(lines.join('\n'));
  return embed;
}

module.exports = { getGoals, setGoal, removeGoal, buildGoalsEmbed, buildProgressBar };
