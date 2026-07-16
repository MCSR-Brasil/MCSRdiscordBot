const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');

const TROPHY_EMOJI = process.env.TROPHY_EMOJI || '🏆';
const GLOBE_EMOJI = process.env.GLOBE_EMOJI || '🌐';
const RANKED_EMOJI = process.env.RANKED_EMOJI || '🏆';
const COIN_EMOJI = process.env.COIN_EMOJI || '💰';
const CLOCK_EMOJI = process.env.CLOCK_EMOJI || '⏱';
const BURIED_TREASURE_EMOJI = process.env.BURIED_TREASURE_EMOJI || process.env.BURIED_TRASURE || '🏴‍☠️';
const SEED_EMOJI = process.env.SEED_EMOJI || '�';
const LOGO_EMOJI = process.env.LOGO_EMOJI || '�';
const MCSRBR_QUEUE_URL = 'mcsrbr.queuefish.ing';

const GOOGLE_RUNS_API_BASE = process.env.GOOGLE_RUNS_API_URL || 'https://script.google.com/macros/s/AKfycbztdxz4Cm5x03Xs_1mdX9Uxkf4g51FqohS-SqoAn28CPuvMAAJgdJsYhstp57PogdY4/exec';

const ACTIONS = {
  runners: 'getrunners',
  rsg: 'getrsg116',
  ssg: 'getssg116',
  earnings: 'getearnings',
};

let earningsCache = new Map();

let runnersCache = [];
let rsgRunsCache = [];
let ssgRunsCache = [];
let profileCacheLoaded = false;

function buildApiUrl(action) {
  return `${GOOGLE_RUNS_API_BASE}?action=${action}`;
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

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

function parseRunners(data) {
  const rows = unwrapArray(data, ['runners', 'data', 'results', 'items']);
  return rows
    .filter(Array.isArray)
    .map(row => ({
      name: row[0],
      state: row[1],
      color: row[2],
      uuid: row[3],
    }));
}

function parseRsgRuns(data) {
  const rows = unwrapArray(data, ['rsg', 'rsgRuns', 'runs', 'data', 'results', 'items']);
  return rows
    .filter(Array.isArray)
    .map(row => ({
      name: row[0],
      time: row[1],
      bastion: row[2],
      date: row[3],
      verified: row[4],
      seed: row[5],
      video: row[6],
      comment: row[7],
      parsedDate: parseDate(row[3]),
      type: 'RSG',
    }));
}

function parseSsgRuns(data) {
  const rows = unwrapArray(data, ['ssg', 'ssgRuns', 'runs', 'data', 'results', 'items']);
  return rows
    .filter(Array.isArray)
    .map(row => ({
      name: row[0],
      time: row[1],
      seedName: row[2],
      date: row[3],
      verified: row[4],
      video: row[5],
      comment: row[6],
      parsedDate: parseDate(row[3]),
      type: 'SSG',
    }));
}

function findRunner(runners, name) {
  const query = normalizeName(name);
  return runners.find(r => {
    const runnerName = normalizeName(r.name);
    return runnerName === query || runnerName.includes(query) || query.includes(runnerName);
  });
}

function findRuns(runs, name) {
  return runs.filter(r => normalizeName(r.name) === normalizeName(name));
}

function calculateEarnings(tournaments) {
  const map = new Map();
  for (const tournament of tournaments) {
    const winners = Array.isArray(tournament?.winners) ? tournament.winners : [];
    for (const winner of winners) {
      if (!Array.isArray(winner) || winner.length < 2) continue;
      const name = normalizeName(winner[0]);
      const amount = Number(winner[1]) || 0;
      if (!name || Number.isNaN(amount)) continue;
      map.set(name, (map.get(name) || 0) + amount);
    }
  }
  return map;
}

async function loadEarningsCache(timeoutMs = 15000) {
  try {
    const data = await fetchWithTimeout(ACTIONS.earnings, timeoutMs);
    const tournaments = unwrapArray(data, ['tournaments', 'data', 'results', 'items']);
    earningsCache = calculateEarnings(tournaments);
    logger.info(`Earnings cache loaded for ${earningsCache.size} players`);
  } catch (e) {
    logger.error('Failed to load earnings cache:', e);
    earningsCache = new Map();
  }
}

function getEarnings(name) {
  return earningsCache.get(normalizeName(name)) || 0;
}

function colorToHex(color) {
  const map = {
    red: 0xe74c3c,
    blue: 0x3498db,
    green: 0x2ecc71,
    yellow: 0xf1c40f,
    orange: 0xe67e22,
    purple: 0x9b59b6,
    pink: 0xff9ff3,
    black: 0x2c3e50,
    white: 0xecf0f1,
    gray: 0x95a5a6,
    grey: 0x95a5a6,
    cyan: 0x00d2d3,
    lime: 0x7bed9f,
    brown: 0x8b4513,
    gold: 0xf9ca24,
    silver: 0xbdc3c7,
  };
  if (!color) return 0x00b894;
  const key = String(color).trim().toLowerCase();
  return map[key] ?? 0x00b894;
}

function formatDateShort(parsedDate, rawDate) {
  const date = parsedDate || parseDate(rawDate);
  if (!date) return rawDate || '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

function stateFlagEmoji(state) {
  const key = state ? String(state).trim().toUpperCase() : '';
  if (!key) return '🇧🇷';
  return process.env[`STATE_EMOJI_${key}`] || process.env.STATE_EMOJI || '🇧🇷';
}

function emojiToUrl(emojiString) {
  const text = String(emojiString || '');
  const match = text.match(/<a?:[^:]+:(\d+)>/);
  if (!match) return null;
  const animated = text.startsWith('<a:');
  return `https://cdn.discordapp.com/emojis/${match[1]}.${animated ? 'gif' : 'png'}`;
}

function formatRunLine(run) {
  const lines = [];
  if (run.time) {
    const time = run.type === 'SSG'
      ? String(run.time).replace(/\.\d+.*$/, '')
      : run.time;
    lines.push(`${CLOCK_EMOJI} ${time}`);
  }
  const small = run.type === 'SSG'
    ? (run.seedName || formatDateShort(run.parsedDate, run.date))
    : formatDateShort(run.parsedDate, run.date);
  if (small) {
    lines.push(`-# ${small}`);
  }
  return lines.join('\n');
}

function formatRunsSection(runs, title, maxRuns = 5) {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const sorted = [...runs].sort((a, b) => {
    const aDate = a.parsedDate ? a.parsedDate.getTime() : 0;
    const bDate = b.parsedDate ? b.parsedDate.getTime() : 0;
    return bDate - aDate;
  });
  const shown = sorted.slice(0, maxRuns);
  const remaining = sorted.length - shown.length;
  let value = shown.map(r => formatRunLine(r)).join('\n');
  if (remaining > 0) value += `\n...e mais ${remaining} run(s).`;
  return { name: title, value, inline: false };
}

function normalizeProfile(name, runner, rsgRuns, ssgRuns, errorNote = null) {
  return {
    name: runner?.name || name,
    state: runner?.state || '—',
    color: runner?.color || '—',
    uuid: runner?.uuid || null,
    rsgRuns,
    ssgRuns,
    errorNote,
  };
}

function buildProfileEmbed(profile) {
  const color = colorToHex(profile.color);
  const stateFlag = stateFlagEmoji(profile.state);
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${LOGO_EMOJI} Perfil de ${profile.name} ${LOGO_EMOJI}`);

  if (profile.uuid) {
    const headUuid = String(profile.uuid).replace(/-/g, '');
    embed.setThumbnail(`https://mc-heads.net/head/${headUuid}`);
  }

  const rankedUrl = profile.uuid ? `https://mcsrranked.com/stats/${profile.uuid}` : null;
  const rankedField = rankedUrl
    ? { name: `${RANKED_EMOJI} Ranked:`, value: `\n[Perfil](${rankedUrl})`, inline: true }
    : null;
  const earnings = getEarnings(profile.name);
  const ganhosValue = earnings > 0 ? `R$ ${earnings.toLocaleString('pt-BR')}` : '—';
  const ganhosField = { name: `${COIN_EMOJI} Ganhos:`, value: ganhosValue, inline: true };

  if (rankedField) embed.addFields(rankedField);
  if (rankedField && ganhosField) {
    embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
  }
  if (ganhosField) embed.addFields(ganhosField);

  const rsgField = formatRunsSection(profile.rsgRuns, `${BURIED_TREASURE_EMOJI} RSG 1.16:`);
  const ssgField = formatRunsSection(profile.ssgRuns, `${SEED_EMOJI} SSG 1.16:`);

  if (rsgField && ssgField) {
    rsgField.inline = true;
    ssgField.inline = true;
  }

  if (rsgField) embed.addFields(rsgField);
  if (rsgField && ssgField) {
    embed.addFields({ name: '\u200b', value: '\u200b', inline: true });
  }
  if (ssgField) embed.addFields(ssgField);

  const footerText = profile.errorNote
    ? `${profile.errorNote} • ${MCSRBR_QUEUE_URL}`
    : MCSRBR_QUEUE_URL;
  embed.setFooter({ text: footerText, iconURL: emojiToUrl(LOGO_EMOJI) });

  embed.setTimestamp();
  return embed;
}

async function loadProfileCache(timeoutMs = 15000) {
  const results = await Promise.allSettled([
    fetchWithTimeout(ACTIONS.runners, timeoutMs),
    fetchWithTimeout(ACTIONS.rsg, timeoutMs),
    fetchWithTimeout(ACTIONS.ssg, timeoutMs),
  ]);

  if (results[0].status === 'fulfilled') runnersCache = parseRunners(results[0].value);
  else logger.warn('Failed to cache runners:', results[0].reason?.message || results[0].reason);

  if (results[1].status === 'fulfilled') rsgRunsCache = parseRsgRuns(results[1].value);
  else logger.warn('Failed to cache rsg runs:', results[1].reason?.message || results[1].reason);

  if (results[2].status === 'fulfilled') ssgRunsCache = parseSsgRuns(results[2].value);
  else logger.warn('Failed to cache ssg runs:', results[2].reason?.message || results[2].reason);

  profileCacheLoaded = true;
  logger.info(`Profile cache loaded: ${runnersCache.length} runners, ${rsgRunsCache.length} rsg runs, ${ssgRunsCache.length} ssg runs`);
}

async function fetchWithTimeout(action, timeoutMs) {
  const url = buildApiUrl(action);
  logger.info(`fetchWithTimeout: fetching ${url} (timeout ${timeoutMs}ms)`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn(`fetchWithTimeout: non-OK status ${res.status} from ${url}`);
      throw new Error(`A API retornou um erro (${action}): ${res.status}.`);
    }

    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`Timeout ao buscar ${action}.`);
    }
    logger.error(`fetchWithTimeout: fetch failed for ${action}:`, e);
    throw new Error(`Falha ao conectar com a API (${action}).`);
  }
}

async function fetchProfile(name) {
  if (!profileCacheLoaded) {
    await loadProfileCache();
  }

  const runner = findRunner(runnersCache, name);
  const resolvedName = runner?.name || name;
  const matchingRsg = findRuns(rsgRunsCache, resolvedName);
  const matchingSsg = findRuns(ssgRunsCache, resolvedName);

  if (!runner && matchingRsg.length === 0 && matchingSsg.length === 0) {
    throw new Error('Runner não encontrado.');
  }

  return normalizeProfile(name, runner, matchingRsg, matchingSsg, null);
}

module.exports = {
  fetchProfile,
  buildProfileEmbed,
  normalizeProfile,
  buildApiUrl,
  colorToHex,
  loadEarningsCache,
  getEarnings,
  loadProfileCache,
};
