const logger = require('../lib/logger');
const { syncRankedBrazilianToPacemanWhitelist, msUntilNext1AMBrasilia } = require('../lib/rankedWhitelistSync');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function registerJob({ register }) {
  register({
    name: 'ranked-whitelist-sync',
    async start() {
      const run = async () => {
        try {
          const result = await syncRankedBrazilianToPacemanWhitelist();
          logger.info(
            `rankedWhitelistSync job: found=${result.found}, added=${result.added}, alreadyPresent=${result.alreadyPresent}, errors=${result.errors.length}`
          );
        } catch (e) {
          logger.error('rankedWhitelistSync job failed:', e);
        }
      };

      const initialDelay = msUntilNext1AMBrasilia();
      logger.info(`rankedWhitelistSync job: scheduled in ${initialDelay}ms (daily at 01:00 BRT)`);

      const timeout = setTimeout(() => {
        run();
        setInterval(run, ONE_DAY_MS);
      }, initialDelay);

      return async () => clearTimeout(timeout);
    },
  });
}

module.exports = { register: registerJob };
