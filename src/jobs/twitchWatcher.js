const logger = require('../lib/logger');
const { createIntervalJob } = require('../lib/jobs');
const { getLiveStreams } = require('../lib/twitch');
const { readJson, writeJson } = require('../lib/store');

const STREAMERS_FILE = 'twitch_streamers.json';
const LIVE_STATE_FILE = 'twitch_live.json';

const TWITCH_EMOJI = process.env.TWITCH_EMOJI || '🔴';

/**
 * Load the tracked streamer list.
 * Sources (merged):
 *  - src/data/twitch_streamers.json: [{ "login": "subdas", "discordId": "123" }, ...]
 *  - env TWITCH_STREAMERS: "login:discordId,login2:discordId2" (discordId optional)
 *
 * @returns {Array<{ login: string, discordId: string|null }>}
 */
function loadStreamers() {
  const fromFile = readJson(STREAMERS_FILE, []);
  const list = Array.isArray(fromFile) ? fromFile : [];

  const envRaw = String(process.env.TWITCH_STREAMERS || '').trim();
  if (envRaw) {
    for (const part of envRaw.split(',')) {
      const [login, discordId] = part.split(':').map(s => s.trim());
      if (login) list.push({ login, discordId: discordId || null });
    }
  }

  const seen = new Set();
  return list
    .map(e => ({ login: String(e.login || '').toLowerCase(), discordId: e.discordId ? String(e.discordId) : null }))
    .filter(e => {
      if (!e.login || seen.has(e.login)) return false;
      seen.add(e.login);
      return true;
    });
}

function loadLiveState() {
  const state = readJson(LIVE_STATE_FILE, {});
  return state && typeof state === 'object' ? state : {};
}

function saveLiveState(state) {
  try { writeJson(LIVE_STATE_FILE, state); } catch {}
}

async function setLiveRole(guild, discordId, live) {
  if (!guild || !discordId) return;
  const roleId = process.env.TWITCH_LIVE_ROLE_ID;
  if (!roleId) return;
  try {
    const member = await guild.members.fetch(discordId);
    if (!member) return;
    const hasRole = member.roles.cache.has(roleId);
    if (live && !hasRole) {
      await member.roles.add(roleId);
      logger.info(`twitchWatcher: added live role to ${member.user?.tag || discordId}`);
    } else if (!live && hasRole) {
      await member.roles.remove(roleId);
      logger.info(`twitchWatcher: removed live role from ${member.user?.tag || discordId}`);
    }
  } catch (e) {
    logger.warn(`twitchWatcher: failed to update live role for ${discordId}: ${e?.message || e}`);
  }
}

function buildLiveMessage(stream) {
  const name = stream.user_name || stream.user_login;
  const title = stream.title || '';
  const url = `https://twitch.tv/${stream.user_login}`;
  return `${TWITCH_EMOJI} **${name} ESTÁ AO VIVO** ${TWITCH_EMOJI}\n${title}\n🔗 ${url}`;
}

async function runTwitchWatcher(client) {
  const { TWITCH_ANNOUNCE_CHANNEL_ID } = process.env;
  if (!TWITCH_ANNOUNCE_CHANNEL_ID) {
    logger.warn('twitchWatcher: missing TWITCH_ANNOUNCE_CHANNEL_ID; skipping');
    return;
  }

  const streamers = loadStreamers();
  if (!streamers.length) {
    logger.info('twitchWatcher: no streamers configured (twitch_streamers.json / TWITCH_STREAMERS)');
    return;
  }

  const channel = await client.channels
    .fetch(TWITCH_ANNOUNCE_CHANNEL_ID)
    .catch(err => {
      logger.warn(`twitchWatcher: failed to fetch channel ${TWITCH_ANNOUNCE_CHANNEL_ID}: ${err?.message || err}`);
      return null;
    });
  if (!channel || !channel.isTextBased()) {
    logger.warn(`twitchWatcher: invalid channel ${TWITCH_ANNOUNCE_CHANNEL_ID}`);
    return;
  }
  const guild = channel.guild || null;

  let liveMap;
  try {
    liveMap = await getLiveStreams(streamers.map(s => s.login));
  } catch (e) {
    logger.error('twitchWatcher: failed to fetch streams:', e?.message || e);
    return;
  }

  const state = loadLiveState();
  let changed = false;

  for (const { login, discordId } of streamers) {
    const stream = liveMap.get(login) || null;
    const prev = state[login] || null;

    if (stream) {
      const streamId = String(stream.id);
      if (!prev || prev.streamId !== streamId) {
        // Went live (or a new stream session): announce once per stream id
        try {
          await channel.send({ content: buildLiveMessage(stream) });
          logger.info(`twitchWatcher: announced ${login} live (stream ${streamId})`);
        } catch (e) {
          logger.error(`twitchWatcher: failed to announce ${login}:`, e?.message || e);
        }
      }
      await setLiveRole(guild, discordId, true);
      if (!prev || prev.streamId !== streamId) {
        state[login] = { streamId };
        changed = true;
      }
    } else if (prev) {
      // Went offline: clear state and remove the role
      delete state[login];
      changed = true;
      await setLiveRole(guild, discordId, false);
      logger.info(`twitchWatcher: ${login} went offline`);
    }
  }

  if (changed) saveLiveState(state);
}

module.exports = {
  async register({ register }) {
    const intervalMs = Number(process.env.TWITCH_POLL_MS) || 60000;
    register(
      createIntervalJob({
        name: 'twitchWatcher',
        intervalMs,
        run: runTwitchWatcher,
      })
    );
  },
};
