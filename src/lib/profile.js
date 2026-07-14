const { EmbedBuilder } = require('discord.js');
const logger = require('./logger');

const GOOGLE_RUNS_API_BASE = process.env.GOOGLE_RUNS_API_URL || 'https://script.google.com/macros/s/AKfycbztdxz4Cm5x03Xs_1mdX9Uxkf4g51FqohS-SqoAn28CPuvMAAJgdJsYhstp57PogdY4/exec';

const ACTIONS = {
  runners: 'getrunners',
  rsg: 'getrsg116',
  ssg: 'getssg116',
};

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
  const [, day, month, year] = match.map(Number);
  const fullYear = year < 100 ? 2000 + year : year;
  const date = new Date(fullYear, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseRunners(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter(Array.isArray)
    .map(row => ({
      name: row[0],
      state: row[1],
      color: row[2],
    }));
}

function parseRsgRuns(data) {
  if (!Array.isArray(data)) return [];
  return data
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
  if (!Array.isArray(data)) return [];
  return data
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
  return runners.find(r => normalizeName(r.name) === normalizeName(name));
}

function findRuns(runs, name) {
  return runs.filter(r => normalizeName(r.name) === normalizeName(name));
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

function formatVerified(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === 'sim' ? '✅' : '❌';
}

function formatRunLine(run, maxComment = 80) {
  const parts = [];
  if (run.time) parts.push(`⏱ ${run.time}`);
  if (run.date) parts.push(`📅 ${run.date}`);
  if (run.verified !== undefined) parts.push(`${formatVerified(run.verified)} Verificada`);
  if (run.type === 'RSG') {
    if (run.bastion) parts.push(`🛡 ${run.bastion}`);
    if (run.seed) parts.push(`🌱 ${run.seed}`);
  } else if (run.type === 'SSG') {
    if (run.seedName) parts.push(`🌱 ${run.seedName}`);
  }
  if (run.video) parts.push(`▶ [Vídeo](${run.video})`);
  let comment = run.comment ? String(run.comment).trim() : '';
  if (comment.length > maxComment) comment = `${comment.slice(0, maxComment)}…`;
  if (comment) parts.push(`💬 ${comment}`);
  return parts.join(' • ');
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

function normalizeProfile(name, runner, rsgRuns, ssgRuns) {
  return {
    name: runner?.name || name,
    state: runner?.state || '—',
    color: runner?.color || '—',
    rsgRuns,
    ssgRuns,
  };
}

function buildProfileEmbed(profile) {
  const color = colorToHex(profile.color);
  let description = profile.state && profile.state !== '—'
    ? `📍 Estado: ${profile.state}`
    : 'Informações de corridas do runner.';
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Perfil de ${profile.name}`)
    .setDescription(description);

  const rsgField = formatRunsSection(profile.rsgRuns, '🏃 Runs 1.16 RSG');
  if (rsgField) embed.addFields(rsgField);

  const ssgField = formatRunsSection(profile.ssgRuns, '⚡ Runs 1.16 SSG');
  if (ssgField) embed.addFields(ssgField);

  if (!rsgField && !ssgField) {
    embed.setDescription(`${description}\nNenhuma run encontrada.`.trim());
  }

  embed.setTimestamp();
  return embed;
}

async function fetchJson(action) {
  const url = buildApiUrl(action);
  logger.info(`fetchJson: fetching ${url}`);
  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    logger.error(`fetchJson: fetch failed for ${action}:`, e);
    throw new Error(`Falha ao conectar com a API (${action}).`);
  }
  if (!res.ok) {
    logger.warn(`fetchJson: non-OK status ${res.status} from ${url}`);
    throw new Error(`A API retornou um erro (${action}): ${res.status}.`);
  }
  try {
    return await res.json();
  } catch (e) {
    logger.error(`fetchJson: failed to parse JSON for ${action}:`, e);
    throw new Error(`A API retornou uma resposta inválida (${action}).`);
  }
}

async function fetchProfile(name) {
  const [runnersData, rsgData, ssgData] = await Promise.all([
    fetchJson(ACTIONS.runners),
    fetchJson(ACTIONS.rsg),
    fetchJson(ACTIONS.ssg),
  ]);

  const runners = parseRunners(runnersData);
  const runner = findRunner(runners, name);

  const rsgRuns = findRuns(parseRsgRuns(rsgData), name);
  const ssgRuns = findRuns(parseSsgRuns(ssgData), name);

  if (!runner && rsgRuns.length === 0 && ssgRuns.length === 0) {
    throw new Error('Runner não encontrado.');
  }

  return normalizeProfile(name, runner, rsgRuns, ssgRuns);
}

module.exports = {
  fetchProfile,
  buildProfileEmbed,
  normalizeProfile,
  buildApiUrl,
  colorToHex,
};
