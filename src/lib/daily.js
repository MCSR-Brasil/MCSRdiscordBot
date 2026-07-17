const { EmbedBuilder } = require('discord.js');
const { readJson, writeJson } = require('./store');

const DAILY_FILE = 'daily.json';
const DAY_MS = 24 * 60 * 60 * 1000;
const CORRECT_EMOJI = process.env.DAILY_CORRECT_EMOJI || '✅';
const INCORRECT_EMOJI = process.env.DAILY_INCORRECT_EMOJI || '❌';
const FIRE_EMOJI = process.env.DAILY_FIRE_EMOJI || '🔥';
// Use fixed Brazil time (Brasília) UTC-3, since Brazil currently has no DST.
const BRASILIA_TZ_OFFSET_MS = -3 * 60 * 60 * 1000; // UTC-3

function load() {
  return readJson(DAILY_FILE, {});
}

function save(db) {
  writeJson(DAILY_FILE, db);
}

// Helpers to work with calendar-day reset using Brasília time (UTC-3)
function toDayKey(ms = Date.now()) {
  // Shift to Brasília time by adding the timezone offset, then read UTC Y-M-D
  const zoned = new Date(ms + BRASILIA_TZ_OFFSET_MS);
  const y = zoned.getUTCFullYear();
  const m = String(zoned.getUTCMonth() + 1).padStart(2, '0');
  const day = String(zoned.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isSameBrazilDay(aMs, bMs) {
  return toDayKey(aMs) === toDayKey(bMs);
}

function isPreviousBrazilDay(previousMs, currentMs) {
  if (!previousMs) return false;
  const currentZoned = new Date(currentMs + BRASILIA_TZ_OFFSET_MS);
  const previousDayStartUtc = Date.UTC(
    currentZoned.getUTCFullYear(),
    currentZoned.getUTCMonth(),
    currentZoned.getUTCDate() - 1,
    0,
    0,
    0
  );
  const previousDayEpoch = previousDayStartUtc - BRASILIA_TZ_OFFSET_MS;
  return toDayKey(previousMs) === toDayKey(previousDayEpoch);
}

function msUntilNextMidnight(now = Date.now()) {
  // Compute next midnight in Brasília time, then convert back to epoch ms
  const zoned = new Date(now + BRASILIA_TZ_OFFSET_MS);
  const y = zoned.getUTCFullYear();
  const m = zoned.getUTCMonth();
  const d = zoned.getUTCDate();
  // Next midnight in Brasília wall time
  const nextMidnightZonedUTC = Date.UTC(y, m, d + 1, 0, 0, 0);
  // Convert back to actual epoch ms by subtracting the offset we added before
  const nextMidnightEpoch = nextMidnightZonedUTC - BRASILIA_TZ_OFFSET_MS;
  return Math.max(0, nextMidnightEpoch - now);
}

function getLastClaim(userId) {
  const db = load();
  return Number(db[userId]?.lastClaimAt || 0);
}

function getRecord(userId) {
  const db = load();
  return db[userId] || { lastClaimAt: 0, streak: 0 };
}

function getStreak(userId) {
  const rec = getRecord(userId);
  return Number(rec.streak || 0);
}

function setClaimNow(userId) {
  const db = load();
  const current = db[userId] || { streak: 0 };
  db[userId] = { ...current, lastClaimAt: Date.now() };
  save(db);
}

function registerAnswer(userId, isCorrect, now = Date.now()) {
  const db = load();
  const current = db[userId] || { lastClaimAt: 0, streak: 0 };
  const previousClaimAt = Number(current.lastClaimAt || 0);

  let streak = Number(current.streak || 0);
  let correct = Number(current.correct || 0);
  let incorrect = Number(current.incorrect || 0);

  if (isCorrect) {
    streak = isPreviousBrazilDay(previousClaimAt, now) ? streak + 1 : 1;
    correct += 1;
  } else {
    streak = 0;
    incorrect += 1;
  }

  const stats = {
    lastClaimAt: now,
    streak,
    correct,
    incorrect,
  };
  db[userId] = { ...current, ...stats };
  save(db);
  return stats;
}

function codePointLength(str) {
  return Array.from(String(str)).length;
}

function padEndCp(str, width) {
  const len = codePointLength(str);
  if (len >= width) return str;
  return str + ' '.repeat(width - len);
}

function formatStats(stats) {
  const streak = Number(stats?.streak || 0);
  const correct = Number(stats?.correct || 0);
  const incorrect = Number(stats?.incorrect || 0);
  return `Streak atual: ${streak} ${FIRE_EMOJI} | ${INCORRECT_EMOJI} Erros ${incorrect} | ${CORRECT_EMOJI} Acertos ${correct}`;
}

function getStats(userId) {
  const rec = getRecord(userId);
  return {
    lastClaimAt: Number(rec.lastClaimAt || 0),
    streak: Number(rec.streak || 0),
    correct: Number(rec.correct || 0),
    incorrect: Number(rec.incorrect || 0),
  };
}

function timeLeftMs(userId, now = Date.now()) {
  const last = getLastClaim(userId);
  // If never claimed or last claim wasn't today, no wait time
  if (!last || !isSameBrazilDay(last, now)) return 0;
  // Claimed today: time left is until next local midnight
  return msUntilNextMidnight(now);
}

function canClaim(userId, now = Date.now()) {
  return timeLeftMs(userId, now) === 0;
}

function calculateScore(correct, incorrect) {
  return correct - incorrect;
}

function getAllStats() {
  const db = load();
  return Object.entries(db).map(([userId, rec]) => ({
    userId,
    lastClaimAt: Number(rec.lastClaimAt || 0),
    streak: Number(rec.streak || 0),
    correct: Number(rec.correct || 0),
    incorrect: Number(rec.incorrect || 0),
  }));
}

function getLeaderboard(limit = 8) {
  const entries = getAllStats()
    .filter(e => e.correct > 0 || e.incorrect > 0)
    .map(e => ({ ...e, score: calculateScore(e.correct, e.incorrect) }));

  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.correct !== a.correct) return b.correct - a.correct;
    return a.incorrect - b.incorrect;
  });

  return entries.slice(0, limit);
}

async function resolveUserName(client, userId) {
  try {
    const user = await client.users.fetch(userId);
    return user?.displayName || user?.username || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

async function buildLeaderboardEmbed(client, limit = 8, title = '🏆 Daily Leaderboard') {
  const entries = getLeaderboard(limit);
  const withNames = await Promise.all(entries.map(async e => ({
    ...e,
    name: await resolveUserName(client, e.userId),
  })));

  const embed = new EmbedBuilder()
    .setColor(0x00b894)
    .setTitle(title)
    .setTimestamp();

  if (withNames.length === 0) {
    embed.setDescription('Nenhuma resposta registrada ainda.');
    return embed;
  }

  const rankWidth = Math.max(2, ...withNames.map((_, i) => String(i + 1).length + 1));
  const nameWidth = Math.max(6, ...withNames.map(e => codePointLength(e.name)));
  const errNumWidth = Math.max(1, ...withNames.map(e => String(e.incorrect).length));
  const correctNumWidth = Math.max(1, ...withNames.map(e => String(e.correct).length));
  const scoreNumWidth = Math.max(1, ...withNames.map(e => String(e.score).length));

  const errLabel = `${INCORRECT_EMOJI} Erros `;
  const correctLabel = `${CORRECT_EMOJI} Acertos `;
  const scoreLabel = 'Score: ';

  const lines = withNames.map((e, i) => {
    const rank = `${i + 1}.`.padEnd(rankWidth);
    const name = padEndCp(e.name, nameWidth);
    const err = `${errLabel}${String(e.incorrect).padStart(errNumWidth)}`;
    const correct = `${correctLabel}${String(e.correct).padStart(correctNumWidth)}`;
    const score = `${scoreLabel}${String(e.score).padStart(scoreNumWidth)}`;
    return `${rank} ${name}  ${err}  ${correct}  ${score}`;
  });

  const headerRank = '#'.padEnd(rankWidth);
  const headerName = padEndCp('Jogador', nameWidth);
  const headerErr = `${errLabel}${''.padStart(errNumWidth)}`;
  const headerCorrect = `${correctLabel}${''.padStart(correctNumWidth)}`;
  const headerScore = `${scoreLabel}${''.padStart(scoreNumWidth)}`;
  const header = `${headerRank} ${headerName}  ${headerErr}  ${headerCorrect}  ${headerScore}`;

  embed.setDescription(`\`\`\`\n${header}\n${lines.join('\n')}\n\`\`\``);
  embed.setFooter({ text: 'Reseta à meia-noite (horário de Brasília - UTC-3)' });
  return embed;
}

module.exports = { getLastClaim, getStreak, getStats, getAllStats, getLeaderboard, buildLeaderboardEmbed, formatStats, setClaimNow, registerAnswer, timeLeftMs, canClaim, DAY_MS, msUntilNextMidnight };

