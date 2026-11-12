const { readJson, writeJson } = require('./store');

const PENDING_FILE = 'thesis_pending.json';
const ANNOUNCED_FILE = 'thesis_announced.json';

const ELO_THRESHOLD = Number(process.env.THESIS_MIN_ELO) || 1850;

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
 * Summarize pending (not yet announced) matches for the digest.
 *
 * Each match counts once per qualifying player (elo >= threshold at match end).
 * A match counted under two players is a "dupe" — the replay shows up on both
 * profiles, so the digest lists those at the bottom to avoid double downloads.
 *
 * @returns {{ counts: Map<string, number>, dupes: string[], ids: any[] }}
 */
function pendingSummary() {
  const announced = loadAnnounced();
  const pending = loadPending().filter(m => !announced.has(m.id));
  const counts = new Map();
  const dupes = [];
  const ids = [];

  for (const m of pending) {
    ids.push(m.id);
    const players = Array.isArray(m.players) ? m.players : [];
    const qualifying = players.filter(p => Number(p.elo) >= ELO_THRESHOLD);
    for (const p of qualifying) {
      const name = p.nickname || '???';
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    if (qualifying.length > 1) {
      dupes.push(qualifying.map(p => p.nickname || '???').join(' vs '));
    }
  }

  return { counts, dupes, ids };
}

function markAnnounced(ids) {
  if (!ids.length) return;
  const announced = loadAnnounced();
  for (const id of ids) announced.add(id);
  saveAnnounced(announced);
  const remaining = loadPending().filter(m => !announced.has(m.id));
  savePending(remaining);
}

module.exports = { recordMatch, pendingSummary, markAnnounced, ELO_THRESHOLD };
