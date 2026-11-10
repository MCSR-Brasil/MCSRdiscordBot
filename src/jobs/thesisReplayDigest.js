const logger = require('../lib/logger');
const { createIntervalJob } = require('../lib/jobs');
const { readJson, writeJson } = require('../lib/store');
const { pendingSummary, markAnnounced, ELO_THRESHOLD } = require('../lib/thesisReplays');

const CHANNEL_ID = process.env.THESIS_CHANNEL_ID || '1569482975282995330';
const STATE_FILE = 'thesis_digest_state.json';

// Hours (server local time) at which the digest fires
const DIGEST_HOURS = String(process.env.THESIS_DIGEST_HOURS || '8,20')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(Number.isFinite);

function currentSlot(now = new Date()) {
  const h = now.getHours();
  if (!DIGEST_HOURS.includes(h)) return null;
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${h}`;
}

function lastSlot() {
  return readJson(STATE_FILE, {}).lastSlot || null;
}

function saveSlot(slot) {
  writeJson(STATE_FILE, { lastSlot: slot });
}

async function runDigest(client) {
  const slot = currentSlot();
  if (!slot || slot === lastSlot()) return;
  saveSlot(slot);

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

  const { counts, dupes, ids } = pendingSummary();
  if (!ids.length) {
    logger.info('thesisReplayDigest: nothing to announce');
    return;
  }

  for (const [name, count] of counts) {
    try {
      await channel.send(`**${name}** — ${count} match${count === 1 ? '' : 'es'}`);
    } catch (e) {
      logger.error(`thesisReplayDigest: failed to send for ${name}:`, e?.message || e);
    }
  }

  if (dupes.length) {
    try {
      await channel.send(`**Dupes** (replay appears on both profiles):\n${dupes.map(d => `• ${d}`).join('\n')}`);
    } catch (e) {
      logger.error('thesisReplayDigest: failed to send dupes footer:', e?.message || e);
    }
  }

  markAnnounced(ids);
  logger.info(`thesisReplayDigest: announced ${ids.length} match(es) across ${counts.size} player(s), ${dupes.length} dupe(s)`);
}

module.exports = {
  async register({ register }) {
    const intervalMs = Number(process.env.THESIS_POLL_MS) || 60 * 1000;
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
    logger.info(`thesisReplayDigest: min elo ${ELO_THRESHOLD}, channel ${CHANNEL_ID}, hours ${DIGEST_HOURS.join('/')}`);
  },
};
