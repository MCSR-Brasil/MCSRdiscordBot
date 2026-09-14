const logger = require('./logger');
const { addToWhitelist } = require('./pacemanWhitelist');
const { fetchJson } = require('./apiUtils');

const RANKED_LEADERBOARD_API_URL = process.env.RANKED_LEADERBOARD_API_URL || process.env.RANKED_API_URL;
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
 * Check whether a country code/country name represents Brazil.
 *
 * @param {any} country
 * @returns {boolean}
 */
function isBrazil(country) {
  if (!country) return false;
  const code = String(country).trim().toLowerCase();
  return ['br', 'bra', 'brazil', 'brasil'].includes(code);
}

/**
 * Extract an array from a loosely-typed API response.
 *
 * @param {any} data
 * @returns {any[]}
 */
function unwrapArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const keys = ['data', 'items', 'results', 'players', 'leaderboard', 'entries'];
    for (const key of keys) {
      if (key in data && Array.isArray(data[key])) {
        return data[key];
      }
    }
  }
  return [];
}

/**
 * Collect possible nicknames from a single API item.
 *
 * @param {Object} item
 * @returns {string[]}
 */
function extractNicknamesFromItem(item) {
  if (!item || typeof item !== 'object') return [];
  const names = [];
  if (item.nickname) names.push(item.nickname);
  if (item.name) names.push(item.name);
  if (item.username) names.push(item.username);
  if (item.player && typeof item.player === 'object') {
    if (item.player.nickname) names.push(item.player.nickname);
    if (item.player.name) names.push(item.player.name);
    if (item.player.username) names.push(item.player.username);
  }
  return names;
}

/**
 * Extract Brazilian player nicknames from ranked API data.
 *
 * Handles two common shapes:
 *   1. Array of player entries: [{ nickname, country }]
 *   2. Array of matches: [{ players: [{ nickname, country }] }]
 *
 * @param {any} data
 * @returns {string[]} Unique normalized Brazilian nicknames
 */
function extractBrazilianNicknames(data) {
  const items = unwrapArray(data);
  const normalized = new Set();

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    if (Array.isArray(item.players)) {
      for (const player of item.players) {
        if (player && isBrazil(player.country)) {
          for (const name of extractNicknamesFromItem(player)) {
            const key = normalizeName(name);
            if (key) normalized.add(key);
          }
        }
      }
      continue;
    }

    if (isBrazil(item.country)) {
      for (const name of extractNicknamesFromItem(item)) {
        const key = normalizeName(name);
        if (key) normalized.add(key);
      }
    }
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
 * Sync Brazilian players from the ranked leaderboard/matches API into the
 * Paceman whitelist. Existing whitelist entries are left untouched.
 *
 * @param {Object} [options]
 * @param {string} [options.apiUrl] - Override the API URL to fetch
 * @param {number} [options.timeout] - Request timeout in ms
 * @param {number} [options.retries] - Number of retries after the first attempt
 *
 * @returns {Promise<{found: number, added: number, alreadyPresent: number, addedNames: string[], errors: string[], source: string}>}
 */
async function syncRankedBrazilianToPacemanWhitelist(options = {}) {
  const {
    apiUrl = RANKED_LEADERBOARD_API_URL,
    timeout = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
  } = options;

  if (!apiUrl) {
    throw new Error('RANKED_LEADERBOARD_API_URL (or RANKED_API_URL) is not configured');
  }

  logger.info(`rankedWhitelistSync: fetching ${apiUrl}`);

  let data;
  try {
    data = await fetchJson(apiUrl, { timeout, retries });
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
