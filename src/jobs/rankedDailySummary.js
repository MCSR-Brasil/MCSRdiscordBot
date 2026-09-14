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
const FF = process.env.FF_EMOJI || '🏳️';
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

function getSummaryChannel(client) {
  const channel = client.channels.cache.get(DAILY_STATS_CHANNEL_ID) || client.channels.resolve(DAILY_STATS_CHANNEL_ID);
  if (!channel) {
    logger.warn(`rankedDailySummary: could not resolve channel ${DAILY_STATS_CHANNEL_ID}`);
    return null;
  }

  if (!channel.isTextBased()) {
    logger.warn(`rankedDailySummary: channel ${DAILY_STATS_CHANNEL_ID} is not text-based`);
    return null;
  }

  return channel;
}

function buildSummaryEmbed(stats) {
  const wins = stats.wins || 0;
  const losses = stats.losses || 0;
  const forfeits = stats.forfeits || 0;
  const total = wins + losses + forfeits;

  const fastestValue = stats.fastestTimeMs != null
    ? `**${formatDuration(stats.fastestTimeMs)}** — ${stats.fastestPlayer || '???'}`
    : '—';

  const totalEloWon = typeof stats.totalEloWon === 'number' ? stats.totalEloWon : 0;
  const eloValue = totalEloWon > 0 ? `+${totalEloWon}` : `${totalEloWon}`;

  const embed = new EmbedBuilder()
    .setColor(0x5dade2)
    .setTitle(`${TROPHY} Resumo do dia ${GLOBE} ${RANKED}`)
    .addFields(
      { name: `${WIN} Vitórias`, value: `**${wins}**`, inline: true },
      { name: `${LOSE} Derrotas`, value: `**${losses}**`, inline: true },
      { name: `${FF} Forfeit`, value: `**${forfeits}**`, inline: true },
      { name: `${CLOCK} Tempo mais rápido`, value: fastestValue, inline: false },
      { name: '📈 Elo ganho total', value: `**${eloValue}**`, inline: false },
    )
    .setFooter({ text: `${total} Partidas totais | #Rankedbot` })
    .setTimestamp();

  return embed;
}

async function sendDailySummary(client) {
  const channel = getSummaryChannel(client);
  if (!channel) return;

  // At midnight BRT we just switched days; report on the day that ended.
  const yesterday = toBrasiliaDateString(Date.now() - 1);
  const stats = getStatsForDate(yesterday);

  if (!stats) {
    logger.info(`rankedDailySummary: no stats recorded for ${yesterday}`);
    return;
  }

  try {
    await channel.send({ embeds: [buildSummaryEmbed(stats)] });
    logger.info(`rankedDailySummary: summary sent for ${yesterday}`);
    deleteStatsForDate(yesterday);
  } catch (e) {
    logger.error('rankedDailySummary: failed to send summary:', e);
  }
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

      const timeout = setTimeout(() => {
        run();
        setInterval(run, ONE_DAY_MS);
      }, initialDelay);

      return async () => clearTimeout(timeout);
    },
  });
}

module.exports = { register: registerJob, buildSummaryEmbed };
