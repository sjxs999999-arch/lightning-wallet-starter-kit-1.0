import { describe, expect, it, vi } from 'vitest';
import { createChatDevice } from './crypto';
import { createRelayClient } from './relay';
import type { ChatEnvelope } from './types';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('chat relay client', () => {
  it('uses a server challenge bound to the domain, wallet and device', async () => {
    const device = createChatDevice(), address = `0x${'a'.repeat(40)}`;
    const message = ['Lightning Wallet Chat Authentication', 'Domain: lightingwallet.com', 'Purpose: chat-device-bind', 'Chain: EVM', `Address: ${address}`, `Device ID: ${device.id}`, `Device key: ${device.publicKey}`, 'This request does not authorize a transaction or token approval.'].join('\n');
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ data: { challengeId: crypto.randomUUID(), challenge: {}, message, expiresAt: new Date(Date.now() + 300_000).toISOString() } }));
    const challenge = await createRelayClient('/api/v1/chat', fetcher as typeof fetch).challenge({ chain: 'EVM', address, deviceId: device.id, devicePublicKey: device.publicKey });
    expect(challenge.message).toBe(message);
    const body = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(body).toEqual({ chain: 'EVM', address, deviceId: device.id, devicePublicKey: device.publicKey });
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ 'x-lightning-csrf': '1' });
  });

  it('rejects a challenge that can be replayed against another device', async () => {
    const device = createChatDevice(), address = `0x${'a'.repeat(40)}`;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ data: { challengeId: crypto.randomUUID(), challenge: {}, message: `lightingwallet.com chat-device-bind EVM ${address} another-device ${device.publicKey}`, expiresAt: new Date(Date.now() + 300_000).toISOString() } }));
    await expect(createRelayClient('/api/v1/chat', fetcher as typeof fetch).challenge({ chain: 'EVM', address, deviceId: device.id, devicePublicKey: device.publicKey })).rejects.toThrow('未绑定');
  });

  it('accepts a server challenge bound through the device-key digest', async () => {
    const device = createChatDevice(), address = `0x${'Ab'.repeat(20)}`;
    const bytes = Uint8Array.from(atob(device.publicKey), character => character.charCodeAt(0));
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const message = `Lightning Wallet Chat Authentication\nDomain: lightingwallet.com\nURI: https://lightingwallet.com/chat\nChain: EVM\nAddress: ${address.toLowerCase()}\nDevice ID: ${device.id}\nDevice Key SHA-256: ${digest}\nStatement: Sign in to the non-custodial encrypted chat relay. This request cannot authorize a transaction.`;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ data: { challengeId: crypto.randomUUID(), challenge: 'nonce', message, expiresAt: new Date(Date.now() + 300_000).toISOString() } }));
    await expect(createRelayClient('/api/v1/chat', fetcher as typeof fetch).challenge({ chain: 'EVM', address, deviceId: device.id, devicePublicKey: device.publicKey })).resolves.toMatchObject({ message });
  });

  it('posts only the encrypted envelope with bearer auth and CSRF intent', async () => {
    const envelope: ChatEnvelope = { version: 1, messageId: crypto.randomUUID(), conversationId: crypto.randomUUID(), senderDeviceId: crypto.randomUUID(), recipientDeviceId: crypto.randomUUID(), timestamp: new Date().toISOString(), salt: btoa('sixteen-byte-slt'), iv: btoa('twelve-byte!'), ciphertext: btoa('ciphertext only') };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ data: { messageId: envelope.messageId, duplicate: false } }));
    await createRelayClient('/api/v1/chat', fetcher as typeof fetch).send('short-chat-token', envelope);
    const init = fetcher.mock.calls[0]![1]!, body = String(init.body);
    expect(JSON.parse(body)).toEqual(envelope);
    expect(body).not.toContain('privateKey');
    expect(init.headers).toMatchObject({ authorization: 'Bearer short-chat-token', 'x-lightning-csrf': '1' });
  });

  it('parses public device records and authenticated inbox envelopes', async () => {
    const sender = createChatDevice(), recipient = createChatDevice(), messageId = crypto.randomUUID();
    const device = { deviceId: sender.id, chain: 'SOL', address: '11111111111111111111111111111111', publicKey: sender.publicKey, updatedAt: new Date().toISOString() };
    const envelope = { version: 1, messageId, conversationId: crypto.randomUUID(), senderDeviceId: sender.id, recipientDeviceId: recipient.id, timestamp: new Date().toISOString(), salt: btoa('sixteen-byte-slt'), iv: btoa('twelve-byte!'), ciphertext: btoa('ciphertext'), sender: device };
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => String(url).includes('/devices?') ? json({ data: [device] }) : json({ data: { items: [envelope], cursor: 'next' } }));
    const relay = createRelayClient('/api/v1/chat', fetcher as typeof fetch);
    await expect(relay.devices('SOL', device.address)).resolves.toHaveLength(1);
    await expect(relay.poll('token', recipient.id)).resolves.toMatchObject({ cursor: 'next', items: [{ messageId }] });
  });
});
