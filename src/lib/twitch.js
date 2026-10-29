const logger = require('./logger');

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const STREAMS_URL = 'https://api.twitch.tv/helix/streams';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAppAccessToken() {
  const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env;
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    throw new Error('Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET');
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  const res = await fetch(TOKEN_URL, { method: 'POST', body: params });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Twitch token request failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

/**
 * Fetch live streams for a list of Twitch logins.
 *
 * @param {string[]} logins
 * @returns {Promise<Map<string, Object>>} map of login -> stream object (only live ones)
 */
async function getLiveStreams(logins) {
  const liveMap = new Map();
  const unique = [...new Set(logins.map(l => String(l).toLowerCase()).filter(Boolean))];
  if (!unique.length) return liveMap;

  const token = await getAppAccessToken();
  const { TWITCH_CLIENT_ID } = process.env;

  // Helix allows up to 100 user_login params per request
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const url = `${STREAMS_URL}?${chunk.map(l => `user_login=${encodeURIComponent(l)}`).join('&')}`;
    const res = await fetch(url, {
      headers: { 'Client-Id': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` },
    });

    if (res.status === 401) {
      cachedToken = null;
      tokenExpiresAt = 0;
      throw new Error('Twitch streams request unauthorized (token invalidated)');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Twitch streams request failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    for (const stream of data?.data || []) {
      liveMap.set(String(stream.user_login).toLowerCase(), stream);
    }
  }

  return liveMap;
}

module.exports = { getLiveStreams };
