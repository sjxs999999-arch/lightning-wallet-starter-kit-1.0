import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { decodeBase58, decodeStrictBase64, verifyEvmPersonalSignature, verifySolanaSignature } from './chat-crypto.js';

export const CHAT_DOMAIN = 'lightingwallet.com';
export const CHAT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CHAT_TOKEN_TTL_SECONDS = 60 * 60;
export const CHAT_MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CHAT_MAX_CIPHERTEXT_BYTES = 64 * 1024;

export type ChatChain = 'EVM' | 'SOL';
export interface ChatStore { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

export class ChatError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); this.name = 'ChatError'; }
}

export async function ensureChatSchema(db: ChatStore) {
  await db.query(`CREATE TABLE IF NOT EXISTS chat_auth_challenges (id uuid PRIMARY KEY,chain text NOT NULL CHECK(chain IN ('EVM','SOL')),address text NOT NULL,device_id uuid NOT NULL,device_public_key text NOT NULL,device_key_hash text NOT NULL CHECK(device_key_hash ~ '^[a-f0-9]{64}$'),nonce_hash text NOT NULL CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),challenge_message text NOT NULL,issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '5 minutes'));CREATE TABLE IF NOT EXISTS chat_devices (device_id uuid PRIMARY KEY,chain text NOT NULL CHECK(chain IN ('EVM','SOL')),address text NOT NULL,public_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revoked_at timestamptz);CREATE TABLE IF NOT EXISTS chat_messages (message_id uuid PRIMARY KEY,conversation_id uuid NOT NULL,sender_chain text NOT NULL CHECK(sender_chain IN ('EVM','SOL')),sender_address text NOT NULL,sender_device_id uuid NOT NULL REFERENCES chat_devices(device_id),recipient_chain text NOT NULL CHECK(recipient_chain IN ('EVM','SOL')),recipient_address text NOT NULL,recipient_device_id uuid NOT NULL REFERENCES chat_devices(device_id),client_timestamp timestamptz NOT NULL,salt text NOT NULL,iv text NOT NULL,ciphertext text NOT NULL CHECK(length(ciphertext)<=87384),envelope_hash text NOT NULL CHECK(envelope_hash ~ '^[a-f0-9]{64}$'),received_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,acked_at timestamptz,CHECK(expires_at>received_at AND expires_at<=received_at+interval '30 days'));CREATE INDEX IF NOT EXISTS idx_chat_challenges_expiry ON chat_auth_challenges(expires_at);CREATE INDEX IF NOT EXISTS idx_chat_devices_address ON chat_devices(chain,address,revoked_at);CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient_poll ON chat_messages(recipient_device_id,acked_at,received_at,message_id);CREATE INDEX IF NOT EXISTS idx_chat_messages_expiry ON chat_messages(expires_at)`);
}

export async function pruneExpiredChatData(db: ChatStore) {
  const messages = await db.query('DELETE FROM chat_messages WHERE expires_at<=now() RETURNING message_id');
  const challenges = await db.query('DELETE FROM chat_auth_challenges WHERE expires_at<=now() RETURNING id');
  return { messages: messages.rows.length, challenges: challenges.rows.length };
}

function validBase64(value: string, minimum: number, maximum: number) {
  try { decodeStrictBase64(value, minimum, maximum); return true; }
  catch { return false; }
}

function normalizeAddress(chain: ChatChain, address: string) {
  const value = address.trim();
  if (chain === 'EVM') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new ChatError('INVALID_CHAT_ADDRESS', 400);
    return value.toLowerCase();
  }
  try {
    if (decodeBase58(value).length !== 32) throw new Error('invalid');
    return value;
  } catch {
    throw new ChatError('INVALID_CHAT_ADDRESS', 400);
  }
}

const devicePublicKeySchema = z.string().min(44).max(44).refine(value => validBase64(value, 32, 32));
export const chatChallengeSchema = z.object({
  chain: z.enum(['EVM', 'SOL']),
  address: z.string().trim().min(32).max(64),
  deviceId: z.string().uuid(),
  devicePublicKey: devicePublicKeySchema,
}).strict();

export const chatVerifySchema = z.object({
  challengeId: z.string().uuid(),
  signature: z.string().trim().min(64).max(200),
}).strict();

export type ChatIdentity = {
  chain: ChatChain;
  address: string;
  deviceId: string;
  devicePublicKey: string;
  deviceKeyHash: string;
};

const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function dateValue(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new ChatError('CHAT_STORE_INVALID', 503);
  return date;
}

function challengeMessage(input: ChatIdentity, nonce: string, issuedAt: string, expiresAt: string) {
  return [
    'Lightning Wallet Chat Authentication',
    `Domain: ${CHAT_DOMAIN}`,
    `URI: https://${CHAT_DOMAIN}/chat`,
    `Chain: ${input.chain}`,
    `Address: ${input.address}`,
    `Device ID: ${input.deviceId}`,
    `Device Key SHA-256: ${input.deviceKeyHash}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expiresAt}`,
    'Statement: Sign in to the non-custodial encrypted chat relay. This request cannot authorize a transaction.',
  ].join('\n');
}

export async function createChatChallenge(db: ChatStore, input: unknown, now = new Date()) {
  const parsed = chatChallengeSchema.parse(input);
  const address = normalizeAddress(parsed.chain, parsed.address);
  const publicKeyBytes = decodeStrictBase64(parsed.devicePublicKey, 32, 32);
  const identity: ChatIdentity = {
    chain: parsed.chain,
    address,
    deviceId: parsed.deviceId,
    devicePublicKey: parsed.devicePublicKey,
    deviceKeyHash: sha256(publicKeyBytes),
  };
  const challengeId = randomUUID();
  const challenge = randomBytes(32).toString('base64url');
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + CHAT_CHALLENGE_TTL_MS).toISOString();
  const message = challengeMessage(identity, challenge, issuedAt, expiresAt);
  await db.query(
    'INSERT INTO chat_auth_challenges(id,chain,address,device_id,device_public_key,device_key_hash,nonce_hash,challenge_message,issued_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [challengeId, identity.chain, identity.address, identity.deviceId, identity.devicePublicKey, identity.deviceKeyHash, sha256(challenge), message, issuedAt, expiresAt],
  );
  return { challengeId, challenge, message, expiresAt };
}

export async function verifyChatChallenge(db: ChatStore, input: unknown, now = new Date()): Promise<ChatIdentity> {
  const parsed = chatVerifySchema.parse(input);
  const selected = await db.query('SELECT chain,address,device_id,device_public_key,device_key_hash,challenge_message,expires_at,used_at FROM chat_auth_challenges WHERE id=$1', [parsed.challengeId]);
  const row = selected.rows[0];
  if (!row || row.used_at || dateValue(row.expires_at).getTime() <= now.getTime()) throw new ChatError('CHAT_CHALLENGE_INVALID', 401);
  const chain = row.chain;
  if (chain !== 'EVM' && chain !== 'SOL') throw new ChatError('CHAT_CHALLENGE_INVALID', 401);
  const address = normalizeAddress(chain, String(row.address));
  const message = String(row.challenge_message);
  const valid = chain === 'EVM'
    ? verifyEvmPersonalSignature(address, message, parsed.signature)
    : verifySolanaSignature(address, message, parsed.signature);
  if (!valid) throw new ChatError('CHAT_SIGNATURE_INVALID', 401);
  const consumed = await db.query('UPDATE chat_auth_challenges SET used_at=$2 WHERE id=$1 AND used_at IS NULL AND expires_at>$2 RETURNING id', [parsed.challengeId, now.toISOString()]);
  if (!consumed.rows[0]) throw new ChatError('CHAT_CHALLENGE_INVALID', 401);
  return {
    chain,
    address,
    deviceId: String(row.device_id),
    devicePublicKey: String(row.device_public_key),
    deviceKeyHash: String(row.device_key_hash),
  };
}

export function chatTokenPayload(identity: ChatIdentity) {
  return {
    sub: `chat:${identity.chain}:${identity.address}`,
    role: 'chat',
    scope: 'chat:relay',
    chain: identity.chain,
    address: identity.address,
    deviceId: identity.deviceId,
    deviceKeyHash: identity.deviceKeyHash,
  } as const;
}

const chatClaimsSchema = z.object({
  sub: z.string().min(1).max(200),
  role: z.literal('chat'),
  scope: z.literal('chat:relay'),
  chain: z.enum(['EVM', 'SOL']),
  address: z.string().min(32).max(64),
  deviceId: z.string().uuid(),
  deviceKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
  iat: z.number().int().positive(),
  exp: z.number().int().positive(),
  jti: z.string().uuid(),
}).passthrough();
export type ChatClaims = z.infer<typeof chatClaimsSchema>;

export function parseChatClaims(value: unknown): ChatClaims {
  const claims = chatClaimsSchema.safeParse(value);
  if (!claims.success) throw new ChatError('CHAT_TOKEN_REQUIRED', 401);
  const address = normalizeAddress(claims.data.chain, claims.data.address);
  if (claims.data.sub !== `chat:${claims.data.chain}:${address}`) throw new ChatError('CHAT_TOKEN_REQUIRED', 401);
  return { ...claims.data, address };
}

function encodeTokenPart(value: unknown) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
export function signChatToken(identity: ChatIdentity, secret: string, now = new Date()) {
  if (Buffer.byteLength(secret) < 32) throw new Error('CHAT_JWT_SECRET_TOO_SHORT');
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload = { ...chatTokenPayload(identity), iat: issuedAt, exp: issuedAt + CHAT_TOKEN_TTL_SECONDS, jti: randomUUID() };
  const header = encodeTokenPart({ alg: 'HS256', typ: 'JWT', kid: 'lightning-chat-v1' });
  const body = encodeTokenPart(payload);
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return { token: `${header}.${body}.${signature}`, expiresAt: new Date(payload.exp * 1000).toISOString(), claims: parseChatClaims(payload) };
}

export function verifyChatToken(token: string, secret: string, now = new Date()) {
  try {
    if (Buffer.byteLength(secret) < 32) throw new Error('secret');
    const [headerPart, payloadPart, signaturePart, extra] = token.split('.');
    if (extra !== undefined || !headerPart || !payloadPart || !signaturePart) throw new Error('format');
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || header.kid !== 'lightning-chat-v1') throw new Error('header');
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.toString('base64url') !== signaturePart) throw new Error('signature');
    const expected = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('signature');
    const claims = parseChatClaims(JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')));
    const timestamp = Math.floor(now.getTime() / 1000);
    if (claims.exp <= timestamp || claims.iat > timestamp + 60 || claims.exp - claims.iat > CHAT_TOKEN_TTL_SECONDS) throw new Error('expired');
    return claims;
  } catch {
    throw new ChatError('CHAT_TOKEN_REQUIRED', 401);
  }
}

export function chatAuthorizationClaims(authorization: string | undefined, secret: string, now = new Date()) {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization ?? '');
  if (!match) throw new ChatError('CHAT_TOKEN_REQUIRED', 401);
  return verifyChatToken(match[1]!, secret, now);
}

export function isChatApiRoute(requestUrl: string) {
  return new URL(requestUrl, 'https://lightingwallet.com').pathname.startsWith('/api/v1/chat/');
}

export function isPublicChatRoute(method: string | undefined, requestUrl: string) {
  const path = new URL(requestUrl, 'https://lightingwallet.com').pathname.replace(/\/+$/, '');
  return (method ?? 'GET').toUpperCase() === 'POST' && (path === '/api/v1/chat/auth/challenge' || path === '/api/v1/chat/auth/verify');
}

const registerDeviceSchema = z.object({
  chain: z.enum(['EVM', 'SOL']),
  address: z.string().trim().min(32).max(64),
  publicKey: devicePublicKeySchema,
}).strict();

export async function registerChatDevice(db: ChatStore, claims: ChatClaims, deviceId: unknown, input: unknown) {
  const id = z.string().uuid().parse(deviceId);
  const value = registerDeviceSchema.parse(input);
  const address = normalizeAddress(value.chain, value.address);
  if (id !== claims.deviceId || value.chain !== claims.chain || address !== claims.address || sha256(decodeStrictBase64(value.publicKey, 32, 32)) !== claims.deviceKeyHash) {
    throw new ChatError('CHAT_DEVICE_FORBIDDEN', 403);
  }
  const result = await db.query(
    'INSERT INTO chat_devices(device_id,chain,address,public_key,created_at,updated_at) VALUES($1,$2,$3,$4,now(),now()) ON CONFLICT(device_id) DO UPDATE SET public_key=EXCLUDED.public_key,updated_at=now(),revoked_at=NULL WHERE chat_devices.chain=EXCLUDED.chain AND chat_devices.address=EXCLUDED.address AND (chat_devices.revoked_at IS NULL OR chat_devices.revoked_at<to_timestamp($5)) RETURNING device_id,chain,address,public_key,updated_at,revoked_at',
    [id, claims.chain, claims.address, value.publicKey, claims.iat],
  );
  const row = result.rows[0];
  if (!row) throw new ChatError('CHAT_DEVICE_CONFLICT', 409);
  return publicDevice(row);
}

function publicDevice(row: Record<string, unknown>) {
  return {
    deviceId: String(row.device_id),
    chain: String(row.chain),
    address: String(row.address),
    publicKey: String(row.public_key),
    updatedAt: dateValue(row.updated_at).toISOString(),
    ...(row.revoked_at ? { revokedAt: dateValue(row.revoked_at).toISOString() } : {}),
  };
}

export async function assertActiveChatDevice(db: ChatStore, claims: ChatClaims) {
  const result = await db.query('SELECT device_id,chain,address,public_key,updated_at,revoked_at FROM chat_devices WHERE device_id=$1 AND chain=$2 AND address=$3 AND revoked_at IS NULL', [claims.deviceId, claims.chain, claims.address]);
  const row = result.rows[0];
  if (!row || sha256(decodeStrictBase64(String(row.public_key), 32, 32)) !== claims.deviceKeyHash) throw new ChatError('CHAT_DEVICE_INACTIVE', 401);
  return row;
}

export async function listChatDevices(db: ChatStore, claims: ChatClaims, input: unknown) {
  await assertActiveChatDevice(db, claims);
  const query = z.object({ chain: z.enum(['EVM', 'SOL']), address: z.string().trim().min(32).max(64) }).strict().parse(input);
  const address = normalizeAddress(query.chain, query.address);
  const result = await db.query('SELECT device_id,chain,address,public_key,updated_at,revoked_at FROM chat_devices WHERE chain=$1 AND address=$2 AND revoked_at IS NULL ORDER BY created_at ASC LIMIT 50', [query.chain, address]);
  return result.rows.map(publicDevice);
}

export async function revokeChatDevice(db: ChatStore, claims: ChatClaims, deviceId: unknown) {
  await assertActiveChatDevice(db, claims);
  const id = z.string().uuid().parse(deviceId);
  const result = await db.query('UPDATE chat_devices SET revoked_at=now(),updated_at=now() WHERE device_id=$1 AND chain=$2 AND address=$3 AND revoked_at IS NULL RETURNING device_id,chain,address,public_key,updated_at,revoked_at', [id, claims.chain, claims.address]);
  if (!result.rows[0]) throw new ChatError('CHAT_DEVICE_NOT_FOUND', 404);
  return publicDevice(result.rows[0]);
}

const isoDateSchema = z.string().min(20).max(40).refine(value => Number.isFinite(Date.parse(value)));
const base64Field = (minimum: number, maximum: number, maxChars: number) => z.string().min(1).max(maxChars).refine(value => validBase64(value, minimum, maximum));
export const chatEnvelopeSchema = z.object({
  version: z.literal(1),
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderDeviceId: z.string().uuid(),
  recipientDeviceId: z.string().uuid(),
  timestamp: isoDateSchema,
  salt: base64Field(16, 64, 88),
  iv: base64Field(12, 12, 16),
  ciphertext: base64Field(16, CHAT_MAX_CIPHERTEXT_BYTES, 87_384),
}).strict();
export type ChatEnvelope = z.infer<typeof chatEnvelopeSchema>;

function envelopeHash(claims: ChatClaims, envelope: ChatEnvelope) {
  return sha256(JSON.stringify([
    claims.chain, claims.address, claims.deviceId, envelope.version, envelope.messageId,
    envelope.conversationId, envelope.senderDeviceId, envelope.recipientDeviceId,
    envelope.timestamp, envelope.salt, envelope.iv, envelope.ciphertext,
  ]));
}

export async function sendChatEnvelope(db: ChatStore, claims: ChatClaims, input: unknown, now = new Date()) {
  await assertActiveChatDevice(db, claims);
  const envelope = chatEnvelopeSchema.parse(input);
  if (envelope.senderDeviceId !== claims.deviceId) throw new ChatError('CHAT_SENDER_FORBIDDEN', 403);
  const timestamp = new Date(envelope.timestamp);
  if (timestamp.getTime() > now.getTime() + 5 * 60 * 1000 || timestamp.getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000) throw new ChatError('CHAT_TIMESTAMP_INVALID', 400);
  const recipientResult = await db.query('SELECT device_id,chain,address FROM chat_devices WHERE device_id=$1 AND revoked_at IS NULL', [envelope.recipientDeviceId]);
  const recipient = recipientResult.rows[0];
  if (!recipient) throw new ChatError('CHAT_RECIPIENT_NOT_FOUND', 404);
  const hash = envelopeHash(claims, envelope);
  const expiresAt = new Date(now.getTime() + CHAT_MESSAGE_TTL_MS).toISOString();
  const inserted = await db.query(
    'INSERT INTO chat_messages(message_id,conversation_id,sender_chain,sender_address,sender_device_id,recipient_chain,recipient_address,recipient_device_id,client_timestamp,salt,iv,ciphertext,envelope_hash,received_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(message_id) DO NOTHING RETURNING message_id,received_at',
    [envelope.messageId, envelope.conversationId, claims.chain, claims.address, claims.deviceId, recipient.chain, recipient.address, envelope.recipientDeviceId, timestamp.toISOString(), envelope.salt, envelope.iv, envelope.ciphertext, hash, now.toISOString(), expiresAt],
  );
  if (inserted.rows[0]) return { messageId: envelope.messageId, acceptedAt: dateValue(inserted.rows[0].received_at).toISOString(), duplicate: false };
  const existing = await db.query('SELECT envelope_hash,sender_chain,sender_address,sender_device_id,received_at FROM chat_messages WHERE message_id=$1', [envelope.messageId]);
  const row = existing.rows[0];
  if (row && row.envelope_hash === hash && row.sender_chain === claims.chain && row.sender_address === claims.address && row.sender_device_id === claims.deviceId) {
    return { messageId: envelope.messageId, acceptedAt: dateValue(row.received_at).toISOString(), duplicate: true };
  }
  throw new ChatError('CHAT_MESSAGE_ID_CONFLICT', 409);
}

const cursorSchema = z.object({ at: isoDateSchema, id: z.string().uuid() }).strict();
function encodeCursor(at: string, id: string) { return Buffer.from(JSON.stringify({ at, id }), 'utf8').toString('base64url'); }
function decodeCursor(value: string | undefined) {
  if (!value) return null;
  if (!/^[A-Za-z0-9_-]{10,500}$/.test(value)) throw new ChatError('CHAT_CURSOR_INVALID', 400);
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) throw new Error('invalid');
    return cursorSchema.parse(JSON.parse(decoded.toString('utf8')));
  } catch { throw new ChatError('CHAT_CURSOR_INVALID', 400); }
}

export async function pollChatEnvelopes(db: ChatStore, claims: ChatClaims, input: unknown) {
  await assertActiveChatDevice(db, claims);
  const query = z.object({ deviceId: z.string().uuid(), cursor: z.string().max(500).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(input);
  if (query.deviceId !== claims.deviceId) throw new ChatError('CHAT_DEVICE_FORBIDDEN', 403);
  const cursor = decodeCursor(query.cursor);
  const result = await db.query(
    'SELECT m.message_id,m.conversation_id,m.sender_device_id,m.recipient_device_id,m.client_timestamp,m.salt,m.iv,m.ciphertext,m.received_at,m.expires_at,d.chain AS sender_chain,d.address AS sender_address,d.public_key AS sender_public_key,d.updated_at AS sender_updated_at FROM chat_messages m JOIN chat_devices d ON d.device_id=m.sender_device_id WHERE m.recipient_device_id=$1 AND m.recipient_chain=$2 AND m.recipient_address=$3 AND m.acked_at IS NULL AND m.expires_at>now() AND ($4::timestamptz IS NULL OR (m.received_at,m.message_id)>($4::timestamptz,$5::uuid)) ORDER BY m.received_at ASC,m.message_id ASC LIMIT $6',
    [claims.deviceId, claims.chain, claims.address, cursor?.at ?? null, cursor?.id ?? null, query.limit + 1],
  );
  const hasMore = result.rows.length > query.limit;
  const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
  const items = rows.map(row => ({
    version: 1 as const,
    messageId: String(row.message_id),
    conversationId: String(row.conversation_id),
    senderDeviceId: String(row.sender_device_id),
    recipientDeviceId: String(row.recipient_device_id),
    timestamp: dateValue(row.client_timestamp).toISOString(),
    salt: String(row.salt),
    iv: String(row.iv),
    ciphertext: String(row.ciphertext),
    sender: {
      chain: String(row.sender_chain),
      address: String(row.sender_address),
      deviceId: String(row.sender_device_id),
      publicKey: String(row.sender_public_key),
      updatedAt: dateValue(row.sender_updated_at).toISOString(),
    },
    receivedAt: dateValue(row.received_at).toISOString(),
    expiresAt: dateValue(row.expires_at).toISOString(),
  }));
  const last = rows.at(-1);
  return { items, cursor: hasMore && last ? encodeCursor(dateValue(last.received_at).toISOString(), String(last.message_id)) : null };
}

export async function ackChatEnvelopes(db: ChatStore, claims: ChatClaims, input: unknown) {
  await assertActiveChatDevice(db, claims);
  const value = z.object({ deviceId: z.string().uuid(), messageIds: z.array(z.string().uuid()).min(1).max(100) }).strict().superRefine((item, context) => {
    if (new Set(item.messageIds).size !== item.messageIds.length) context.addIssue({ code: 'custom', path: ['messageIds'], message: 'Duplicate message identifiers are not allowed' });
  }).parse(input);
  if (value.deviceId !== claims.deviceId) throw new ChatError('CHAT_DEVICE_FORBIDDEN', 403);
  const result = await db.query('UPDATE chat_messages SET acked_at=now() WHERE recipient_device_id=$1 AND recipient_chain=$2 AND recipient_address=$3 AND message_id=ANY($4::uuid[]) AND acked_at IS NULL RETURNING message_id', [claims.deviceId, claims.chain, claims.address, value.messageIds]);
  return { acked: result.rows.length };
}
