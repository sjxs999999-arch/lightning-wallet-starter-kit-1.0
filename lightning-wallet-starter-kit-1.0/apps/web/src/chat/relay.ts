import type { ChatChain, ChatDevice, ChatEnvelope, RelayDevice, RelayIncomingEnvelope } from './types';

export type RelayAuthChallenge = {
  challengeId: string;
  challenge: unknown;
  message: string;
  expiresAt: string;
};

export type RelayAuthResult = {
  token: string;
  expiresAt: string;
  address: string;
  chain: ChatChain;
  deviceId: string;
};

type ChallengeRequest = {
  chain: ChatChain;
  address: string;
  deviceId: string;
  devicePublicKey: string;
};

export class RelayError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
    this.name = 'RelayError';
  }
}

const DEFAULT_BASE = '/api/v1/chat';
const MAX_ENVELOPE_BASE64 = 96 * 1024;

function configuredBase() {
  const explicit = String(import.meta.env.VITE_CHAT_API_URL ?? '').trim();
  const shared = String(import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
  const value = explicit || (shared ? `${shared}/chat` : '');
  return (value || DEFAULT_BASE).replace(/\/+$/, '');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isChain(value: unknown): value is ChatChain {
  return value === 'EVM' || value === 'SOL' || value === 'TRON';
}

function isIsoDate(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function unwrapData(value: unknown): unknown {
  return isObject(value) && 'data' in value ? value.data : value;
}

function relayMessage(value: unknown, fallback: string) {
  if (!isObject(value) || typeof value.error !== 'string') return fallback;
  const known: Record<string, string> = {
    CHAT_UNAUTHORIZED: '聊天身份会话无效或已过期',
    CHAT_TOKEN_REQUIRED: '聊天身份会话无效或已过期',
    CHAT_RECIPIENT_UNAVAILABLE: '对方消息设备当前不可用',
    CHAT_RECIPIENT_NOT_FOUND: '对方消息设备当前不可用',
    CHAT_DEVICE_REVOKED: '本设备消息权限已被撤销',
    CHAT_DEVICE_INACTIVE: '本设备消息权限已失效',
    CHAT_MESSAGE_ID_CONFLICT: '密文消息编号发生冲突',
    CHAT_RATE_LIMITED: '聊天请求过于频繁，请稍后重试',
  };
  return known[value.error] ?? fallback;
}

function isBase64Key(value: unknown) {
  if (typeof value !== 'string') return false;
  try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)).length === 32; }
  catch { return false; }
}

function parseDevice(value: unknown, fallbackUpdatedAt?: string): RelayDevice {
  const updatedAt = isObject(value) && isIsoDate(value.updatedAt) ? value.updatedAt as string : fallbackUpdatedAt;
  if (!isObject(value)
    || typeof value.deviceId !== 'string'
    || !isChain(value.chain)
    || typeof value.address !== 'string'
    || !isBase64Key(value.publicKey)
    || !isIsoDate(updatedAt)
    || (value.revokedAt !== undefined && !isIsoDate(value.revokedAt))) throw new RelayError('中继返回了无效的设备目录记录');
  return { deviceId: value.deviceId, chain: value.chain, address: value.address, publicKey: value.publicKey, updatedAt, ...(typeof value.revokedAt === 'string' ? { revokedAt: value.revokedAt } : {}) } as RelayDevice;
}

function parseEnvelope(value: unknown): RelayIncomingEnvelope {
  if (!isObject(value)
    || value.version !== 1
    || typeof value.messageId !== 'string'
    || typeof value.conversationId !== 'string'
    || typeof value.senderDeviceId !== 'string'
    || typeof value.recipientDeviceId !== 'string'
    || !isIsoDate(value.timestamp)
    || typeof value.salt !== 'string'
    || typeof value.iv !== 'string'
    || typeof value.ciphertext !== 'string'
    || value.ciphertext.length > MAX_ENVELOPE_BASE64
    || !isObject(value.sender)) throw new RelayError('中继返回了无效的密文信封');
  const sender = parseDevice(value.sender, isIsoDate(value.receivedAt) ? value.receivedAt as string : value.timestamp as string);
  if (sender.deviceId !== value.senderDeviceId) throw new RelayError('密文信封的发送设备不匹配');
  return { ...(value as unknown as RelayIncomingEnvelope), sender };
}

async function parseResponse(response: Response) {
  let body: unknown = null;
  try { body = await response.json(); } catch { /* A failed relay may not return JSON. */ }
  if (!response.ok) throw new RelayError(relayMessage(body, response.status === 401 ? '聊天身份会话已过期' : '聊天中继请求失败'), response.status);
  return unwrapData(body);
}

export async function validateServerChallenge(value: RelayAuthChallenge, request: ChallengeRequest, now = new Date()) {
  const expiry = Date.parse(value.expiresAt);
  if (!value.challengeId || !value.message || !Number.isFinite(expiry) || expiry <= now.getTime() || expiry > now.getTime() + 5 * 60_000 + 30_000) return false;
  const message = value.message, addressBound = request.chain === 'EVM' ? message.toLowerCase().includes(request.address.toLowerCase()) : message.includes(request.address);
  if (!message.includes('wallet.br.com') || !message.includes(request.chain) || !addressBound || !message.includes(request.deviceId)) return false;
  const keyBytes = Uint8Array.from(atob(request.devicePublicKey), character => character.charCodeAt(0));
  const keyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const keyBound = message.includes(request.devicePublicKey) || message.toLowerCase().includes(keyHash);
  const purposeBound = message.includes('chat-device-bind') || /encrypted chat relay/i.test(message);
  const noTransactionAuthority = /does not authorize a transaction|cannot authorize a transaction/i.test(message);
  return keyBound && purposeBound && noTransactionAuthority && !/eth_sendTransaction|wallet_sendCalls|signTransaction/i.test(message);
}

export function relaySessionUsable(expiresAt: string | undefined, now = Date.now()) {
  return Boolean(expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt!) > now + 15_000);
}

export function createRelayClient(base = configuredBase(), fetcher: typeof fetch = fetch) {
  const root = base.replace(/\/+$/, '') || DEFAULT_BASE;

  async function request(path: string, init: RequestInit = {}, token?: string) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetcher(`${root}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()) ? { 'x-lightning-csrf': '1' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
      return await parseResponse(response);
    } catch (cause) {
      if (cause instanceof RelayError) throw cause;
      throw new RelayError(cause instanceof DOMException && cause.name === 'AbortError' ? '聊天中继响应超时' : '聊天中继当前不可用');
    } finally { globalThis.clearTimeout(timer); }
  }

  return {
    base: root,
    async challenge(input: ChallengeRequest) {
      if (input.chain === 'TRON') throw new RelayError('聊天身份暂不支持 TRON 签名绑定');
      const data = await request('/auth/challenge', { method: 'POST', body: JSON.stringify(input) });
      if (!isObject(data) || typeof data.challengeId !== 'string' || typeof data.message !== 'string' || data.message.length > 10_000 || !isIsoDate(data.expiresAt)) throw new RelayError('聊天中继返回了无效的身份挑战');
      const challenge = data as RelayAuthChallenge;
      if (!await validateServerChallenge(challenge, input)) throw new RelayError('聊天中继身份挑战未绑定当前域名、钱包或设备');
      return challenge;
    },
    async verify(challengeId: string, signature: string) {
      const data = await request('/auth/verify', { method: 'POST', body: JSON.stringify({ challengeId, signature }) });
      if (!isObject(data) || typeof data.token !== 'string' || data.token.length < 20 || data.token.length > 4_096 || !isIsoDate(data.expiresAt) || !relaySessionUsable(data.expiresAt as string) || typeof data.address !== 'string' || !isChain(data.chain) || typeof data.deviceId !== 'string') throw new RelayError('聊天中继返回了无效的身份会话');
      return data as RelayAuthResult;
    },
    async registerDevice(token: string, identity: { chain: ChatChain; address: string }, device: ChatDevice) {
      await request(`/devices/${encodeURIComponent(device.id)}`, { method: 'PUT', body: JSON.stringify({ chain: identity.chain, address: identity.address, publicKey: device.publicKey }) }, token);
    },
    async devices(chain: ChatChain, address: string, token?: string) {
      const data = await request(`/devices?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`, {}, token);
      const items = Array.isArray(data) ? data : isObject(data) && Array.isArray(data.items) ? data.items : null;
      if (!items || items.length > 100) throw new RelayError('聊天中继返回了无效的设备目录');
      return items.map(item => parseDevice(item)).filter(device => !device.revokedAt).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },
    async send(token: string, envelope: ChatEnvelope) {
      const data = await request('/messages', { method: 'POST', body: JSON.stringify(envelope) }, token);
      if (!isObject(data) || data.messageId !== envelope.messageId) throw new RelayError('聊天中继未确认密文投递');
      return data as { messageId: string; acceptedAt?: string; duplicate?: boolean };
    },
    async poll(token: string, deviceId: string, cursor = '') {
      const query = new URLSearchParams({ deviceId, limit: '50' });
      if (cursor) query.set('cursor', cursor);
      const data = await request(`/messages?${query}`, {}, token);
      if (!isObject(data) || !Array.isArray(data.items) || data.items.length > 100 || (data.cursor !== null && data.cursor !== undefined && typeof data.cursor !== 'string')) throw new RelayError('聊天中继返回了无效的收件箱');
      return { items: data.items.map(parseEnvelope), cursor: typeof data.cursor === 'string' ? data.cursor : '' };
    },
    async ack(token: string, deviceId: string, messageIds: string[]) {
      if (!messageIds.length) return;
      await request('/messages/ack', { method: 'POST', body: JSON.stringify({ deviceId, messageIds }) }, token);
    },
  };
}

export const chatRelay = createRelayClient();
