const { readJson, writeJson } = require('./store');

const STREAMERS_FILE = 'twitch_streamers.json';

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

function getStreamers() {
  const list = readJson(STREAMERS_FILE, []);
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map(e => ({ login: normalizeLogin(e.login), discordId: e.discordId ? String(e.discordId) : null }))
    .filter(e => {
      if (!e.login || seen.has(e.login)) return false;
      seen.add(e.login);
      return true;
    });
}

function saveStreamers(streamers) {
  writeJson(STREAMERS_FILE, streamers);
}

/**
 * Add a streamer, or update its discordId if the login already exists.
 *
 * @returns {{ added: boolean, updated: boolean }}
 */
function addStreamer(login, discordId) {
  const normalized = normalizeLogin(login);
  const streamers = getStreamers();
  const existing = streamers.find(s => s.login === normalized);
  if (existing) {
    if (existing.discordId === (discordId ? String(discordId) : null)) {
      return { added: false, updated: false };
    }
    existing.discordId = discordId ? String(discordId) : null;
    saveStreamers(streamers);
    return { added: false, updated: true };
  }
  streamers.push({ login: normalized, discordId: discordId ? String(discordId) : null });
  saveStreamers(streamers);
  return { added: true, updated: false };
}

function removeStreamer(login) {
  const normalized = normalizeLogin(login);
  const streamers = getStreamers();
  const filtered = streamers.filter(s => s.login !== normalized);
  if (filtered.length === streamers.length) return false;
  saveStreamers(filtered);
  return true;
}

module.exports = { getStreamers, addStreamer, removeStreamer };
