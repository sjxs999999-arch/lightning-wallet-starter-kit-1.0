import { describe, expect, it, vi } from 'vitest';
import { createChatDevice, encryptEnvelope } from './crypto';
import { acceptPendingDevice, flushEncryptedOutbox, mergeEncryptedInbox, queueEncryptedMessage } from './sync';
import type { ChatContact, ChatSnapshot, RelayDevice, RelayIncomingEnvelope } from './types';

function parties() {
  const alice = createChatDevice(), bob = createChatDevice(), conversationId = crypto.randomUUID();
  const aliceAddress = `0x${'a'.repeat(40)}`, bobAddress = `0x${'b'.repeat(40)}`;
  const contact: ChatContact = { id: crypto.randomUUID(), conversationId, name: 'Bob', chain: 'EVM', address: bobAddress, trust: 'trusted', fingerprint: 'fingerprint', deviceId: bob.id, devicePublicKey: bob.publicKey, deviceUpdatedAt: new Date().toISOString() };
  const snapshot: ChatSnapshot = { version: 1, device: alice, identity: { chain: 'EVM', address: aliceAddress, walletName: 'MetaMask', network: 'Sepolia', verifiedAt: new Date().toISOString(), signature: 'signature' }, contacts: [contact], messages: [], outbox: [], pendingInbox: [], seenMessageIds: [] };
  return { alice, bob, aliceAddress, bobAddress, contact, snapshot, conversationId };
}

describe('chat relay synchronization', () => {
  it('queues an immutable encrypted envelope without plaintext', async () => {
    const { snapshot, contact } = parties();
    const next = await queueEncryptedMessage(snapshot, contact, { kind: 'text', text: '只应存在于本地保险库', createdAt: new Date().toISOString() });
    expect(next.messages[0]).toMatchObject({ state: 'queued', text: '只应存在于本地保险库' });
    expect(JSON.stringify(next.outbox?.[0]?.envelope)).not.toContain('只应存在于本地保险库');
  });

  it('keeps the same envelope for retries and marks only accepted delivery sent', async () => {
    const { snapshot, contact } = parties();
    const queued = await queueEncryptedMessage(snapshot, contact, { kind: 'text', text: 'retry me', createdAt: new Date().toISOString() });
    const original = queued.outbox![0]!.envelope;
    const failed = await flushEncryptedOutbox(queued, vi.fn(async () => { throw new Error('中继离线'); }));
    expect(failed.outbox?.[0]?.envelope).toEqual(original);
    expect(failed.messages[0]).toMatchObject({ state: 'failed', error: '中继离线' });
    const send = vi.fn(async () => ({ accepted: true }));
    const delivered = await flushEncryptedOutbox(failed, send);
    expect(send).toHaveBeenCalledWith(original);
    expect(delivered.outbox).toHaveLength(0);
    expect(delivered.messages[0]).toMatchObject({ state: 'sent' });
  });

  it('decrypts, deduplicates and acknowledges incoming envelopes', async () => {
    const { alice, bob, aliceAddress, bobAddress, conversationId } = parties();
    const bobContact: ChatContact = { id: crypto.randomUUID(), conversationId, name: 'Alice', chain: 'EVM', address: aliceAddress, trust: 'trusted', fingerprint: 'fingerprint', deviceId: alice.id, devicePublicKey: alice.publicKey };
    const receiver: ChatSnapshot = { version: 1, device: bob, identity: { chain: 'EVM', address: bobAddress, walletName: 'MetaMask', network: 'Sepolia', verifiedAt: new Date().toISOString(), signature: 'signature' }, contacts: [bobContact], messages: [] };
    const createdAt = new Date().toISOString(), metadata = { version: 1 as const, messageId: crypto.randomUUID(), conversationId, senderDeviceId: alice.id, recipientDeviceId: bob.id, timestamp: createdAt };
    const encrypted = await encryptEnvelope(JSON.stringify({ version: 1, kind: 'text', text: 'hello Bob', createdAt }), alice.privateKey, bob.publicKey, metadata);
    const sender: RelayDevice = { deviceId: alice.id, chain: 'EVM', address: aliceAddress, publicKey: alice.publicKey, updatedAt: createdAt };
    const incoming: RelayIncomingEnvelope = { ...encrypted, sender };
    const first = await mergeEncryptedInbox(receiver, [incoming]);
    expect(first.snapshot.messages).toEqual([expect.objectContaining({ direction: 'incoming', text: 'hello Bob' })]);
    expect(first.ackIds).toEqual([metadata.messageId]);
    const duplicate = await mergeEncryptedInbox(first.snapshot, [incoming]);
    expect(duplicate.snapshot.messages).toHaveLength(1);
    expect(duplicate.ackIds).toEqual([metadata.messageId]);
  });

  it('holds messages and pauses sending when a device key changes', async () => {
    const { alice, bob, aliceAddress, bobAddress, conversationId } = parties(), replacement = createChatDevice();
    const bobContact: ChatContact = { id: crypto.randomUUID(), conversationId, name: 'Alice', chain: 'EVM', address: aliceAddress, trust: 'trusted', fingerprint: 'old', deviceId: alice.id, devicePublicKey: alice.publicKey };
    const receiver: ChatSnapshot = { version: 1, device: bob, identity: { chain: 'EVM', address: bobAddress, walletName: 'MetaMask', network: 'Sepolia', verifiedAt: new Date().toISOString(), signature: 'signature' }, contacts: [bobContact], messages: [] };
    const createdAt = new Date().toISOString(), metadata = { version: 1 as const, messageId: crypto.randomUUID(), conversationId, senderDeviceId: replacement.id, recipientDeviceId: bob.id, timestamp: createdAt };
    const encrypted = await encryptEnvelope(JSON.stringify({ version: 1, kind: 'text', text: 'new device', createdAt }), replacement.privateKey, bob.publicKey, metadata);
    const incoming: RelayIncomingEnvelope = { ...encrypted, sender: { deviceId: replacement.id, chain: 'EVM', address: aliceAddress, publicKey: replacement.publicKey, updatedAt: createdAt } };
    const held = await mergeEncryptedInbox(receiver, [incoming]);
    expect(held.snapshot.contacts[0]).toMatchObject({ deviceChanged: true, pendingDeviceId: replacement.id });
    expect(held.snapshot.pendingInbox).toHaveLength(1);
    expect(held.snapshot.messages).toHaveLength(0);
    expect(held.ackIds).toHaveLength(0);
    const accepted = await acceptPendingDevice(held.snapshot, bobContact.id);
    expect(accepted.contacts[0]).toMatchObject({ deviceChanged: false, deviceId: replacement.id, trust: 'unknown' });
  });

  it('blocks a payment request whose pay-to address is not the verified sender', async () => {
    const { alice, bob, aliceAddress, bobAddress, conversationId } = parties();
    const contact: ChatContact = { id: crypto.randomUUID(), conversationId, name: 'Alice', chain: 'EVM', address: aliceAddress, trust: 'trusted', fingerprint: 'fingerprint', deviceId: alice.id, devicePublicKey: alice.publicKey };
    const receiver: ChatSnapshot = { version: 1, device: bob, contacts: [contact], messages: [] };
    const createdAt = new Date().toISOString(), metadata = { version: 1 as const, messageId: crypto.randomUUID(), conversationId, senderDeviceId: alice.id, recipientDeviceId: bob.id, timestamp: createdAt };
    const payment = { requestId: crypto.randomUUID(), chain: 'EVM' as const, asset: 'ETH', amount: '1', payTo: bobAddress, expiresAt: new Date(Date.now() + 30_000).toISOString(), memo: '', status: 'pending' as const };
    const encrypted = await encryptEnvelope(JSON.stringify({ version: 1, kind: 'payment-request', text: '1 ETH', createdAt, payment }), alice.privateKey, bob.publicKey, metadata);
    const incoming: RelayIncomingEnvelope = { ...encrypted, sender: { deviceId: alice.id, chain: 'EVM', address: aliceAddress, publicKey: alice.publicKey, updatedAt: createdAt } };
    const merged = await mergeEncryptedInbox(receiver, [incoming]);
    expect(merged.snapshot.messages[0]).toMatchObject({ kind: 'text', error: '不安全的付款请求' });
    expect(merged.ackIds).toEqual([metadata.messageId]);
  });

  it('acknowledges but does not expose plaintext from a blocked contact', async () => {
    const { alice, bob, aliceAddress, conversationId } = parties(), createdAt = new Date().toISOString();
    const contact: ChatContact = { id: crypto.randomUUID(), conversationId, name: 'Blocked', chain: 'EVM', address: aliceAddress, trust: 'blocked', fingerprint: 'fingerprint', deviceId: alice.id, devicePublicKey: alice.publicKey };
    const receiver: ChatSnapshot = { version: 1, device: bob, contacts: [contact], messages: [] };
    const metadata = { version: 1 as const, messageId: crypto.randomUUID(), conversationId, senderDeviceId: alice.id, recipientDeviceId: bob.id, timestamp: createdAt };
    const encrypted = await encryptEnvelope(JSON.stringify({ version: 1, kind: 'text', text: 'must stay hidden', createdAt }), alice.privateKey, bob.publicKey, metadata);
    const incoming: RelayIncomingEnvelope = { ...encrypted, sender: { deviceId: alice.id, chain: 'EVM', address: aliceAddress, publicKey: alice.publicKey, updatedAt: createdAt } };
    const merged = await mergeEncryptedInbox(receiver, [incoming]);
    expect(merged.snapshot.messages).toHaveLength(0);
    expect(merged.ackIds).toEqual([metadata.messageId]);
  });

  it('blocks secret-shaped plaintext before envelope creation', async () => {
    const { snapshot, contact } = parties();
    await expect(queueEncryptedMessage(snapshot, contact, { kind: 'text', text: `0x${'a'.repeat(64)}`, createdAt: new Date().toISOString() })).rejects.toThrow('私钥');
  });
});
