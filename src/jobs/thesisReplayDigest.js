const logger = require('../lib/logger');
const { createIntervalJob } = require('../lib/jobs');
const { pendingGroups, markAnnounced, ownerOf, ELO_THRESHOLD } = require('../lib/thesisReplays');

const CHANNEL_ID = process.env.THESIS_CHANNEL_ID || '1569482975282995330';

function formatTime(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v)) return '—';
  const totalSec = Math.floor(v / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function matchLine(match) {
  const owner = ownerOf(match);
  const other = (match.players || []).find(p => p !== owner && p.uuid !== owner?.uuid) || {};
  const ownerName = owner?.nickname || '???';
  const otherName = other.nickname || '???';
  const outcome = match.forfeited ? `Forfeit (${formatTime(match.result?.time)})` : formatTime(match.result?.time);
  return `${ownerName} vs ${otherName} — ${outcome}`;
}

async function runDigest(client) {
  const channel = await client.channels
    .fetch(CHANNEL_ID)
    .catch(err => {
      logger.warn(`thesisReplayDigest: failed to fetch channel ${CHANNEL_ID}: ${err?.message || err}`);
      return null;
    });
  if (!channel || !channel.isTextBased()) {
    logger.warn(`thesisReplayDigest: invalid channel ${CHANNEL_ID}`);
    return;
  }

  const groups = pendingGroups();
  if (!groups.length) {
    logger.info('thesisReplayDigest: nothing to announce');
    return;
  }

  const sentIds = [];
  for (const { owner, matches } of groups) {
    try {
      await channel.send(`**${owner}**`);
    } catch (e) {
      logger.error(`thesisReplayDigest: failed to send header for ${owner}:`, e?.message || e);
      continue;
    }
    for (const match of matches) {
      try {
        await channel.send(matchLine(match));
        sentIds.push(match.id);
      } catch (e) {
        logger.error(`thesisReplayDigest: failed to send match ${match.id}:`, e?.message || e);
      }
    }
  }

  markAnnounced(sentIds);
  logger.info(`thesisReplayDigest: announced ${sentIds.length} match(es) across ${groups.length} player(s)`);
}

module.exports = {
  async register({ register }) {
    const intervalMs = Number(process.env.THESIS_POLL_MS) || 60 * 60 * 1000;
    let running = false;
    register(
      createIntervalJob({
        name: 'thesisReplayDigest',
        intervalMs,
        async run(client) {
          if (running) return;
          running = true;
          try {
            await runDigest(client);
          } finally {
            running = false;
          }
        },
      })
    );
    logger.info(`thesisReplayDigest: min elo ${ELO_THRESHOLD}, channel ${CHANNEL_ID}`);
  },
};
