import { x25519 } from '@noble/curves/ed25519.js';
import type { ChatDevice, ChatEnvelope, ChatEnvelopeMetadata, ChatSnapshot, EncryptedVault } from './types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (value: Uint8Array<ArrayBuffer>) => {
  let text = '';
  for (const byte of value) text += String.fromCharCode(byte);
  return btoa(text);
};

const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSnapshot(snapshot: ChatSnapshot, password: string): Promise<EncryptedVault> {
  if (password.length < 12) throw new Error('保险库密码至少需要 12 个字符');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode('lightning-chat-v1') },
    key,
    encoder.encode(JSON.stringify(snapshot)),
  );
  return { version: 1, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)), updatedAt: new Date().toISOString() };
}

export async function decryptSnapshot(vault: EncryptedVault, password: string): Promise<ChatSnapshot> {
  if (vault.version !== 1) throw new Error('不支持的聊天保险库版本');
  try {
    const salt = fromBase64(vault.salt);
    const iv = fromBase64(vault.iv);
    const key = await deriveKey(password, salt);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode('lightning-chat-v1') },
      key,
      fromBase64(vault.ciphertext),
    );
    const snapshot = JSON.parse(decoder.decode(plaintext)) as ChatSnapshot;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.contacts) || !Array.isArray(snapshot.messages)) throw new Error('保险库格式无效');
    return snapshot;
  } catch {
    throw new Error('密码错误或聊天保险库已损坏');
  }
}

export async function fingerprint(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...digest.slice(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('').match(/.{1,4}/g)?.join(' ') ?? '';
}

export function createChatDevice(): ChatDevice {
  const pair = x25519.keygen();
  return { id: crypto.randomUUID(), publicKey: toBase64(pair.publicKey), privateKey: toBase64(pair.secretKey), createdAt: new Date().toISOString() };
}

async function envelopeKey(privateKey: string, publicKey: string, salt: Uint8Array<ArrayBuffer>) {
  const secret = x25519.getSharedSecret(fromBase64(privateKey), fromBase64(publicKey));
  try {
    const material = await crypto.subtle.importKey('raw', Uint8Array.from(secret), 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('lightning-chat-envelope-v1') },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally { secret.fill(0); }
}

const metadataText = (metadata: ChatEnvelopeMetadata) => JSON.stringify(metadata);

export async function encryptEnvelope(plaintext: string, senderPrivateKey: string, recipientPublicKey: string, metadata: ChatEnvelopeMetadata): Promise<ChatEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await envelopeKey(senderPrivateKey, recipientPublicKey, salt);
  const encoded = encoder.encode(plaintext);
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(metadataText(metadata)) }, key, encoded);
    return { ...metadata, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
  } finally { encoded.fill(0); }
}

export async function decryptEnvelope(envelope: ChatEnvelope, recipientPrivateKey: string, senderPublicKey: string) {
  const { salt, iv, ciphertext, version, messageId, conversationId, senderDeviceId, recipientDeviceId, timestamp } = envelope;
  const metadata: ChatEnvelopeMetadata = { version, messageId, conversationId, senderDeviceId, recipientDeviceId, timestamp };
  const saltBytes = fromBase64(salt), ivBytes = fromBase64(iv), cipherBytes = fromBase64(ciphertext);
  const key = await envelopeKey(recipientPrivateKey, senderPublicKey, saltBytes);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes, additionalData: encoder.encode(metadataText(metadata)) }, key, cipherBytes);
    return decoder.decode(plaintext);
  } catch { throw new Error('消息密文、元数据或设备密钥无效'); }
  finally { saltBytes.fill(0); ivBytes.fill(0); cipherBytes.fill(0); }
}
