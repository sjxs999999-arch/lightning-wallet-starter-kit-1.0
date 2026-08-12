import { describe, expect, it } from 'vitest';
import { createChatDevice, decryptEnvelope, decryptSnapshot, encryptEnvelope, encryptSnapshot } from './crypto';
import type { ChatSnapshot } from './types';

const snapshot: ChatSnapshot = { version: 1, contacts: [], messages: [] };

describe('chat vault crypto', () => {
  it('round trips encrypted local data without plaintext in ciphertext', async () => {
    const value = await encryptSnapshot(snapshot, 'correct horse battery staple');
    expect(value.ciphertext).not.toContain('contacts');
    await expect(decryptSnapshot(value, 'correct horse battery staple')).resolves.toEqual(snapshot);
  });

  it('rejects the wrong password and tampering', async () => {
    const value = await encryptSnapshot(snapshot, 'correct horse battery staple');
    await expect(decryptSnapshot(value, 'incorrect password')).rejects.toThrow('密码错误');
    await expect(decryptSnapshot({ ...value, ciphertext: `${value.ciphertext.slice(0, -2)}AA` }, 'correct horse battery staple')).rejects.toThrow('密码错误');
  });

  it('encrypts between independent device keys and authenticates metadata', async () => {
    const alice = createChatDevice(), bob = createChatDevice();
    const metadata = { version: 1 as const, messageId: crypto.randomUUID(), conversationId: 'conversation', senderDeviceId: alice.id, recipientDeviceId: bob.id, timestamp: new Date().toISOString() };
    const envelope = await encryptEnvelope('仅双方可读', alice.privateKey, bob.publicKey, metadata);
    expect(envelope.ciphertext).not.toContain('仅双方可读');
    await expect(decryptEnvelope(envelope, bob.privateKey, alice.publicKey)).resolves.toBe('仅双方可读');
    await expect(decryptEnvelope({ ...envelope, messageId: crypto.randomUUID() }, bob.privateKey, alice.publicKey)).rejects.toThrow('无效');
  });
});
