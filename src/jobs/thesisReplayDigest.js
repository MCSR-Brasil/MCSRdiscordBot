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

  const { ids } = pendingSummary();
  if (!ids.length) {
    saveSlot(slot);
    logger.info('thesisReplayDigest: nothing to announce');
    return;
  }

  await channel.send({
    files: [{
      attachment: Buffer.from(`${ids.join('\n')}\n`, 'utf8'),
      name: `match-ids-${slot}.txt`,
    }],
    allowedMentions: { parse: [] },
  });
  markAnnounced(ids);
  saveSlot(slot);
  logger.info(`thesisReplayDigest: announced ${ids.length} match ID(s)`);
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
