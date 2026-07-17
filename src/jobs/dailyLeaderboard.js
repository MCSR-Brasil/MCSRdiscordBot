const logger = require('../lib/logger');
const daily = require('../lib/daily');

const LEADERBOARD_CHANNEL_ID = process.env.DAILY_LEADERBOARD_CHANNEL_ID || '1419734249627451403';

async function postDailyLeaderboard(client) {
  const channel = await client.channels
    .fetch(LEADERBOARD_CHANNEL_ID)
    .catch(err => {
      logger.warn(`dailyLeaderboard: failed to fetch channel ${LEADERBOARD_CHANNEL_ID}: ${err?.message || err}`);
      return null;
    });

  if (!channel || !channel.isTextBased()) {
    logger.warn(`dailyLeaderboard: invalid channel ${LEADERBOARD_CHANNEL_ID}`);
    return;
  }

  const embed = await daily.buildLeaderboardEmbed(client, 8, '🏆 Daily Leaderboard');
  await channel.send({ embeds: [embed] });
  logger.info('dailyLeaderboard: posted leaderboard');
}

module.exports = {
  async register({ register }) {
    register({
      name: 'dailyLeaderboard',
      async start(client) {
        let timeout = null;
        let stopped = false;

        async function tick() {
          if (stopped) return;
          try {
            await postDailyLeaderboard(client);
          } catch (e) {
            logger.error('dailyLeaderboard: tick error:', e);
          } finally {
            if (!stopped) {
              timeout = setTimeout(tick, daily.msUntilNextMidnight());
            }
          }
        }

        timeout = setTimeout(tick, daily.msUntilNextMidnight());
        return () => { stopped = true; clearTimeout(timeout); };
      },
    });
  },
};
