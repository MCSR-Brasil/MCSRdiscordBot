const logger = require('../lib/logger');
const daily = require('../lib/daily');
const dailyGoals = require('../lib/dailyGoals');

const GOALS_CHANNEL_ID = process.env.DAILY_GOALS_CHANNEL_ID || '807697781623357531';

async function postDailyGoals(client) {
  const channel = await client.channels
    .fetch(GOALS_CHANNEL_ID)
    .catch(err => {
      logger.warn(`dailyGoals: failed to fetch channel ${GOALS_CHANNEL_ID}: ${err?.message || err}`);
      return null;
    });

  if (!channel || !channel.isTextBased()) {
    logger.warn(`dailyGoals: invalid channel ${GOALS_CHANNEL_ID}`);
    return;
  }

  const embed = dailyGoals.buildGoalsEmbed();
  await channel.send({ embeds: [embed] });
  logger.info('dailyGoals: posted goals progress');
}

module.exports = {
  async register({ register }) {
    register({
      name: 'dailyGoals',
      async start(client) {
        let timeout = null;
        let stopped = false;

        async function tick() {
          if (stopped) return;
          try {
            await postDailyGoals(client);
          } catch (e) {
            logger.error('dailyGoals: tick error:', e);
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
