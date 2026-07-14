const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');
const logger = require('./logger');

const DISABLED_COMMAND_FILES = new Set(['conta.js', 'mcsrbet.js', 'ranking.js', 'slots.js', 'compare.js']);

function readCommandModules() {
  const commandsPath = path.join(__dirname, '..', 'commands');
  if (!fs.existsSync(commandsPath)) return [];
  const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js') && !DISABLED_COMMAND_FILES.has(f));
  const modules = [];
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);
    modules.push({ mod, filePath });
  }
  return modules;
}

function loadCommands(client) {
  const modules = readCommandModules();
  client.commands = new Collection();
  const commandData = [];
  for (const { mod, filePath } of modules) {
    if (mod && 'data' in mod && 'execute' in mod) {
      client.commands.set(mod.data.name, mod);
      commandData.push(mod.data.toJSON());
      logger.info(`Loaded command: ${mod.data.name}`);
    } else {
      logger.warn(`Command at ${filePath} is missing required exports { data, execute }`);
    }
  }
  return commandData;
}

function loadEvents(client) {
  const eventsPath = path.join(__dirname, '..', 'events');
  if (!fs.existsSync(eventsPath)) return;
  const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    delete require.cache[require.resolve(filePath)];
    const event = require(filePath);

    if (event.once) {
      client.once(event.name, (...args) => event.execute(client, ...args));
    } else {
      client.on(event.name, (...args) => event.execute(client, ...args));
    }
    logger.info(`Bound event: ${event.name}${event.once ? ' (once)' : ''}`);
  }
}

function getCommandData() {
  // Returns command JSON array for registration without a client
  const modules = readCommandModules();
  const data = [];
  for (const { mod, filePath } of modules) {
    if (mod && 'data' in mod && 'execute' in mod) {
      data.push(mod.data.toJSON());
    } else {
      logger.warn(`Skipping command without required exports during registration: ${filePath}`);
    }
  }
  return data;
}

module.exports = { loadCommands, loadEvents, getCommandData };
