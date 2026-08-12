import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error Production Vercel handler is intentionally plain ESM JavaScript.
import { __chatTest } from '../../web/public/api/v1/chat-lib.js';

const previousChatSecret = process.env.CHAT_JWT_SECRET;
const previousOperatorSecret = process.env.JWT_SECRET;
const devicePublicKey = Buffer.alloc(32, 7).toString('base64');
const identity = { chain: 'SOL', address: '11111111111111111111111111111111', deviceId: '00000000-0000-4000-8000-000000000001', devicePublicKey };

beforeEach(() => { process.env.CHAT_JWT_SECRET = 'chat-test-secret-that-is-distinct-123456789'; process.env.JWT_SECRET = 'operator-test-secret-that-is-different-12345'; });
afterEach(() => { if (previousChatSecret === undefined) delete process.env.CHAT_JWT_SECRET; else process.env.CHAT_JWT_SECRET = previousChatSecret; if (previousOperatorSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousOperatorSecret; });

describe('production serverless chat security', () => {
  it('binds the challenge to lightingwallet.com, purpose, address, and device key', () => {
    expect(__chatTest.challengeInput(identity)).toEqual(identity);
    const message = __chatTest.canonicalChallenge(identity, 'nonce', '2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z');
    expect(message).toContain('Domain: lightingwallet.com');
    expect(message).toContain('Purpose: chat-device-bind');
    expect(message).toContain(identity.address);
    expect(message).toContain(devicePublicKey);
    expect(message).toContain('does not authorize a transaction or token approval');
    expect(__chatTest.challengeInput({ ...identity, privateKey: 'blocked' })).toBeNull();
    expect(__chatTest.addressValid('SOL', '1'.repeat(31))).toBe(false);
  });

  it('uses a domain-separated chat token and rejects a changed chat secret', () => {
    const issued = __chatTest.issueChatToken({ sub: `lw:SOL:${identity.address}`, chain: 'SOL', address: identity.address, deviceId: identity.deviceId, devicePublicKey });
    expect(__chatTest.chatClaims(issued.token)).toMatchObject({ aud: 'lightning-chat', scope: 'chat:relay', deviceId: identity.deviceId });
    process.env.CHAT_JWT_SECRET = 'another-chat-secret-that-is-distinct-123456';
    expect(__chatTest.chatClaims(issued.token)).toBeNull();
  });

  it('accepts only strict ciphertext envelopes and rejects plaintext fields', () => {
    const envelope = { version: 1, messageId: '00000000-0000-4000-8000-000000000002', conversationId: '00000000-0000-4000-8000-000000000003', senderDeviceId: identity.deviceId, recipientDeviceId: '00000000-0000-4000-8000-000000000004', timestamp: new Date().toISOString(), salt: Buffer.alloc(16).toString('base64'), iv: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(17).toString('base64') };
    expect(__chatTest.envelopeInput(envelope)).toEqual(envelope);
    expect(__chatTest.envelopeInput({ ...envelope, plaintext: 'secret' })).toBeNull();
    expect(__chatTest.envelopeInput({ ...envelope, ciphertext: Buffer.alloc(64 * 1024 + 1).toString('base64') })).toBeNull();
  });
});
