import { createHash, generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  ackChatEnvelopes,
  chatAuthorizationClaims,
  chatEnvelopeSchema,
  ChatError,
  createChatChallenge,
  ensureChatSchema,
  isChatApiRoute,
  isPublicChatRoute,
  pollChatEnvelopes,
  pruneExpiredChatData,
  registerChatDevice,
  revokeChatDevice,
  sendChatEnvelope,
  signChatToken,
  verifyChatChallenge,
  verifyChatToken,
} from './chat.js';
import { keccak256, verifyEvmPersonalSignature, verifySolanaSignature } from './chat-crypto.js';

const DEVICE_ONE = '00000000-0000-4000-8000-000000000001';
const DEVICE_TWO = '00000000-0000-4000-8000-000000000002';
const MESSAGE_ID = '00000000-0000-4000-8000-000000000003';
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000004';
const PUBLIC_KEY = Buffer.alloc(32, 7).toString('base64');
const CHAT_SECRET = 'chat-only-test-secret-that-is-at-least-32-bytes';
const NOW = new Date('2026-08-13T00:00:00.000Z');
const EVM_ADDRESS = '0x14791697260e4c9a71f18484c9f997b308e59325';
const EVM_MESSAGE = 'Lightning Wallet test message';
const EVM_SIGNATURE = '0xfb1f238954bc90f6d7b20b8b1ae73ea8bc4d24e68329644a8808e783e71231e24ef08d4559c22e8e75e8cf61dae9e10d0d313e84d724b7a4bd6b666a7de9595b1b';

function base58(bytes: Uint8Array) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let output = '';
  while (value > 0n) { output = alphabet[Number(value % 58n)] + output; value /= 58n; }
  for (const byte of bytes) { if (byte === 0) output = `1${output}`; else break; }
  return output;
}

const identity = { chain: 'EVM' as const, address: EVM_ADDRESS, deviceId: DEVICE_ONE, devicePublicKey: PUBLIC_KEY, deviceKeyHash: 'b'.repeat(64) };
const claims = signChatToken(identity, CHAT_SECRET, NOW).claims;
const activeDevice = { device_id: DEVICE_ONE, chain: 'EVM', address: EVM_ADDRESS, public_key: PUBLIC_KEY, updated_at: NOW, revoked_at: null };
const envelope = {
  version: 1 as const,
  messageId: MESSAGE_ID,
  conversationId: CONVERSATION_ID,
  senderDeviceId: DEVICE_ONE,
  recipientDeviceId: DEVICE_TWO,
  timestamp: NOW.toISOString(),
  salt: Buffer.alloc(16, 1).toString('base64'),
  iv: Buffer.alloc(12, 2).toString('base64'),
  ciphertext: Buffer.alloc(32, 3).toString('base64'),
};

describe('wallet signature verification', () => {
  it('implements Ethereum Keccak-256 and EIP-191 recovery', () => {
    expect(Buffer.from(keccak256(new Uint8Array())).toString('hex')).toBe('c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
    expect(verifyEvmPersonalSignature(EVM_ADDRESS, EVM_MESSAGE, EVM_SIGNATURE)).toBe(true);
    expect(verifyEvmPersonalSignature(EVM_ADDRESS, `${EVM_MESSAGE}!`, EVM_SIGNATURE)).toBe(false);
  });

  it('verifies Solana Ed25519 signatures without accepting altered messages', () => {
    const pair = generateKeyPairSync('ed25519');
    const publicDer = pair.publicKey.export({ format: 'der', type: 'spki' });
    const address = base58(publicDer.subarray(publicDer.length - 32));
    const signature = nodeSign(null, Buffer.from(EVM_MESSAGE), pair.privateKey).toString('base64');
    expect(verifySolanaSignature(address, EVM_MESSAGE, signature)).toBe(true);
    expect(verifySolanaSignature(address, `${EVM_MESSAGE}!`, signature)).toBe(false);
  });
});

describe('wallet-bound chat authentication', () => {
  it('creates a five-minute, wallet.br.com-bound challenge without transaction authority', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const result = await createChatChallenge({ query }, { chain: 'EVM', address: EVM_ADDRESS.toUpperCase().replace('0X', '0x'), deviceId: DEVICE_ONE, devicePublicKey: PUBLIC_KEY }, NOW);
    expect(result.message).toContain('Domain: wallet.br.com');
    expect(result.message).toContain('URI: https://wallet.br.com');
    expect(result.message).toContain(`Device ID: ${DEVICE_ONE}`);
    expect(result.message).toContain('This request cannot authorize a transaction');
    expect(Date.parse(result.expiresAt) - NOW.getTime()).toBe(300_000);
    expect(query.mock.calls[0]?.[0]).toContain('chat_auth_challenges');
    expect(query.mock.calls[0]?.[1]).not.toContain(result.challenge);
  });

  it('verifies EVM ownership and atomically consumes the challenge once', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ chain: 'EVM', address: EVM_ADDRESS, device_id: DEVICE_ONE, device_public_key: PUBLIC_KEY, device_key_hash: 'b'.repeat(64), challenge_message: EVM_MESSAGE, expires_at: new Date(NOW.getTime() + 60_000), used_at: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 'challenge' }] });
    const result = await verifyChatChallenge({ query }, { challengeId: CONVERSATION_ID, signature: EVM_SIGNATURE }, NOW);
    expect(result).toMatchObject({ chain: 'EVM', address: EVM_ADDRESS, deviceId: DEVICE_ONE });
    expect(query.mock.calls[1]?.[0]).toContain('used_at IS NULL');
  });

  it('rejects a race that loses the single-use update', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ chain: 'EVM', address: EVM_ADDRESS, device_id: DEVICE_ONE, device_public_key: PUBLIC_KEY, device_key_hash: 'b'.repeat(64), challenge_message: EVM_MESSAGE, expires_at: new Date(NOW.getTime() + 60_000), used_at: null }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(verifyChatChallenge({ query }, { challengeId: CONVERSATION_ID, signature: EVM_SIGNATURE }, NOW)).rejects.toMatchObject({ code: 'CHAT_CHALLENGE_INVALID' });
  });

  it('uses an independently signed, expiring chat token', () => {
    const session = signChatToken(identity, CHAT_SECRET, NOW);
    expect(verifyChatToken(session.token, CHAT_SECRET, NOW)).toMatchObject({ role: 'chat', scope: 'chat:relay', deviceId: DEVICE_ONE });
    expect(() => verifyChatToken(session.token, 'operator-secret-that-is-different-and-long-enough', NOW)).toThrow(ChatError);
    expect(() => chatAuthorizationClaims(`Bearer ${session.token}`, CHAT_SECRET, new Date(NOW.getTime() + 3_600_000))).toThrow(ChatError);
  });

  it('exposes only challenge and verify as public chat routes', () => {
    expect(isChatApiRoute('/api/v1/chat/messages')).toBe(true);
    expect(isPublicChatRoute('POST', '/api/v1/chat/auth/challenge')).toBe(true);
    expect(isPublicChatRoute('POST', '/api/v1/chat/auth/verify')).toBe(true);
    expect(isPublicChatRoute('GET', '/api/v1/chat/devices')).toBe(false);
    expect(isPublicChatRoute('POST', '/api/v1/chat/messages')).toBe(false);
  });
});

describe('chat device permissions', () => {
  it('registers only the token-bound device, wallet and public key', async () => {
    const boundIdentity = { ...identity, deviceKeyHash: requireHash(PUBLIC_KEY) };
    const boundClaims = signChatToken(boundIdentity, CHAT_SECRET, NOW).claims;
    const query = vi.fn().mockResolvedValue({ rows: [{ ...activeDevice, updated_at: NOW }] });
    await expect(registerChatDevice({ query }, boundClaims, DEVICE_ONE, { chain: 'EVM', address: EVM_ADDRESS, publicKey: PUBLIC_KEY })).resolves.toMatchObject({ deviceId: DEVICE_ONE });
    expect(query.mock.calls[0]?.[0]).toContain('revoked_at<to_timestamp($5)');
    await expect(registerChatDevice({ query }, boundClaims, DEVICE_TWO, { chain: 'EVM', address: EVM_ADDRESS, publicKey: PUBLIC_KEY })).rejects.toMatchObject({ code: 'CHAT_DEVICE_FORBIDDEN' });
    expect(query).toHaveBeenCalledOnce();
  });

  it('revokes only devices owned by the token-bound wallet address', async () => {
    const boundClaims = signChatToken({ ...identity, deviceKeyHash: requireHash(PUBLIC_KEY) }, CHAT_SECRET, NOW).claims;
    const revokedAt = new Date(NOW.getTime() + 1_000);
    const ownDevice = { ...activeDevice, device_id: DEVICE_TWO, updated_at: revokedAt, revoked_at: revokedAt };
    const allowed = vi.fn().mockResolvedValueOnce({ rows: [activeDevice] }).mockResolvedValueOnce({ rows: [ownDevice] });
    await expect(revokeChatDevice({ query: allowed }, boundClaims, DEVICE_TWO)).resolves.toMatchObject({ deviceId: DEVICE_TWO, revokedAt: revokedAt.toISOString() });
    expect(allowed.mock.calls[1]?.[0]).toContain('chain=$2 AND address=$3');
    expect(allowed.mock.calls[1]?.[1]?.slice(1)).toEqual(['EVM', EVM_ADDRESS]);

    const foreign = vi.fn().mockResolvedValueOnce({ rows: [activeDevice] }).mockResolvedValueOnce({ rows: [] });
    await expect(revokeChatDevice({ query: foreign }, boundClaims, DEVICE_TWO)).rejects.toMatchObject({ code: 'CHAT_DEVICE_NOT_FOUND', status: 404 });
  });
});

function requireHash(publicKey: string) {
  return createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
}

describe('ciphertext envelope relay', () => {
  it('accepts only the fixed AES-GCM envelope and enforces decoded size', () => {
    expect(chatEnvelopeSchema.parse(envelope).ciphertext).toBe(envelope.ciphertext);
    expect(() => chatEnvelopeSchema.parse({ ...envelope, plaintext: 'must never be accepted' })).toThrow();
    expect(() => chatEnvelopeSchema.parse({ ...envelope, ciphertext: Buffer.alloc(65_537).toString('base64') })).toThrow();
    expect(() => chatEnvelopeSchema.parse({ ...envelope, iv: Buffer.alloc(11).toString('base64') })).toThrow();
  });

  it('binds the sender to the token and stores only ciphertext envelope fields', async () => {
    const keyHash = requireHash(PUBLIC_KEY);
    const boundClaims = signChatToken({ ...identity, deviceKeyHash: keyHash }, CHAT_SECRET, NOW).claims;
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [activeDevice] })
      .mockResolvedValueOnce({ rows: [{ device_id: DEVICE_TWO, chain: 'SOL', address: '11111111111111111111111111111111' }] })
      .mockResolvedValueOnce({ rows: [{ message_id: MESSAGE_ID, received_at: NOW }] });
    const result = await sendChatEnvelope({ query }, boundClaims, envelope, NOW);
    expect(result).toEqual({ messageId: MESSAGE_ID, acceptedAt: NOW.toISOString(), duplicate: false });
    expect(query.mock.calls[2]?.[0]).toContain('chat_messages');
    expect(query.mock.calls[2]?.[1]).toContain(envelope.ciphertext);
    expect(JSON.stringify(query.mock.calls[2]?.[1])).not.toMatch(/plaintext|privateKey|mnemonic|secretKey/);
    await expect(sendChatEnvelope({ query: vi.fn().mockResolvedValue({ rows: [activeDevice] }) }, boundClaims, { ...envelope, senderDeviceId: DEVICE_TWO }, NOW)).rejects.toMatchObject({ code: 'CHAT_SENDER_FORBIDDEN' });
  });

  it('treats an identical messageId as idempotent and rejects conflicting reuse', async () => {
    const keyHash = requireHash(PUBLIC_KEY);
    const boundClaims = signChatToken({ ...identity, deviceKeyHash: keyHash }, CHAT_SECRET, NOW).claims;
    const accepted = vi.fn()
      .mockResolvedValueOnce({ rows: [activeDevice] })
      .mockResolvedValueOnce({ rows: [{ device_id: DEVICE_TWO, chain: 'SOL', address: '11111111111111111111111111111111' }] })
      .mockResolvedValueOnce({ rows: [{ message_id: MESSAGE_ID, received_at: NOW }] });
    await sendChatEnvelope({ query: accepted }, boundClaims, envelope, NOW);
    const storedHash = accepted.mock.calls[2]?.[1]?.[12];
    const duplicate = vi.fn()
      .mockResolvedValueOnce({ rows: [activeDevice] })
      .mockResolvedValueOnce({ rows: [{ device_id: DEVICE_TWO, chain: 'SOL', address: '11111111111111111111111111111111' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ envelope_hash: storedHash, sender_chain: 'EVM', sender_address: EVM_ADDRESS, sender_device_id: DEVICE_ONE, received_at: NOW }] });
    await expect(sendChatEnvelope({ query: duplicate }, boundClaims, envelope, NOW)).resolves.toMatchObject({ duplicate: true });
    const conflict = vi.fn()
      .mockResolvedValueOnce({ rows: [activeDevice] })
      .mockResolvedValueOnce({ rows: [{ device_id: DEVICE_TWO, chain: 'SOL', address: '11111111111111111111111111111111' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ envelope_hash: 'different', sender_chain: 'EVM', sender_address: EVM_ADDRESS, sender_device_id: DEVICE_ONE, received_at: NOW }] });
    await expect(sendChatEnvelope({ query: conflict }, boundClaims, envelope, NOW)).rejects.toMatchObject({ code: 'CHAT_MESSAGE_ID_CONFLICT', status: 409 });
  });

  it('paginates only the authenticated recipient device and returns the sender key', async () => {
    const keyHash = requireHash(PUBLIC_KEY);
    const boundClaims = signChatToken({ ...identity, deviceKeyHash: keyHash }, CHAT_SECRET, NOW).claims;
    const row = {
      message_id: MESSAGE_ID, conversation_id: CONVERSATION_ID, sender_device_id: DEVICE_TWO, recipient_device_id: DEVICE_ONE,
      client_timestamp: NOW, salt: envelope.salt, iv: envelope.iv, ciphertext: envelope.ciphertext,
      received_at: NOW, expires_at: new Date(NOW.getTime() + 1_000), sender_chain: 'SOL', sender_address: '11111111111111111111111111111111', sender_public_key: PUBLIC_KEY, sender_updated_at: NOW,
    };
    const query = vi.fn().mockResolvedValueOnce({ rows: [activeDevice] }).mockResolvedValueOnce({ rows: [row, { ...row, message_id: DEVICE_TWO }] });
    const result = await pollChatEnvelopes({ query }, boundClaims, { deviceId: DEVICE_ONE, limit: 1 });
    expect(result.items[0]).toMatchObject({ ciphertext: envelope.ciphertext, sender: { deviceId: DEVICE_TWO, publicKey: PUBLIC_KEY, updatedAt: NOW.toISOString() } });
    expect(result.cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    await expect(pollChatEnvelopes({ query: vi.fn().mockResolvedValue({ rows: [activeDevice] }) }, boundClaims, { deviceId: DEVICE_TWO })).rejects.toMatchObject({ code: 'CHAT_DEVICE_FORBIDDEN' });
  });

  it('acks only message IDs delivered to the token-bound recipient device', async () => {
    const keyHash = requireHash(PUBLIC_KEY);
    const boundClaims = signChatToken({ ...identity, deviceKeyHash: keyHash }, CHAT_SECRET, NOW).claims;
    const query = vi.fn().mockResolvedValueOnce({ rows: [activeDevice] }).mockResolvedValueOnce({ rows: [{ message_id: MESSAGE_ID }] });
    await expect(ackChatEnvelopes({ query }, boundClaims, { deviceId: DEVICE_ONE, messageIds: [MESSAGE_ID] })).resolves.toEqual({ acked: 1 });
    expect(query.mock.calls[1]?.[0]).toContain('recipient_device_id=$1');
    expect(query.mock.calls[1]?.[1]?.[0]).toBe(DEVICE_ONE);
  });
});

describe('chat deployment safety boundaries', () => {
  it('keeps operator authorization role-gated and redacts all envelope secrets', () => {
    const server = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
    expect(server).toContain("role!=='operator'");
    for (const field of ['body.signature', 'body.ciphertext', 'body.salt', 'body.iv']) expect(server).toContain(field);
    const routes = readFileSync(new URL('./chat-routes.ts', import.meta.url), 'utf8');
    expect(routes).not.toMatch(/\.log\.(?:info|warn|error)/);
    expect(routes).toContain("max: 60, timeWindow: '1 minute'");
  });

  it('sets database TTL, uniqueness and recipient polling indexes', () => {
    const sql = readFileSync(new URL('../../../database/init.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS chat_auth_challenges');
    expect(sql).toContain("expires_at<=issued_at+interval '5 minutes'");
    expect(sql).toContain('message_id uuid PRIMARY KEY');
    expect(sql).toContain("expires_at<=received_at+interval '30 days'");
    expect(sql).toContain('idx_chat_messages_recipient_poll');
  });

  it('can initialize existing databases and physically prunes expired ciphertext', async () => {
    const initialize = vi.fn().mockResolvedValue({ rows: [] });
    await ensureChatSchema({ query: initialize });
    expect(initialize.mock.calls[0]?.[0]).toContain('CREATE TABLE IF NOT EXISTS chat_messages');
    const prune = vi.fn().mockResolvedValueOnce({ rows: [{ message_id: MESSAGE_ID }] }).mockResolvedValueOnce({ rows: [{ id: CONVERSATION_ID }] });
    await expect(pruneExpiredChatData({ query: prune })).resolves.toEqual({ messages: 1, challenges: 1 });
    expect(prune.mock.calls[0]?.[0]).toBe('DELETE FROM chat_messages WHERE expires_at<=now() RETURNING message_id');
  });
});
