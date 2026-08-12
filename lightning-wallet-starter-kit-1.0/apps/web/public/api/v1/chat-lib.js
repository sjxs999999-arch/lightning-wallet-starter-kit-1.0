import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { verifyMessage } from 'ethers';

const CHAINS = new Set(['EVM', 'SOL']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const CHAT_ISSUER = 'lightingwallet.com';
const CHAT_AUDIENCE = 'lightning-chat';

const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const keyBytes = value => typeof value === 'string' && BASE64.test(value) && Buffer.from(value, 'base64').length === 32;
const addressValid = (chain, value) => {
  if (chain === 'EVM') return /^0x[0-9a-fA-F]{40}$/.test(value);
  if (chain !== 'SOL' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try { return bs58.decode(value).length === 32; }
  catch { return false; }
};
const normalizeAddress = (chain, value) => chain === 'EVM' ? value.toLowerCase() : value;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function chatSecret() {
  const configured = process.env.CHAT_JWT_SECRET;
  if (configured && configured.length >= 32) return Buffer.from(configured);
  const operator = process.env.JWT_SECRET ?? '';
  if (operator.length < 32) throw new Error('CHAT_SECRET_NOT_CONFIGURED');
  return createHmac('sha256', operator).update('lightning-chat-jwt-domain-v1').digest();
}

function issueChatToken(claims, expiresIn = 900) {
  const now = Math.floor(Date.now() / 1000), header = encode({ alg: 'HS256', typ: 'JWT' }), payload = encode({ ...claims, iss: CHAT_ISSUER, aud: CHAT_AUDIENCE, scope: 'chat:relay', iat: now, exp: now + expiresIn, jti: randomBytes(16).toString('hex') });
  const signature = createHmac('sha256', chatSecret()).update(`${header}.${payload}`).digest('base64url');
  return { token: `${header}.${payload}.${signature}`, expiresAt: new Date((now + expiresIn) * 1000).toISOString() };
}

function chatClaims(token) {
  try {
    const [header, payload, signature, extra] = token.split('.');
    if (extra !== undefined || !header || !payload || !signature) return null;
    const metadata = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if (metadata.alg !== 'HS256' || metadata.typ !== 'JWT') return null;
    const expected = createHmac('sha256', chatSecret()).update(`${header}.${payload}`).digest(), actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.iss !== CHAT_ISSUER || claims.aud !== CHAT_AUDIENCE || claims.scope !== 'chat:relay' || !CHAINS.has(claims.chain) || !addressValid(claims.chain, claims.address) || !UUID.test(claims.deviceId) || !keyBytes(claims.devicePublicKey) || Number(claims.exp) <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}

function challengeInput(input) {
  if (!onlyKeys(input, ['chain', 'address', 'deviceId', 'devicePublicKey']) || !CHAINS.has(input.chain) || !addressValid(input.chain, input.address) || !UUID.test(input.deviceId) || !keyBytes(input.devicePublicKey)) return null;
  return { chain: input.chain, address: normalizeAddress(input.chain, input.address), deviceId: input.deviceId, devicePublicKey: input.devicePublicKey };
}

function canonicalChallenge(input, nonce, issuedAt, expiresAt) {
  return [
    'Lightning Wallet Chat Authentication',
    'Domain: lightingwallet.com',
    'URI: https://lightingwallet.com/chat',
    'Purpose: chat-device-bind',
    `Chain: ${input.chain}`,
    `Address: ${input.address}`,
    `Device ID: ${input.deviceId}`,
    `Device key: ${input.devicePublicKey}`,
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt}`,
    `Expiration time: ${expiresAt}`,
    'This request does not authorize a transaction or token approval.',
  ].join('\n');
}

function verifyChallengeSignature(row, signature) {
  if (typeof signature !== 'string' || signature.length < 40 || signature.length > 400) return false;
  if (row.chain === 'EVM') {
    try { return verifyMessage(row.message, signature).toLowerCase() === row.address.toLowerCase(); }
    catch { return false; }
  }
  try { return ed25519.verify(Buffer.from(signature, 'base64'), new TextEncoder().encode(row.message), bs58.decode(row.address)); }
  catch { return false; }
}

function envelopeInput(input) {
  const allowed = ['version', 'messageId', 'conversationId', 'senderDeviceId', 'recipientDeviceId', 'timestamp', 'salt', 'iv', 'ciphertext'];
  if (!onlyKeys(input, allowed) || input.version !== 1 || !UUID.test(input.messageId) || !UUID.test(input.conversationId) || !UUID.test(input.senderDeviceId) || !UUID.test(input.recipientDeviceId) || typeof input.timestamp !== 'string' || !Number.isFinite(Date.parse(input.timestamp)) || Math.abs(Date.now() - Date.parse(input.timestamp)) > 31 * 86400_000 || typeof input.salt !== 'string' || !BASE64.test(input.salt) || Buffer.from(input.salt, 'base64').length !== 16 || typeof input.iv !== 'string' || !BASE64.test(input.iv) || Buffer.from(input.iv, 'base64').length !== 12 || typeof input.ciphertext !== 'string' || !BASE64.test(input.ciphertext) || Buffer.from(input.ciphertext, 'base64').length < 17 || Buffer.from(input.ciphertext, 'base64').length > 64 * 1024) return null;
  return Object.fromEntries(allowed.map(key => [key, input[key]]));
}

function bearer(req) { return String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''); }
function queryUrl(req) { return new URL(req.url, 'https://lightingwallet.com'); }
function publicDevice(row) { return { deviceId: row.device_id, chain: row.chain, address: row.address, publicKey: row.public_key, updatedAt: new Date(row.updated_at).toISOString(), ...(row.revoked_at ? { revokedAt: new Date(row.revoked_at).toISOString() } : {}) }; }

async function requireChat(req, res, send) {
  const claims = chatClaims(bearer(req));
  if (!claims) { send(res, 401, { error: 'CHAT_UNAUTHORIZED', message: '聊天身份会话无效或已过期' }); return null; }
  return claims;
}

async function consumeRateLimit(query, bucket, maximum, minutes = 1) {
  const key = createHash('sha256').update(`chat:${bucket}`).digest('hex');
  const rows = await query("INSERT INTO auth_rate_limits(bucket,attempts,reset_at) VALUES($1,1,now()+($2 * interval '1 minute')) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.reset_at<now() THEN 1 ELSE auth_rate_limits.attempts+1 END,reset_at=CASE WHEN auth_rate_limits.reset_at<now() THEN now()+($2 * interval '1 minute') ELSE auth_rate_limits.reset_at END,updated_at=now() RETURNING attempts", [key, minutes]);
  return Number(rows[0]?.attempts ?? 0) <= maximum;
}

export async function handleChatRequest({ req, res, route, method, bodyOf, query, send }) {
  if (method === 'POST' && route === 'chat/auth/challenge') {
    const input = challengeInput(bodyOf(req));
    if (!input) return send(res, 400, { error: 'INVALID_CHAT_CHALLENGE' });
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (!await consumeRateLimit(query, `challenge:${forwarded || 'unknown'}`, 30, 15)) return send(res, 429, { error: 'CHAT_RATE_LIMITED' });
    await Promise.all([query("DELETE FROM chat_challenges WHERE id IN (SELECT id FROM chat_challenges WHERE expires_at<now()-interval '1 day' LIMIT 500)"), query('DELETE FROM chat_envelopes WHERE id IN (SELECT id FROM chat_envelopes WHERE expires_at<now() LIMIT 500)')]);
    const challengeId = randomUUID(), nonce = randomBytes(24).toString('base64url'), issuedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 5 * 60_000).toISOString(), message = canonicalChallenge(input, nonce, issuedAt, expiresAt);
    await query('INSERT INTO chat_challenges(id,chain,address,device_id,device_public_key,message,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [challengeId, input.chain, input.address, input.deviceId, input.devicePublicKey, message, expiresAt]);
    return send(res, 200, { data: { challengeId, challenge: { domain: CHAT_ISSUER, uri: 'https://lightingwallet.com/chat', purpose: 'chat-device-bind', nonce, issuedAt, expiresAt }, message, expiresAt } });
  }

  if (method === 'POST' && route === 'chat/auth/verify') {
    const input = bodyOf(req);
    if (!onlyKeys(input, ['challengeId', 'signature']) || !UUID.test(input.challengeId) || typeof input.signature !== 'string') return send(res, 400, { error: 'INVALID_CHAT_VERIFICATION' });
    const rows = await query('UPDATE chat_challenges SET used_at=now() WHERE id=$1 AND used_at IS NULL AND expires_at>now() RETURNING chain,address,device_id,device_public_key,message', [input.challengeId]), row = rows[0];
    if (!row) return send(res, 409, { error: 'CHAT_CHALLENGE_EXPIRED_OR_USED' });
    if (!verifyChallengeSignature(row, input.signature)) return send(res, 401, { error: 'CHAT_SIGNATURE_INVALID' });
    const session = issueChatToken({ sub: `lw:${row.chain}:${row.address}`, chain: row.chain, address: row.address, deviceId: row.device_id, devicePublicKey: row.device_public_key });
    return send(res, 200, { data: { ...session, address: row.address, chain: row.chain, deviceId: row.device_id } });
  }

  if (method === 'GET' && route === 'chat/devices') {
    const url = queryUrl(req), chain = String(url.searchParams.get('chain') ?? ''), rawAddress = String(url.searchParams.get('address') ?? '');
    if (!CHAINS.has(chain) || !addressValid(chain, rawAddress)) return send(res, 400, { error: 'INVALID_CHAT_IDENTITY' });
    const rows = await query('SELECT device_id,chain,address,public_key,updated_at,revoked_at FROM chat_devices WHERE chain=$1 AND address=$2 AND revoked_at IS NULL ORDER BY updated_at DESC LIMIT 20', [chain, normalizeAddress(chain, rawAddress)]);
    return send(res, 200, { data: rows.map(publicDevice) });
  }

  const claims = await requireChat(req, res, send);
  if (!claims) return;

  const deviceMatch = route.match(/^chat\/devices\/([0-9a-f-]+)$/i);
  if (method === 'PUT' && deviceMatch) {
    const deviceId = deviceMatch[1], input = bodyOf(req);
    if (deviceId !== claims.deviceId || !onlyKeys(input, ['chain', 'address', 'publicKey']) || input.chain !== claims.chain || normalizeAddress(input.chain, input.address) !== claims.address || input.publicKey !== claims.devicePublicKey) return send(res, 403, { error: 'CHAT_DEVICE_BINDING_MISMATCH' });
    if (!await consumeRateLimit(query, `device-register:${claims.deviceId}`, 20)) return send(res, 429, { error: 'CHAT_RATE_LIMITED' });
    const rows = await query("INSERT INTO chat_devices(device_id,chain,address,public_key,updated_at,revoked_at) VALUES($1,$2,$3,$4,now(),NULL) ON CONFLICT(device_id) DO UPDATE SET chain=EXCLUDED.chain,address=EXCLUDED.address,public_key=EXCLUDED.public_key,updated_at=now(),revoked_at=NULL WHERE chat_devices.chain=EXCLUDED.chain AND chat_devices.address=EXCLUDED.address AND (chat_devices.revoked_at IS NULL OR chat_devices.revoked_at<to_timestamp($5)) RETURNING device_id,chain,address,public_key,updated_at,revoked_at", [deviceId, claims.chain, claims.address, claims.devicePublicKey, Number(claims.iat)]);
    return rows[0] ? send(res, 200, { data: publicDevice(rows[0]) }) : send(res, 409, { error: 'CHAT_DEVICE_ALREADY_BOUND' });
  }

  const activeDevice = (await query('SELECT device_id FROM chat_devices WHERE device_id=$1 AND chain=$2 AND address=$3 AND public_key=$4 AND revoked_at IS NULL', [claims.deviceId, claims.chain, claims.address, claims.devicePublicKey]))[0];
  if (!activeDevice) return send(res, 401, { error: 'CHAT_DEVICE_REVOKED' });
  if (method === 'DELETE' && deviceMatch) {
    if (deviceMatch[1] !== claims.deviceId) return send(res, 403, { error: 'CHAT_DEVICE_SCOPE_MISMATCH' });
    const rows = await query('UPDATE chat_devices SET revoked_at=now(),updated_at=now() WHERE device_id=$1 AND chain=$2 AND address=$3 AND revoked_at IS NULL RETURNING device_id', [claims.deviceId, claims.chain, claims.address]);
    return send(res, 200, { data: { revoked: Boolean(rows[0]) } });
  }

  if (method === 'POST' && route === 'chat/messages') {
    const envelope = envelopeInput(bodyOf(req));
    if (!envelope || envelope.senderDeviceId !== claims.deviceId) return send(res, 400, { error: 'INVALID_CHAT_ENVELOPE' });
    if (!await consumeRateLimit(query, `message-send:${claims.deviceId}`, 120)) return send(res, 429, { error: 'CHAT_RATE_LIMITED' });
    const [sender, recipient] = await Promise.all([query('SELECT device_id FROM chat_devices WHERE device_id=$1 AND chain=$2 AND address=$3 AND public_key=$4 AND revoked_at IS NULL', [claims.deviceId, claims.chain, claims.address, claims.devicePublicKey]), query('SELECT device_id FROM chat_devices WHERE device_id=$1 AND revoked_at IS NULL', [envelope.recipientDeviceId])]);
    if (!sender[0]) return send(res, 403, { error: 'CHAT_DEVICE_REVOKED' });
    if (!recipient[0]) return send(res, 404, { error: 'CHAT_RECIPIENT_UNAVAILABLE' });
    const inserted = await query("INSERT INTO chat_envelopes(message_id,conversation_id,version,sender_device_id,recipient_device_id,client_timestamp,salt,iv,ciphertext,expires_at) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,now()+interval '30 days') ON CONFLICT(message_id) DO NOTHING RETURNING message_id,created_at", [envelope.messageId, envelope.conversationId, envelope.senderDeviceId, envelope.recipientDeviceId, envelope.timestamp, envelope.salt, envelope.iv, envelope.ciphertext]);
    if (!inserted[0]) {
      const existing = (await query('SELECT conversation_id,sender_device_id,recipient_device_id,client_timestamp,salt,iv,ciphertext FROM chat_envelopes WHERE message_id=$1', [envelope.messageId]))[0];
      if (!existing || existing.conversation_id !== envelope.conversationId || existing.sender_device_id !== claims.deviceId || existing.recipient_device_id !== envelope.recipientDeviceId || new Date(existing.client_timestamp).toISOString() !== new Date(envelope.timestamp).toISOString() || existing.salt !== envelope.salt || existing.iv !== envelope.iv || existing.ciphertext !== envelope.ciphertext) return send(res, 409, { error: 'CHAT_MESSAGE_ID_CONFLICT' });
    }
    return send(res, 202, { data: { messageId: envelope.messageId, acceptedAt: inserted[0]?.created_at ? new Date(inserted[0].created_at).toISOString() : new Date().toISOString(), duplicate: !inserted[0] } });
  }

  if (method === 'GET' && route === 'chat/messages') {
    const url = queryUrl(req), deviceId = String(url.searchParams.get('deviceId') ?? ''), cursor = String(url.searchParams.get('cursor') ?? '0'), limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
    if (deviceId !== claims.deviceId || !/^\d{1,20}$/.test(cursor)) return send(res, 403, { error: 'CHAT_INBOX_SCOPE_MISMATCH' });
    if (!await consumeRateLimit(query, `message-poll:${claims.deviceId}`, 300)) return send(res, 429, { error: 'CHAT_RATE_LIMITED' });
    const rows = await query('SELECT e.id,e.message_id,e.conversation_id,e.version,e.sender_device_id,e.recipient_device_id,e.client_timestamp,e.salt,e.iv,e.ciphertext,e.created_at,d.chain,d.address,d.public_key,d.updated_at,d.revoked_at FROM chat_envelopes e JOIN chat_devices d ON d.device_id=e.sender_device_id WHERE e.recipient_device_id=$1 AND e.id>$2 AND e.ack_at IS NULL AND e.expires_at>now() ORDER BY e.id ASC LIMIT $3', [deviceId, cursor, limit]);
    const items = rows.map(row => ({ version: Number(row.version), messageId: row.message_id, conversationId: row.conversation_id, senderDeviceId: row.sender_device_id, recipientDeviceId: row.recipient_device_id, timestamp: new Date(row.client_timestamp).toISOString(), salt: row.salt, iv: row.iv, ciphertext: row.ciphertext, receivedAt: new Date(row.created_at).toISOString(), sender: publicDevice({ device_id: row.sender_device_id, chain: row.chain, address: row.address, public_key: row.public_key, updated_at: row.updated_at, revoked_at: row.revoked_at }) }));
    return send(res, 200, { data: { items, cursor: rows.length ? String(rows.at(-1).id) : cursor } });
  }

  if (method === 'POST' && route === 'chat/messages/ack') {
    const input = bodyOf(req);
    if (!onlyKeys(input, ['deviceId', 'messageIds']) || input.deviceId !== claims.deviceId || !Array.isArray(input.messageIds) || input.messageIds.length < 1 || input.messageIds.length > 100 || input.messageIds.some(id => !UUID.test(id))) return send(res, 400, { error: 'INVALID_CHAT_ACK' });
    const rows = await query('UPDATE chat_envelopes SET ack_at=COALESCE(ack_at,now()) WHERE recipient_device_id=$1 AND message_id=ANY($2::uuid[]) RETURNING message_id', [claims.deviceId, input.messageIds]);
    return send(res, 200, { data: { acknowledged: rows.length } });
  }
  return send(res, 404, { error: 'CHAT_ROUTE_NOT_FOUND' });
}

export const __chatTest = { addressValid, canonicalChallenge, challengeInput, envelopeInput, issueChatToken, chatClaims };
