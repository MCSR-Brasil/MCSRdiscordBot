require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadCommands, loadEvents } = require('./lib/loader');
const { startExternalSignupSync } = require('./lib/externalSignupSync');
const logger = require('./lib/logger');

const { TOKEN } = process.env;

if (!TOKEN) {
  logger.error('Missing TOKEN in environment. Create a .env file based on .env.example');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel],
});

// Global safety net: log instead of crashing on stray errors/rejections
process.on('unhandledRejection', error => {
  logger.error('Unhandled promise rejection:', error);
});
process.on('uncaughtException', error => {
  logger.error('Uncaught exception:', error);
});
client.on('error', error => logger.error('Discord client error:', error));
client.on('shardError', (error, shardId) => logger.error(`Shard ${shardId} error:`, error));
client.on('warn', info => logger.warn('Discord client warn:', info));

// Load commands into client and bind events
loadCommands(client);
loadEvents(client);

client.once('ready', () => {
  startExternalSignupSync();
});

client.login(TOKEN).catch(error => {
  logger.error('Login failed:', error);
  process.exit(1);
});
