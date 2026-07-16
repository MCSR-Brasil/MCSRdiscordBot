const { readJson, writeJson } = require('./store');

const WHITELIST_FILE = 'paceman_whitelist.json';

function normalize(name) {
  return String(name || '').trim().toLowerCase();
}

function loadWhitelist() {
  const data = readJson(WHITELIST_FILE, []);
  if (!Array.isArray(data)) return [];
  return Array.from(new Set(data.map(normalize).filter(Boolean)));
}

function saveWhitelist(list) {
  const normalized = Array.from(new Set(list.map(normalize).filter(Boolean)));
  writeJson(WHITELIST_FILE, normalized);
}

function getWhitelistSet() {
  return new Set(loadWhitelist());
}

function isWhitelisted(name) {
  return getWhitelistSet().has(normalize(name));
}

function addToWhitelist(name) {
  const normalized = normalize(name);
  if (!normalized) return false;
  const list = loadWhitelist();
  if (list.includes(normalized)) return false;
  list.push(normalized);
  saveWhitelist(list);
  return true;
}

function removeFromWhitelist(name) {
  const normalized = normalize(name);
  if (!normalized) return false;
  const list = loadWhitelist();
  const idx = list.indexOf(normalized);
  if (idx === -1) return false;
  list.splice(idx, 1);
  saveWhitelist(list);
  return true;
}

module.exports = {
  loadWhitelist,
  getWhitelistSet,
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
};
