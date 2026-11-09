const { readJson, writeJson } = require('./store');

const PENDING_FILE = 'thesis_pending.json';
const ANNOUNCED_FILE = 'thesis_announced.json';

const ELO_THRESHOLD = Number(process.env.THESIS_MIN_ELO) || 1980;

/**
 * Final elo for a player in a match: changes[].eloRate + change when present,
 * else players[].eloRate as-is.
 */
function finalElo(match, player) {
  const changes = Array.isArray(match?.changes) ? match.changes : [];
  const rec = changes.find(c => c?.uuid === player?.uuid);
  if (rec && Number.isFinite(Number(rec.eloRate)) && Number.isFinite(Number(rec.change))) {
    return Number(rec.eloRate) + Number(rec.change);
  }
  const rate = Number(player?.eloRate);
  return Number.isFinite(rate) ? rate : null;
}

function loadPending() {
  const list = readJson(PENDING_FILE, []);
  return Array.isArray(list) ? list : [];
}

function savePending(list) {
  writeJson(PENDING_FILE, list);
}

function loadAnnounced() {
  const set = readJson(ANNOUNCED_FILE, []);
  return new Set(Array.isArray(set) ? set : []);
}

function saveAnnounced(set) {
  writeJson(ANNOUNCED_FILE, Array.from(set));
}

/**
 * Record a match for the thesis replay digest if any player finished at
 * >= ELO_THRESHOLD. Stores a slim copy so the queue file stays small.
 * No-op for matches already pending or already announced.
 */
function recordMatch(match) {
  if (!match || match.id == null) return false;
  const players = Array.isArray(match.players) ? match.players : [];
  if (!players.length) return false;

  const withElo = players.map(p => ({ p, elo: finalElo(match, p) }));
  if (!withElo.some(x => x.elo != null && x.elo >= ELO_THRESHOLD)) return false;

  const id = match.id;
  const announced = loadAnnounced();
  if (announced.has(id)) return false;
  const pending = loadPending();
  if (pending.some(m => m.id === id)) return false;

  pending.push({
    id,
    date: match.date || null,
    forfeited: Boolean(match.forfeited),
    result: match.result ? { uuid: match.result.uuid, time: match.result.time } : null,
    players: withElo.map(({ p, elo }) => ({
      uuid: p.uuid,
      nickname: p.nickname,
      elo,
    })),
  });
  savePending(pending);
  return true;
}

/**
 * Owner of a match = the highest-elo player, so each match is listed exactly
 * once under one player's profile.
 */
function ownerOf(match) {
  const players = Array.isArray(match.players) ? match.players : [];
  let best = null;
  for (const p of players) {
    if (best == null || Number(p.elo || 0) > Number(best.elo || 0)) best = p;
  }
  return best;
}

/**
 * Drain pending matches that haven't been announced yet. Returns grouped
 * buckets: [{ owner, matches: [...] }] preserving arrival order.
 */
function pendingGroups() {
  const announced = loadAnnounced();
  const pending = loadPending().filter(m => !announced.has(m.id));
  const groups = new Map();
  for (const m of pending) {
    const owner = ownerOf(m);
    const key = owner?.nickname || '???';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return [...groups.entries()].map(([owner, matches]) => ({ owner, matches }));
}

function markAnnounced(ids) {
  if (!ids.length) return;
  const announced = loadAnnounced();
  for (const id of ids) announced.add(id);
  saveAnnounced(announced);
  const remaining = loadPending().filter(m => !announced.has(m.id));
  savePending(remaining);
}

module.exports = { recordMatch, pendingGroups, markAnnounced, ownerOf, ELO_THRESHOLD };
