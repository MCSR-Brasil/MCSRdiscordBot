const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.resolve(__dirname, '../data');
const STATS_FILE = path.join(DATA_DIR, 'ranked_daily_stats.json');

const BRASILIA_OFFSET_MS = -3 * 60 * 60 * 1000;

/**
 * Get today's date string in Brasilia timezone (YYYY-MM-DD).
 *
 * @param {number} [ms]
 * @returns {string}
 */
function toBrasiliaDateString(ms = Date.now()) {
  const zoned = new Date(ms + BRASILIA_OFFSET_MS);
  const y = zoned.getUTCFullYear();
  const m = String(zoned.getUTCMonth() + 1).padStart(2, '0');
  const d = String(zoned.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) return {};
    const raw = fs.readFileSync(STATS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    logger.warn('rankedDailyStats: failed to load stats:', e);
    return {};
  }
}

function saveStats(stats) {
  try {
    ensureDataDir();
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf-8');
  } catch (e) {
    logger.warn('rankedDailyStats: failed to save stats:', e);
  }
}

function isBrazil(country) {
  if (!country) return false;
  const code = String(country).trim().toLowerCase();
  return code === 'br' || code === 'bra' || code === 'brazil' || code === 'brasil';
}

/**
 * Parse match result time to milliseconds.
 * The API may return seconds or milliseconds; we use a heuristic cutoff.
 *
 * @param {any} raw
 * @returns {number|null}
 */
function parseMatchTime(raw) {
  if (raw == null) return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return null;
  return v < 100000 ? v * 1000 : v;
}

/**
 * Format a millisecond duration as m:ss or h:mm:ss.
 *
 * @param {number|null} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getEloChangeForPlayer(match, uuid) {
  if (!Array.isArray(match?.changes)) return 0;
  const change = match.changes.find(c => c?.uuid === uuid)?.change;
  if (typeof change === 'number' && Number.isFinite(change)) return change;
  return 0;
}

function getDayStats(stats, date) {
  if (!stats[date]) {
    stats[date] = {
      date,
      wins: 0,
      losses: 0,
      forfeits: 0,
      fastestTimeMs: null,
      fastestPlayer: null,
      fastestMatchId: null,
      totalEloWon: 0,
      seenMatchIds: [],
    };
  }
  return stats[date];
}

/**
 * Process a ranked match and update the daily stats for the current Brasilia day.
 *
 * @param {Object} match
 */
function processMatch(match) {
  const date = toBrasiliaDateString();
  const stats = loadStats();
  const day = getDayStats(stats, date);

  const matchId = match?.id;
  if (!matchId) return;
  if (day.seenMatchIds.includes(matchId)) return;

  const players = Array.isArray(match.players) ? match.players : [];
  const winnerUuid = match?.result?.uuid || null;
  const isForfeit = Boolean(match.forfeited);
  const matchTimeMs = isForfeit ? null : parseMatchTime(match?.result?.time);

  let involvedBR = false;

  for (const player of players) {
    if (!isBrazil(player?.country)) continue;
    involvedBR = true;
    const playerUuid = player.uuid;

    if (isForfeit) {
      day.forfeits++;
    } else if (winnerUuid) {
      if (playerUuid === winnerUuid) {
        day.wins++;
      } else {
        day.losses++;
      }
    }

    const eloChange = getEloChangeForPlayer(match, playerUuid);
    if (eloChange > 0) {
      day.totalEloWon += eloChange;
    }

    // Fastest time belongs to the winning BR player of a completed match.
    if (!isForfeit && matchTimeMs != null && playerUuid === winnerUuid) {
      if (day.fastestTimeMs == null || matchTimeMs < day.fastestTimeMs) {
        day.fastestTimeMs = matchTimeMs;
        day.fastestPlayer = player.nickname || player.name || '???';
        day.fastestMatchId = matchId;
      }
    }
  }

  if (involvedBR) {
    day.seenMatchIds.push(matchId);
    saveStats(stats);
  }
}

/**
 * Get stats for a specific date.
 *
 * @param {string} [date]
 * @returns {Object|null}
 */
function getStatsForDate(date = toBrasiliaDateString()) {
  const stats = loadStats();
  return stats[date] || null;
}

/**
 * Delete stats for a specific date.
 *
 * @param {string} [date]
 */
function deleteStatsForDate(date = toBrasiliaDateString()) {
  const stats = loadStats();
  if (stats[date]) {
    delete stats[date];
    saveStats(stats);
  }
}

module.exports = {
  processMatch,
  getStatsForDate,
  deleteStatsForDate,
  formatDuration,
  toBrasiliaDateString,
};
