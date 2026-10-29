const { EmbedBuilder } = require('discord.js');
const logger = require('../lib/logger');
const {
  getStatsForDate,
  deleteStatsForDate,
  formatDuration,
  toBrasiliaDateString,
} = require('../lib/rankedDailyStats');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_STATS_CHANNEL_ID = '807688775870054413';

const WIN = process.env.WIN_EMOJI || '🏆';
const LOSE = process.env.LOSE_EMOJI || '❌';
const CLOCK = process.env.CLOCK_EMOJI || '⏱️';
const TROPHY = process.env.TROPHY_EMOJI || '🏆';
const GLOBE = process.env.GLOBE_EMOJI || '🌐';
const RANKED = process.env.RANKED_EMOJI || '🏆';

/**
 * Calculate the milliseconds until the next midnight in Brasilia time.
 *
 * Brasilia is UTC-3, so midnight BRT == 03:00 UTC.
 *
 * @param {number} [now]
 * @returns {number}
 */
function msUntilNextMidnightBrasilia(now = Date.now()) {
  const utc = new Date(now);
  const y = utc.getUTCFullYear();
  const m = utc.getUTCMonth();
  const d = utc.getUTCDate();
  let target = Date.UTC(y, m, d, 3, 0, 0); // 03:00 UTC == 00:00 BRT
  if (target <= now) {
    target += ONE_DAY_MS;
  }
  return target - now;
}

async function getSummaryChannel(client) {
  const channel = client.channels.cache.get(DAILY_STATS_CHANNEL_ID)
    || await client.channels.fetch(DAILY_STATS_CHANNEL_ID).catch(error => {
      logger.warn(`rankedDailySummary: failed to fetch channel ${DAILY_STATS_CHANNEL_ID}: ${error?.message || error}`);
      return null;
    });
  if (!channel) return null;

  if (!channel.isTextBased()) {
    logger.warn(`rankedDailySummary: channel ${DAILY_STATS_CHANNEL_ID} is not text-based`);
    return null;
  }

  return channel;
}

function formatSigned(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function buildBestTimesValue(stats) {
  const times = Array.isArray(stats.bestTimes) && stats.bestTimes.length
    ? stats.bestTimes
    : (stats.fastestTimeMs != null
      ? [{ timeMs: stats.fastestTimeMs, player: stats.fastestPlayer || '???' }]
      : []);
  if (!times.length) return '—';

  const entries = times.slice(0, 3).map(t => `**${formatDuration(t.timeMs)}** — ${t.player || '???'}`);
  // Wrap onto a new line if a single line would get too long
  const lines = [''];
  for (const entry of entries) {
    const current = lines[lines.length - 1];
    const candidate = current ? `${current} | ${entry}` : entry;
    if (current && candidate.length > 50) {
      lines.push(entry);
    } else {
      lines[lines.length - 1] = candidate;
    }
  }
  return lines.join('\n');
}

function buildEloValue(stats) {
  const totalEloWon = typeof stats.totalEloWon === 'number' ? stats.totalEloWon : 0;
  const lines = [`**${totalEloWon} Elo**`];

  const eloByPlayer = stats.eloByPlayer && typeof stats.eloByPlayer === 'object' ? stats.eloByPlayer : {};
  const entries = Object.entries(eloByPlayer);
  if (entries.length) {
    const loser = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
    const winner = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    const parts = [];
    if (loser[1] < 0) parts.push(`🔻 ${loser[0]} ${formatSigned(loser[1])}`);
    if (winner[1] > 0) parts.push(`🔺 ${winner[0]} ${formatSigned(winner[1])}`);
    if (parts.length) lines.push(parts.join(' | '));
  }

  return lines.join('\n');
}

function buildSummaryEmbed(stats) {
  const wins = stats.wins || 0;
  const losses = stats.losses || 0;
  const forfeits = stats.forfeits || 0;
  const total = Number.isFinite(stats.totalMatches) ? stats.totalMatches : wins + losses + forfeits;

  const embed = new EmbedBuilder()
    .setColor(0x5dade2)
    .setTitle(`${TROPHY} Resumo do dia ${GLOBE} ${RANKED}`)
    .addFields(
      { name: `${WIN} Vitórias`, value: `**${wins}**`, inline: true },
      { name: `${LOSE} Derrotas`, value: `**${losses}**`, inline: true },
      { name: `${CLOCK} Melhores tempos`, value: buildBestTimesValue(stats), inline: false },
      { name: '📈 Saldo de Elo BR', value: buildEloValue(stats), inline: false },
    )
    .setFooter({ text: `${total} Partidas totais | #Rankedbot` })
    .setTimestamp();

  return embed;
}

async function sendSummaryForDate(client, date, deleteAfterSend = false) {
  const channel = await getSummaryChannel(client);
  if (!channel) throw new Error(`Canal ${DAILY_STATS_CHANNEL_ID} não foi encontrado ou não é um canal de texto.`);

  const stats = getStatsForDate(date);
  if (!stats) return { sent: false, date, reason: 'no-stats' };

  await channel.send({ embeds: [buildSummaryEmbed(stats)] });
  logger.info(`rankedDailySummary: summary sent for ${date}`);
  if (deleteAfterSend) deleteStatsForDate(date);
  return { sent: true, date, stats };
}

async function sendDailySummary(client) {
  // Subtract a full day so small timer delays after midnight cannot select the new day.
  const yesterday = toBrasiliaDateString(Date.now() - ONE_DAY_MS);
  try {
    const result = await sendSummaryForDate(client, yesterday, true);
    if (!result.sent) logger.info(`rankedDailySummary: no stats recorded for ${yesterday}`);
  } catch (e) {
    logger.error('rankedDailySummary: failed to send summary:', e);
  }
}

async function sendCurrentDaySummary(client) {
  return sendSummaryForDate(client, toBrasiliaDateString(), false);
}

function registerJob({ register }) {
  register({
    name: 'ranked-daily-summary',
    async start(client) {
      const run = async () => {
        await sendDailySummary(client);
      };

      const initialDelay = msUntilNextMidnightBrasilia();
      logger.info(`rankedDailySummary: scheduled in ${initialDelay}ms (midnight BRT)`);

      let interval = null;
      const timeout = setTimeout(() => {
        run().catch(error => logger.error('rankedDailySummary: scheduled run failed:', error));
        interval = setInterval(
          () => run().catch(error => logger.error('rankedDailySummary: scheduled run failed:', error)),
          ONE_DAY_MS
        );
      }, initialDelay);

      return async () => {
        clearTimeout(timeout);
        if (interval) clearInterval(interval);
      };
    },
  });
}

module.exports = { register: registerJob, buildSummaryEmbed, sendCurrentDaySummary };
