const { EmbedBuilder } = require('discord.js');
const logger = require('../lib/logger');
const { createIntervalJob } = require('../lib/jobs');
const { loadPostedCache, savePostedCache } = require('../lib/pacemanCache');
const { getWhitelistSet } = require('../lib/pacemanWhitelist');
const { getPendingPings, markTierIndexesPinged } = require('../lib/pacemanPingSystem');

const PACEMAN_API_URL = process.env.PACEMAN_API_URL || 'https://paceman.gg/api/ars/liveruns';
const PACEMAN_GAME_VERSION = process.env.PACEMAN_GAME_VERSION || '1.16.1';
const PACEMAN_POLL_MS = Number(process.env.PACEMAN_POLL_MS) || 15000;
const PACEMAN_CHANNEL_ID = process.env.PACEMAN_CHANNEL_ID;

const TWITCH_EMOJI = process.env.TWITCH_EMOJI || '📺';
const OFFLINE_EMOJI = process.env.OFFLINE_EMOJI || ':no_mobile_phones:';
const CLOCK_EMOJI = process.env.CLOCK_EMOJI || '🕒';
const DEFAULT_COLOR = Number(process.env.PACEMAN_EMBED_COLOR) || 0x9146ff;
const FOOTER_ICON_URL = process.env.PACEMAN_FOOTER_ICON || 'https://cdn-icons-png.flaticon.com/512/6214/6214151.png';

// Good-enough run thresholds that bypass the whitelist
const GOOD_ENOUGH_STRONGHOLD_MS = 6 * 60 * 1000;
const GOOD_ENOUGH_END_MS = (6 * 60 + 30) * 1000;
const GOOD_ENOUGH_CREDITS_MS = 8 * 60 * 1000;

const SPLIT_EMOJIS = {
  'rsg.enter_bastion': 'BASTION_EMOJI',
  'rsg.enter_fortress': 'FORTRESS_EMOJI',
  'rsg.first_portal': 'PORTAL_EMOJI',
  'rsg.enter_stronghold': 'STRONGHOLD_EMOJI',
  'rsg.enter_end': 'END_EMOJI',
  'rsg.credits': 'CREDITS_EMOJI',
  'rsg.finish': 'TROPHY_EMOJI',
};

function splitEmoji(eventId) {
  const key = SPLIT_EMOJIS[eventId];
  if (key) {
    const specific = process.env[key];
    if (specific) return specific;
    if (eventId === 'rsg.credits') {
      return process.env.TROPHY_EMOJI || process.env.LOGO_EMOJI || '⏱️';
    }
  }
  return process.env.LOGO_EMOJI || '⏱️';
}

const EVENT_NAMES = {
  'rsg.enter_nether': 'Enter Nether',
  'rsg.enter_bastion': 'Enter Bastion',
  'rsg.enter_fortress': 'Enter Fortress',
  'rsg.first_portal': 'First Portal',
  'rsg.enter_stronghold': 'Enter Stronghold',
  'rsg.enter_end': 'Enter End',
  'rsg.credits': 'Credits',
  'rsg.finish': 'Finish',
};

const SPLIT_IMAGE_URLS = {
  'rsg.enter_bastion': 'https://camo.githubusercontent.com/60ef3405c959c222e9d3f156db9982657a0ebddbcf833885133c00be100d5744/68747470733a2f2f62617374696f6e6d632e6769746875622e696f2f6769746875622f6173736574732f70726f66696c652f6f7267616e69736174696f6e5f6c6f676f2e706e67',
  'rsg.enter_fortress': 'https://minecraft.wiki/images/MCD_Blaze_Spawner.png?41dd4',
  'rsg.first_portal': 'https://static.wikia.nocookie.net/minecraft_gamepedia/images/0/03/Nether_portal_%28animated%29.png/revision/latest?cb=20191114182303',
  'rsg.enter_stronghold': 'https://minecraft.wiki/images/thumb/Stronghold_straight_corridor.png/200px-Stronghold_straight_corridor.png?c3a4f',
  'rsg.enter_end': 'https://minecraft.wiki/images/End_Stone_JE3_BE2.png?8f71b',
  'rsg.credits': 'https://minecraft.wiki/images/thumb/EnderDragonPortal.png/250px-EnderDragonPortal.png?43ecb',
  'rsg.finish': 'https://minecraft.wiki/images/thumb/EnderDragonPortal.png/250px-EnderDragonPortal.png?43ecb',
};

const SPLIT_COLORS = {
  'rsg.enter_bastion': 0xd3d3d3,
  'rsg.enter_fortress': 0xc0392b,
  'rsg.first_portal': 0x8e44ad,
  'rsg.enter_stronghold': 0x556b2f,
  'rsg.enter_end': 0xf1c40f,
  'rsg.credits': 0x85c1e9,
  'rsg.finish': 0x85c1e9,
};

function splitColor(eventId) {
  const envKey = `PACEMAN_COLOR_${eventId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const envVal = process.env[envKey];
  if (envVal && !Number.isNaN(Number(envVal))) return Number(envVal);
  return SPLIT_COLORS[eventId] || DEFAULT_COLOR;
}

let postedCache = loadPostedCache();
const inFlight = new Set();

function normalize(name) {
  return String(name || '').trim().toLowerCase();
}

function headUrl(uuid) {
  if (!uuid) return null;
  return `https://mc-heads.net/head/${String(uuid).replace(/-/g, '')}`;
}

function formatMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function splitName(eventId) {
  return EVENT_NAMES[eventId] || eventId;
}

function splitTimeMs(e) {
  if (Number.isFinite(e.igt)) return e.igt;
  if (Number.isFinite(e.rta)) return e.rta;
  return undefined;
}

function sortTime(e) {
  return Number(e.rta ?? e.igt ?? 0);
}

function isRunGoodEnough(events) {
  for (const e of events) {
    const igt = Number(e.igt);
    if (!Number.isFinite(igt)) continue;
    if (e.eventId === 'rsg.enter_stronghold' && igt < GOOD_ENOUGH_STRONGHOLD_MS) return true;
    if (e.eventId === 'rsg.enter_end' && igt < GOOD_ENOUGH_END_MS) return true;
    if ((e.eventId === 'rsg.credits' || e.eventId === 'rsg.finish') && igt < GOOD_ENOUGH_CREDITS_MS) return true;
  }
  return false;
}

function pastSplitsFooter(run, currentEvent) {
  const events = Array.isArray(run.eventList) ? run.eventList.slice() : [];
  events.sort((a, b) => sortTime(a) - sortTime(b));
  const currentTime = sortTime(currentEvent);
  const past = events.filter(e =>
    e.eventId !== currentEvent.eventId &&
    EVENT_NAMES[e.eventId] &&
    sortTime(e) <= currentTime
  );
  if (past.length === 0) return null;
  past.reverse();
  return past
    .slice(0, 2)
    .map(e => `${splitName(e.eventId)}: ${formatMs(splitTimeMs(e))}`)
    .join(' | ');
}

function splitImageUrl(eventId, run) {
  if (SPLIT_IMAGE_URLS[eventId]) return SPLIT_IMAGE_URLS[eventId];
  const envKey = `PACEMAN_IMAGE_${eventId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return process.env[envKey] || headUrl(run.user?.uuid);
}

function twitchLine(user) {
  const login = user?.liveAccount || user?.twitch;
  if (!login) return `${OFFLINE_EMOJI} Offline`;
  const url = `https://twitch.tv/${normalize(login)}`;
  return `[${TWITCH_EMOJI} twitch.tv/${normalize(login)}](${url})`;
}

function padName(name, length = 22) {
  const chars = Array.from(String(name || 'Unknown'));
  if (chars.length > length) return chars.slice(0, length).join('');
  return chars.join('').padEnd(length, '\u2800');
}

function buildSplitEmbed(run, event) {
  const nickname = run.nickname || 'Unknown';
  const splitLabel = splitName(event.eventId);

  const embed = new EmbedBuilder()
    .setColor(splitColor(event.eventId))
    .setAuthor({ name: padName(nickname), iconURL: headUrl(run.user?.uuid) })
    .setThumbnail(splitImageUrl(event.eventId, run));

  const lines = [
    `**${splitEmoji(event.eventId)}  ${splitLabel}**`,
    `**${CLOCK_EMOJI}  ${formatMs(event.igt)}**`,
    twitchLine(run.user),
  ];
  embed.setDescription(lines.join('\n'));

  const footerText = pastSplitsFooter(run, event);
  if (footerText) embed.setFooter({ text: footerText, iconURL: FOOTER_ICON_URL });

  return embed;
}

function getRunCache(worldId) {
  if (!postedCache[worldId]) {
    postedCache[worldId] = { postedEventIds: [], nickname: null, lastUpdated: 0 };
  }
  return postedCache[worldId];
}

function markPosted(worldId, eventId, nickname) {
  const entry = getRunCache(worldId);
  if (!entry.postedEventIds.includes(eventId)) {
    entry.postedEventIds.push(eventId);
  }
  entry.nickname = nickname || entry.nickname;
  entry.lastUpdated = Date.now();
}

function hasPosted(worldId, eventId) {
  return getRunCache(worldId).postedEventIds.includes(eventId);
}

function relevantEvents(eventList) {
  const events = Array.isArray(eventList) ? eventList.slice() : [];
  events.sort((a, b) => Number(a.rta || 0) - Number(b.rta || 0));
  const bastionIndex = events.findIndex(e => e.eventId === 'rsg.enter_bastion');
  if (bastionIndex === -1) return [];
  return events.slice(bastionIndex);
}

async function fetchPacemanRuns() {
  const url = new URL(PACEMAN_API_URL);
  url.searchParams.set('gameVersion', PACEMAN_GAME_VERSION);
  url.searchParams.set('liveOnly', 'false');
  logger.info(`pacemanWatcher: fetching ${url.toString()}`);
  const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Paceman API returned ${res.status}`);
  }
  return res.json();
}

async function runPacemanWatcher(client) {
  if (!PACEMAN_CHANNEL_ID) {
    logger.warn('pacemanWatcher: missing PACEMAN_CHANNEL_ID; skipping');
    return;
  }

  const whitelist = getWhitelistSet();
  if (whitelist.size === 0) {
    logger.info('pacemanWatcher: whitelist is empty; skipping');
    return;
  }

  let data;
  try {
    data = await fetchPacemanRuns();
  } catch (e) {
    logger.error('pacemanWatcher: fetch failed:', e);
    return;
  }

  const runs = Array.isArray(data) ? data : [];
  if (runs.length === 0) {
    logger.info('pacemanWatcher: no runs returned');
    return;
  }

  const channel = await client.channels
    .fetch(PACEMAN_CHANNEL_ID)
    .catch(err => { logger.warn(`pacemanWatcher: failed to fetch channel ${PACEMAN_CHANNEL_ID}: ${err?.message || err}`); return null; });
  if (!channel || !channel.isTextBased()) {
    logger.warn(`pacemanWatcher: invalid channel ${PACEMAN_CHANNEL_ID}`);
    return;
  }

  let considered = 0;
  let skipped = 0;
  let posted = 0;

  for (const run of runs) {
    const nickname = run.nickname;
    const events = relevantEvents(run.eventList);
    const whitelisted = nickname && whitelist.has(normalize(nickname));
    const goodEnough = isRunGoodEnough(events);
    if (!whitelisted && !goodEnough) continue;
    if (events.length === 0) {
      skipped++;
      continue;
    }
    considered++;

    const worldId = run.worldId;
    if (!worldId) continue;

    const entry = getRunCache(worldId);
    const isFirstEncounter = entry.postedEventIds.length === 0;
    const unpostedEvents = events.filter(e => !hasPosted(worldId, e.eventId));
    if (unpostedEvents.length === 0) continue;

    if (isFirstEncounter) {
      // On first encounter post only the latest split and mark all current events as seen to avoid spamming old splits on startup
      const latest = unpostedEvents[unpostedEvents.length - 1];
      const eventId = latest.eventId;
      const key = `${worldId}:${eventId}`;
      if (inFlight.has(key)) continue;
      inFlight.add(key);
      try {
        const embed = buildSplitEmbed(run, latest);
        const eventsForPings = isFirstEncounter ? [latest] : unpostedEvents;
        const { content, tierIndexes } = getPendingPings(worldId, eventsForPings);
        const sendOptions = { embeds: [embed] };
        if (content) sendOptions.content = content;
        await channel.send(sendOptions);
        if (tierIndexes.length > 0) markTierIndexesPinged(worldId, tierIndexes);
        for (const e of unpostedEvents) markPosted(worldId, e.eventId, nickname);
        try { savePostedCache(postedCache); } catch {}
        posted++;
      } catch (e) {
        logger.error(`pacemanWatcher: failed to send embed for ${key}:`, e);
      } finally {
        inFlight.delete(key);
      }
    } else {
      // If multiple new splits appear between polls, post only the newest one
      const latest = unpostedEvents[unpostedEvents.length - 1];
      const eventId = latest.eventId;
      const key = `${worldId}:${eventId}`;
      if (inFlight.has(key)) continue;
      inFlight.add(key);
      try {
        const embed = buildSplitEmbed(run, latest);
        const { content, tierIndexes } = getPendingPings(worldId, unpostedEvents);
        const sendOptions = { embeds: [embed] };
        if (content) sendOptions.content = content;
        await channel.send(sendOptions);
        if (tierIndexes.length > 0) markTierIndexesPinged(worldId, tierIndexes);
        for (const e of unpostedEvents) markPosted(worldId, e.eventId, nickname);
        try { savePostedCache(postedCache); } catch {}
        posted++;
      } catch (err) {
        logger.error(`pacemanWatcher: failed to send embed for ${key}:`, err);
      } finally {
        inFlight.delete(key);
      }
    }
  }

  logger.info(`pacemanWatcher: done. considered=${considered} skipped=${skipped} posted=${posted}`);
}

module.exports = {
  async register({ register }) {
    register(
      createIntervalJob({
        name: 'pacemanWatcher',
        intervalMs: PACEMAN_POLL_MS,
        run: runPacemanWatcher,
      })
    );
  },
};
