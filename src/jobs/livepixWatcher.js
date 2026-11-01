const { EmbedBuilder } = require('discord.js');
const logger = require('../lib/logger');
const { createIntervalJob } = require('../lib/jobs');
const { loadPostedMessagesSet, savePostedMessagesSet } = require('../lib/livepixCache');

const postedSet = loadPostedMessagesSet();
const inFlight = new Set();
let tokenCache = { accessToken: '', expiresAt: 0 };

function rememberPosted(id) {
  if (postedSet.has(id)) return;
  postedSet.add(id);
  try { savePostedMessagesSet(postedSet); } catch {}
}

function normalizeMessagesPayload(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function messageIdOf(message) {
  return String(message?.id || message?.proof || message?.reference || '');
}

function toCurrencyAmount(amount, currency = 'BRL') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  const normalized = value >= 100 ? value / 100 : value;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(normalized);
  } catch {
    return `${normalized.toFixed(2)} ${currency}`;
  }
}

 function pickDisplayName(message) {
  return message?.username || message?.name || message?.senderName || message?.from?.name || 'Anônimo';
}

function pickMessage(message) {
  return message?.message || message?.comment || message?.metadata?.message || message?.description || null;
}

function messageTimestamp(message) {
  return message?.createdAt || message?.created_at || message?.date || null;
}

function isRecentDonation(message, now = Date.now()) {
  const raw = messageTimestamp(message);
  if (raw == null || raw === '') return false;
  const numeric = Number(raw);
  const timestamp = Number.isFinite(numeric)
    ? (numeric < 1e12 ? numeric * 1000 : numeric)
    : Date.parse(raw);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= 32 * 60 * 60 * 1000;
}

function truncateText(value, max = 500) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function compactText(value, fallback = '—') {
  const text = String(value || '').trim();
  return text || fallback;
}

function buildMessageEmbed(messageData) {
  const amount = toCurrencyAmount(messageData?.amount, messageData?.currency || 'BRL');
  const name = pickDisplayName(messageData);
  const message = pickMessage(messageData);
  const ts = messageTimestamp(messageData);
  const date = ts ? new Date(ts) : null;
  const timeLabel = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(date)
    : null;
  const messageText = compactText(message, 'Sem mensagem enviada.');

  const embed = new EmbedBuilder()
    .setColor(0x58d756)
    .setAuthor({
      name: `${compactText(name).slice(0, 220)} enviou um LivePix!`,
      iconURL: 'https://img.icons8.com/fluent/512/pix.png',
    })
    .setTitle('Mensagem:')
    .setDescription(messageText.slice(0, 4096))
    .addFields(
      { name: '💰 Valor', value: amount, inline: false },
      { name: 'livepix.gg/mcsr', value: '‎', inline: false }
    )
    .setFooter({
      text: timeLabel || 'Sem horário',
      iconURL: 'https://i.imgur.com/1D4e1lY.png',
    });

  if (date && !Number.isNaN(date.getTime())) {
    embed.setTimestamp(date);
  }

  return embed;
}

async function fetchClientCredentialsToken() {
  const { LIVEPIX_CLIENT_ID, LIVEPIX_CLIENT_SECRET, LIVEPIX_OAUTH_URL, LIVEPIX_SCOPE } = process.env;
  const oauthUrl = LIVEPIX_OAUTH_URL || 'https://oauth.livepix.gg/oauth2/token';
  const scope = LIVEPIX_SCOPE || 'messages:read';

  if (!LIVEPIX_CLIENT_ID || !LIVEPIX_CLIENT_SECRET) {
    throw new Error('Missing LIVEPIX_CLIENT_ID or LIVEPIX_CLIENT_SECRET');
  }

  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 30000) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: LIVEPIX_CLIENT_ID,
    client_secret: LIVEPIX_CLIENT_SECRET,
    scope,
  });

  const res = await fetch(oauthUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errorText = truncateText(await res.text());
    throw new Error(`LivePix OAuth returned ${res.status}: ${errorText}`);
  }

  const data = await res.json();

  const accessToken = String(data?.access_token || '');
  const expiresIn = Number(data?.expires_in || 0);

  if (!accessToken) {
    throw new Error('LivePix OAuth response did not include access_token');
  }

  tokenCache = {
    accessToken,
    expiresAt: Date.now() + Math.max(0, expiresIn * 1000),
  };

  return accessToken;
}

async function fetchMessages(apiUrl, retry = true) {
  const accessToken = await fetchClientCredentialsToken();
  const res = await fetch(apiUrl, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errorText = truncateText(await res.text());
    if (res.status === 401 && retry) {
      tokenCache = { accessToken: '', expiresAt: 0 };
      logger.warn(`livepixWatcher: LivePix returned 401, retrying with a fresh token. Response: ${errorText}`);
      return fetchMessages(apiUrl, false);
    }
    throw new Error(`LivePix returned ${res.status}: ${errorText}`);
  }

  return await res.json();
}

async function runLivePixWatcher(client) {
  const { LIVEPIX_MESSAGES_API_URL, LIVEPIX_PAYMENTS_API_URL, LIVEPIX_ANNOUNCE_CHANNEL_ID, LIVEPIX_CLIENT_ID, LIVEPIX_CLIENT_SECRET } = process.env;
  const apiUrl = LIVEPIX_MESSAGES_API_URL || LIVEPIX_PAYMENTS_API_URL;

  if (!apiUrl || !LIVEPIX_CLIENT_ID || !LIVEPIX_CLIENT_SECRET || !LIVEPIX_ANNOUNCE_CHANNEL_ID) {
    logger.warn('livepixWatcher: missing LIVEPIX_MESSAGES_API_URL (or LIVEPIX_PAYMENTS_API_URL), LIVEPIX_CLIENT_ID, LIVEPIX_CLIENT_SECRET, or LIVEPIX_ANNOUNCE_CHANNEL_ID; skipping');
    return;
  }

  let data;
  try {
    data = await fetchMessages(apiUrl);
  } catch (error) {
    logger.error('livepixWatcher: fetch failed:', error);
    return;
  }

  const messages = normalizeMessagesPayload(data)
    .filter(Boolean)
    .sort((a, b) => new Date(a?.createdAt || 0).getTime() - new Date(b?.createdAt || 0).getTime());

  if (messages.length === 0) {
    logger.info('livepixWatcher: no messages returned');
    return;
  }

  const channel = await client.channels
    .fetch(LIVEPIX_ANNOUNCE_CHANNEL_ID)
    .catch(err => { logger.warn(`livepixWatcher: failed to fetch channel ${LIVEPIX_ANNOUNCE_CHANNEL_ID}: ${err?.message || err}`); return null; });

  if (!channel || !channel.isTextBased()) {
    logger.warn(`livepixWatcher: invalid channel ${LIVEPIX_ANNOUNCE_CHANNEL_ID}`);
    return;
  }

  let posted = 0;
  let skippedDup = 0;

  for (const messageData of messages) {
    const id = messageIdOf(messageData);
    if (!id) continue;
    if (!isRecentDonation(messageData)) continue;
    if (postedSet.has(id) || inFlight.has(id)) {
      skippedDup++;
      continue;
    }

    inFlight.add(id);
    try {
      const embed = buildMessageEmbed(messageData);
      await channel.send({ embeds: [embed] });
      rememberPosted(id);
      posted++;
    } catch (error) {
      logger.error(`livepixWatcher: failed to send message ${id}:`, error);
    } finally {
      inFlight.delete(id);
    }
  }

  logger.info(`livepixWatcher: done. received=${messages.length} posted=${posted} skippedDup=${skippedDup}`);
}

module.exports = {
  async register({ register }) {
    const intervalMs = Number(process.env.LIVEPIX_POLL_MS) || 10 * 60 * 1000;
    register(
      createIntervalJob({
        name: 'livepixWatcher',
        intervalMs,
        run: runLivePixWatcher,
      })
    );
  },
};
