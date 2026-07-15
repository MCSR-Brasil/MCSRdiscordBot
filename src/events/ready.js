const { Events } = require('discord.js');
const logger = require('../lib/logger');
const { startAll } = require('../lib/jobs');
const { loadEarningsCache, loadProfileCache } = require('../lib/profile');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    logger.info(`Logged in as ${client.user.tag}`);
    // Load caches once at startup
    loadEarningsCache().catch(err => logger.error('Failed to load earnings cache:', err));
    loadProfileCache().catch(err => logger.error('Failed to load profile cache:', err));
    // Start background jobs (e.g., API watchers)
    startAll(client).catch(err => logger.error('Failed to start jobs:', err));
  },
};
