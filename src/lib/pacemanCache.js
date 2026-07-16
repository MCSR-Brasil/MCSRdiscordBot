const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.resolve(process.cwd(), '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'paceman_posted.json');

function ensureCacheFile() {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, '{}', 'utf8');
  } catch (_) { /* ignore */ }
}

function loadPostedCache() {
  ensureCacheFile();
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
  } catch (_) {}
  return {};
}

function savePostedCache(cache) {
  ensureCacheFile();
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  } catch (_) { /* ignore */ }
}

module.exports = { loadPostedCache, savePostedCache };
