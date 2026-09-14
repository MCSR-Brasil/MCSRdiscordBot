/**
 * Shared utilities for fetching, caching and parsing external API data.
 *
 * This module is meant to be the single place for reusable API helpers used
 * across the bot. It currently contains generic cache/fetch primitives plus a
 * dedicated helper for the Brazilian leaderboard (RSG / SSG 1.16) that is
 * exposed by the MCSRBR Google Runs API.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CACHE_TTL_MS = Number(process.env.LEADERBOARD_CACHE_TTL_MS) || ONE_DAY_MS;
const DEFAULT_TIMEOUT_MS = Number(process.env.LEADERBOARD_TIMEOUT_MS) || 30000;
const DEFAULT_RETRIES = 2;

const GOOGLE_RUNS_API_BASE = process.env.GOOGLE_RUNS_API_URL || 'https://script.google.com/macros/s/AKfycbztdxz4Cm5x03Xs_1mdX9Uxkf4g51FqohS-SqoAn28CPuvMAAJgdJsYhstp57PogdY4/exec';
const CACHE_DIR = path.resolve(__dirname, '../../data/cache');
const LEADERBOARD_CACHE_FILE = path.join(CACHE_DIR, 'brazilian_leaderboard_cache.json');

/* -------------------------------------------------------------------------- */
/* Generic cache helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ensure a cache directory exists, creating it recursively when missing.
 * Failures are logged but not thrown so the caller can decide what to do.
 *
 * @param {string} [dir] - Directory path (defaults to the project cache dir)
 */
function ensureCacheDir(dir = CACHE_DIR) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    logger.warn('Failed to create cache directory:', e);
  }
}

/**
 * Read and parse a JSON cache file.
 *
 * @param {string} filePath - Absolute path to the cache file
 * @returns {any|null} Parsed JSON content, or null if missing/unreadable
 */
function readJsonCache(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    logger.warn(`Failed to read cache file ${filePath}:`, e);
    return null;
  }
}

/**
 * Write data to a JSON cache file, creating parent directories as needed.
 *
 * @param {string} filePath - Absolute path to the cache file
 * @param {any} data - Serializable data to cache
 */
function writeJsonCache(filePath, data) {
  try {
    ensureCacheDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    logger.warn(`Failed to write cache file ${filePath}:`, e);
  }
}

/**
 * Check whether a cache file exists and was modified within the TTL window.
 *
 * @param {string} filePath - Absolute path to the cache file
 * @param {number} [ttlMs] - Time-to-live in milliseconds (defaults to 24h)
 * @returns {boolean} True when the cache is present and still fresh
 */
function isCacheFresh(filePath, ttlMs = DEFAULT_CACHE_TTL_MS) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    return Date.now() - stats.mtimeMs < ttlMs;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Generic fetch helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Perform a fetch with a hard timeout using AbortController.
 *
 * @param {string} url - URL to fetch
 * @param {Object} [options]
 * @param {number} [options.timeout] - Request timeout in ms (default: 30000)
 * @param {string} [options.method] - HTTP method (default: 'GET')
 * @param {Object} [options.headers] - Additional request headers
 * @param {BodyInit|null} [options.body] - Request body
 * @returns {Promise<Response>} Fetch Response object
 * @throws {Error} On timeout, network failure or non-OK HTTP status
 */
async function fetchWithTimeout(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, method = 'GET', headers = {}, body } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    return res;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw e;
  }
}

/**
 * Fetch a URL with automatic retries and exponential backoff.
 *
 * @param {string} url - URL to fetch
 * @param {Object} [options]
 * @param {number} [options.retries] - Number of retries after the first attempt (default: 2)
 * @param {number} [options.timeout] - Per-attempt timeout in ms
 * @param {string} [options.method] - HTTP method
 * @param {Object} [options.headers] - Additional request headers
 * @param {BodyInit|null} [options.body] - Request body
 * @returns {Promise<Response>} Fetch Response object
 * @throws {Error} The last encountered error if all attempts fail
 */
async function fetchWithRetry(url, options = {}) {
  const { retries = DEFAULT_RETRIES, ...fetchOptions } = options;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, fetchOptions);
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        const delay = 2 ** attempt * 1000;
        logger.warn(`fetchWithRetry: attempt ${attempt + 1}/${retries + 1} failed for ${url}, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Fetch JSON from a URL, with timeout and retry semantics built in.
 *
 * @param {string} url - URL to fetch
 * @param {Object} [options] - Options passed through to fetchWithRetry
 * @returns {Promise<any>} Parsed JSON body
 * @throws {Error} On network/timeout failure or invalid JSON response
 */
async function fetchJson(url, options = {}) {
  const res = await fetchWithRetry(url, options);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`Invalid JSON response from ${url}: ${e.message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Leaderboard helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Build a Google Runs API URL for a given spreadsheet action.
 *
 * @param {string} action - Action name, e.g. 'getrsg116' or 'getssg116'
 * @returns {string} Full API URL
 * @throws {Error} When the base API URL is not configured
 */
function buildApiUrl(action) {
  if (!GOOGLE_RUNS_API_BASE) {
    throw new Error('GOOGLE_RUNS_API_URL is not configured');
  }
  return `${GOOGLE_RUNS_API_BASE}?action=${action}`;
}

/**
 * Extract an array from a loosely-typed API response.
 *
 * Some endpoints wrap rows under keys like `data`, `results` or `items`, while
 * others return the array directly. This helper normalizes both shapes.
 *
 * @param {any} data - Raw API response
 * @param {string[]} keys - Candidate keys to look for when data is an object
 * @returns {any[]} The extracted array, or an empty array if nothing is found
 */
function unwrapArray(data, keys) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of keys) {
      if (key in data && Array.isArray(data[key])) {
        return data[key];
      }
    }
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Convert a speedrun time string to milliseconds.
 *
 * Supports `mm:ss` and `hh:mm:ss` formats. Returns null for invalid input so
 * malformed times can be filtered out safely.
 *
 * @param {any} value - Time string, e.g. '7:49' or '1:23:45'
 * @returns {number|null} Time in milliseconds, or null when unparseable
 */
function parseTimeToMs(value) {
  if (!value) return null;
  const text = String(value).trim();
  const parts = text.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return null;
}

/**
 * Parse a `M/D/YY` or `M/D/YYYY` date string into a local Date object.
 *
 * @param {any} value - Date string
 * @returns {Date|null} Parsed Date, or null for invalid/empty input
 */
function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match.map(Number);
  const fullYear = year < 100 ? 2000 + year : year;
  const date = new Date(fullYear, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * Parse raw leaderboard rows from the Google API into structured run objects.
 *
 * @param {any} data - Raw API response
 * @param {'rsg'|'ssg'} type - Run category being parsed
 * @returns {Object[]} Array of parsed run objects
 */
function parseRuns(data, type) {
  const keys = type === 'ssg'
    ? ['ssg', 'ssgRuns', 'runs', 'data', 'results', 'items']
    : ['rsg', 'rsgRuns', 'runs', 'data', 'results', 'items'];
  const rows = unwrapArray(data, keys).filter(Array.isArray);

  if (type === 'ssg') {
    return rows.map(row => ({
      name: row[0],
      time: row[1],
      seedName: row[2],
      date: row[3],
      parsedDate: parseDate(row[3]),
      verified: row[4],
      video: row[5],
      comment: row[6],
      type: 'SSG',
    }));
  }

  return rows.map(row => ({
    name: row[0],
    time: row[1],
    bastion: row[2],
    date: row[3],
    parsedDate: parseDate(row[3]),
    verified: row[4],
    seed: row[5],
    video: row[6],
    comment: row[7],
    type: 'RSG',
  }));
}

/**
 * Sort runs by ascending time and optionally slice to a top-N limit.
 *
 * Runs without a parseable time or explicitly marked as unverified are
 * filtered out before sorting.
 *
 * @param {Object[]} runs - Parsed run objects
 * @param {number} [limit] - Optional maximum number of runs to return
 * @returns {Object[]} Sorted runs, each augmented with a `ms` field
 */
function sortRunsByTime(runs, limit) {
  const sorted = runs
    .filter(r => r.time && r.verified !== false && r.verified !== 'FALSE')
    .map(r => ({ ...r, ms: parseTimeToMs(r.time) }))
    .filter(r => r.ms !== null && r.ms > 0)
    .sort((a, b) => a.ms - b.ms);

  if (limit && Number.isFinite(limit) && limit > 0) {
    return sorted.slice(0, limit);
  }
  return sorted;
}

/* -------------------------------------------------------------------------- */
/* Brazilian leaderboard                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Fetch and cache the Brazilian leaderboard from the Google Runs API.
 *
 * The result is cached to disk so subsequent calls can return immediately.
 * If the API is unreachable and stale cache exists, the cached data is
 * returned as a fallback. Use `fresh: true` to bypass the cache.
 *
 * @param {Object} [options]
 * @param {'rsg'|'ssg'|'both'} [options.category] - Which leaderboard to fetch (default: 'both')
 * @param {number} [options.limit] - How many top runs to return per category (default: 10)
 * @param {boolean} [options.fresh] - Skip cache and force a new API request (default: false)
 * @param {number} [options.timeout] - Request timeout in ms (default: 30000)
 * @param {number} [options.retries] - Number of retries on failure (default: 2)
 * @param {number} [options.ttlMs] - Cache TTL in ms (default: 24h)
 *
 * @returns {Promise<{rsg?: Object[], ssg?: Object[], source: string, cachedAt: number}>}
 * @throws {Error} For invalid options or when both the API and cache are unavailable
 */
async function getBrazilianLeaderboard(options = {}) {
  const {
    category = 'both',
    limit = 10,
    fresh = false,
    timeout = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    ttlMs = DEFAULT_CACHE_TTL_MS,
  } = options;

  if (!['rsg', 'ssg', 'both'].includes(category)) {
    throw new Error(`Invalid leaderboard category "${category}". Use 'rsg', 'ssg', or 'both'.`);
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('limit must be a positive number');
  }

  const cached = !fresh ? readJsonCache(LEADERBOARD_CACHE_FILE) : null;
  const hasFreshCache = cached && isCacheFresh(LEADERBOARD_CACHE_FILE, ttlMs);

  if (hasFreshCache) {
    logger.info('getBrazilianLeaderboard: returning cached leaderboard');
    return buildResult(cached, category, limit, 'cache');
  }

  const actions = [];
  if (category === 'both' || category === 'rsg') actions.push({ type: 'rsg', action: 'getrsg116' });
  if (category === 'both' || category === 'ssg') actions.push({ type: 'ssg', action: 'getssg116' });

  const fetched = {};
  let anySuccess = false;

  for (const { type, action } of actions) {
    try {
      const url = buildApiUrl(action);
      logger.info(`getBrazilianLeaderboard: fetching ${type} leaderboard from ${url}`);
      const data = await fetchJson(url, { timeout, retries });
      fetched[type] = sortRunsByTime(parseRuns(data, type));
      anySuccess = true;
    } catch (e) {
      logger.warn(`getBrazilianLeaderboard: failed to fetch ${type} leaderboard:`, e.message);
      fetched[type] = cached?.[type] || [];
    }
  }

  if (!anySuccess && !cached) {
    throw new Error('Failed to fetch Brazilian leaderboard and no cached data is available.');
  }

  const toCache = {
    rsg: fetched.rsg || cached?.rsg || [],
    ssg: fetched.ssg || cached?.ssg || [],
    cachedAt: Date.now(),
  };

  writeJsonCache(LEADERBOARD_CACHE_FILE, toCache);

  const source = anySuccess ? 'api' : 'cache';
  return buildResult(toCache, category, limit, source);
}

/**
 * Build the public result object from cached data.
 *
 * @param {Object} cache - Cached leaderboard object containing rsg/ssg arrays
 * @param {'rsg'|'ssg'|'both'} category - Requested category
 * @param {number} limit - Maximum number of runs per category
 * @param {'api'|'cache'} source - Where the data came from
 * @returns {Object} Result shaped for the caller
 */
function buildResult(cache, category, limit, source) {
  const result = { source, cachedAt: cache.cachedAt };

  if (category === 'both' || category === 'rsg') {
    result.rsg = sortRunsByTime(cache.rsg || [], limit);
  }
  if (category === 'both' || category === 'ssg') {
    result.ssg = sortRunsByTime(cache.ssg || [], limit);
  }

  return result;
}

module.exports = {
  // Cache helpers
  ensureCacheDir,
  readJsonCache,
  writeJsonCache,
  isCacheFresh,

  // Fetch helpers
  fetchWithTimeout,
  fetchWithRetry,
  fetchJson,

  // Leaderboard
  getBrazilianLeaderboard,
  parseTimeToMs,
  parseRuns,
  sortRunsByTime,
};
