const logger = require('./logger');
const { addToWhitelist } = require('./pacemanWhitelist');
const { fetchJson } = require('./apiUtils');

const RANKED_BR_LEADERBOARD_URL = 'https://api.mcsrranked.com/leaderboard?country=br';
const DEFAULT_TIMEOUT_MS = Number(process.env.RANKED_WHITELIST_SYNC_TIMEOUT_MS) || 30000;
const DEFAULT_RETRIES = Number(process.env.RANKED_WHITELIST_SYNC_RETRIES) || 2;

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * Normalize a player name for consistent whitelist storage.
 *
 * @param {any} name
 * @returns {string}
 */
function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

/**
 * Check whether a country code represents Brazil.
 *
 * @param {any} country
 * @returns {boolean}
 */
function isBrazil(country) {
  if (!country) return false;
  const code = String(country).trim().toLowerCase();
  return code === 'br' || code === 'bra' || code === 'brazil' || code === 'brasil';
}

/**
 * Extract Brazilian player nicknames from the ranked leaderboard API response.
 *
 * Expected shape:
 *   {
 *     status: 'success',
 *     data: {
 *       season: { ... },
 *       users: [{ uuid, nickname, country, eloRate, ... }, ...]
 *     }
 *   }
 *
 * @param {any} data
 * @returns {string[]} Unique normalized Brazilian nicknames
 */
function extractBrazilianNicknames(data) {
  const users = data?.data?.users;
  if (!Array.isArray(users)) return [];

  const normalized = new Set();
  for (const user of users) {
    if (!user || typeof user !== 'object') continue;
    if (!isBrazil(user.country)) continue;
    const nickname = normalizeName(user.nickname);
    if (nickname) normalized.add(nickname);
  }

  return Array.from(normalized);
}

/**
 * Calculate the milliseconds until the next 01:00 Brasilia time.
 *
 * Brasilia is UTC-3, so 01:00 BRT == 04:00 UTC.
 *
 * @param {number} [now] - Timestamp in ms (defaults to Date.now())
 * @returns {number}
 */
function msUntilNext1AMBrasilia(now = Date.now()) {
  const utc = new Date(now);
  const y = utc.getUTCFullYear();
  const m = utc.getUTCMonth();
  const d = utc.getUTCDate();
  // 01:00 BRT == 04:00 UTC
  let target = Date.UTC(y, m, d, 4, 0, 0);
  if (target <= now) {
    target += ONE_DAY_MS;
  }
  return target - now;
}

/**
 * Sync Brazilian players from the ranked leaderboard API into the Paceman
 * whitelist. Existing whitelist entries are left untouched.
 *
 * @param {Object} [options]
 * @param {number} [options.timeout] - Request timeout in ms (default: 30000)
 * @param {number} [options.retries] - Number of retries after the first attempt (default: 2)
 *
 * @returns {Promise<{found: number, added: number, alreadyPresent: number, addedNames: string[], errors: string[], source: string}>}
 */
async function syncRankedBrazilianToPacemanWhitelist(options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
  } = options;

  logger.info(`rankedWhitelistSync: fetching ${RANKED_BR_LEADERBOARD_URL}`);

  let data;
  try {
    data = await fetchJson(RANKED_BR_LEADERBOARD_URL, { timeout, retries });
  } catch (e) {
    logger.error('rankedWhitelistSync: fetch failed:', e);
    throw new Error(`Failed to fetch ranked leaderboard: ${e.message}`);
  }

  const names = extractBrazilianNicknames(data);

  let added = 0;
  let alreadyPresent = 0;
  const errors = [];
  const addedNames = [];

  for (const name of names) {
    try {
      const wasAdded = addToWhitelist(name);
      if (wasAdded) {
        added++;
        addedNames.push(name);
        logger.info(`rankedWhitelistSync: added ${name} to Paceman whitelist`);
      } else {
        alreadyPresent++;
      }
    } catch (e) {
      const msg = `${name}: ${e.message}`;
      logger.error(`rankedWhitelistSync: failed to add ${name}:`, e);
      errors.push(msg);
    }
  }

  logger.info(`rankedWhitelistSync: found=${names.length}, added=${added}, alreadyPresent=${alreadyPresent}, errors=${errors.length}`);

  return {
    found: names.length,
    added,
    alreadyPresent,
    addedNames,
    errors,
    source: 'api',
  };
}

module.exports = {
  syncRankedBrazilianToPacemanWhitelist,
  extractBrazilianNicknames,
  isBrazil,
  normalizeName,
  msUntilNext1AMBrasilia,
};
