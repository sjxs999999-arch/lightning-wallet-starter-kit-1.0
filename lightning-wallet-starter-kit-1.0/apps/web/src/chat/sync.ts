import { decryptEnvelope, encryptEnvelope, fingerprint } from './crypto';
import { verifyPaymentRequest } from './payment';
import { sensitiveMaterialReason } from './safety';
import type { ChatContact, ChatEnvelope, ChatMessage, ChatSnapshot, PaymentRequest, RelayDevice, RelayIncomingEnvelope } from './types';

type PlainMessage = {
  version: 1;
  kind: 'text' | 'payment-request';
  text: string;
  createdAt: string;
  payment?: PaymentRequest;
};

function sameAddress(left: string, right: string) { return left.toLowerCase() === right.toLowerCase(); }
function short(value: string) { return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value; }

function decodePlain(value: string): PlainMessage {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('消息格式无效');
  const item = parsed as Partial<PlainMessage>;
  if (item.version !== 1 || (item.kind !== 'text' && item.kind !== 'payment-request') || typeof item.text !== 'string' || item.text.length > 10_000 || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) throw new Error('消息格式无效');
  return item as PlainMessage;
}

export async function queueEncryptedMessage(snapshot: ChatSnapshot, contact: ChatContact, plain: Omit<PlainMessage, 'version'>): Promise<ChatSnapshot> {
  if (!snapshot.device) throw new Error('本设备消息密钥不可用');
  if (!contact.deviceId || !contact.devicePublicKey) throw new Error('对方尚未发布可用的消息设备公钥');
  if (contact.deviceChanged) throw new Error('对方设备密钥已变化，重新核对前禁止发送');
  if (!plain.text || plain.text.length > 10_000) throw new Error('消息内容必须在 10,000 字符以内');
  const sensitive = sensitiveMaterialReason(JSON.stringify(plain));
  if (sensitive) throw new Error(sensitive);
  const id = crypto.randomUUID(), createdAt = plain.createdAt || new Date().toISOString(), conversationId = contact.conversationId ?? crypto.randomUUID();
  const envelope = await encryptEnvelope(JSON.stringify({ ...plain, version: 1, createdAt }), snapshot.device.privateKey, contact.devicePublicKey, {
    version: 1,
    messageId: id,
    conversationId,
    senderDeviceId: snapshot.device.id,
    recipientDeviceId: contact.deviceId,
    timestamp: createdAt,
  });
  const message: ChatMessage = { id, contactId: contact.id, direction: 'outgoing', kind: plain.kind, text: plain.text, createdAt, state: 'queued', payment: plain.payment };
  return {
    ...snapshot,
    contacts: snapshot.contacts.map(item => item.id === contact.id ? { ...item, conversationId } : item),
    messages: [...snapshot.messages, message],
    outbox: [...(snapshot.outbox ?? []), { messageId: id, contactId: contact.id, envelope, attempts: 0 }],
  };
}

export async function flushEncryptedOutbox(snapshot: ChatSnapshot, send: (envelope: ChatEnvelope) => Promise<unknown>) {
  const retained = [] as NonNullable<ChatSnapshot['outbox']>;
  const state = new Map<string, Pick<ChatMessage, 'state' | 'error'>>();
  for (const item of snapshot.outbox ?? []) {
    const contact = snapshot.contacts.find(candidate => candidate.id === item.contactId);
    if (!contact || contact.deviceChanged || contact.deviceId !== item.envelope.recipientDeviceId) {
      const error = contact?.deviceChanged ? '设备密钥变化，投递已暂停' : '收件设备已不可用';
      retained.push({ ...item, lastError: error }); state.set(item.messageId, { state: 'failed', error }); continue;
    }
    try {
      await send(item.envelope);
      state.set(item.messageId, { state: 'sent', error: undefined });
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : '密文投递失败';
      retained.push({ ...item, attempts: item.attempts + 1, lastAttemptAt: new Date().toISOString(), lastError: error });
      state.set(item.messageId, { state: 'failed', error });
    }
  }
  return {
    ...snapshot,
    outbox: retained,
    messages: snapshot.messages.map(message => state.has(message.id) ? { ...message, ...state.get(message.id)! } : message),
  };
}

async function bindFirstDevice(contact: ChatContact, sender: RelayDevice): Promise<ChatContact> {
  return { ...contact, deviceId: sender.deviceId, devicePublicKey: sender.publicKey, deviceUpdatedAt: sender.updatedAt, fingerprint: await fingerprint(sender.publicKey) };
}

function holdChangedDevice(contact: ChatContact, sender: RelayDevice): ChatContact {
  return { ...contact, deviceChanged: true, pendingDeviceId: sender.deviceId, pendingDevicePublicKey: sender.publicKey, pendingDeviceUpdatedAt: sender.updatedAt };
}

export async function mergeEncryptedInbox(snapshot: ChatSnapshot, incoming: RelayIncomingEnvelope[]) {
  if (!snapshot.device) return { snapshot, ackIds: [] as string[] };
  const contacts = [...snapshot.contacts], messages = [...snapshot.messages];
  const pending = [...(snapshot.pendingInbox ?? [])], seen = new Set(snapshot.seenMessageIds ?? []), ackIds: string[] = [];
  const alreadyPending = new Set(pending.map(item => item.messageId));

  for (const envelope of incoming) {
    if (seen.has(envelope.messageId) || messages.some(message => message.id === envelope.messageId)) { ackIds.push(envelope.messageId); continue; }
    if (envelope.recipientDeviceId !== snapshot.device.id) continue;
    let index = contacts.findIndex(contact => contact.chain === envelope.sender.chain && sameAddress(contact.address, envelope.sender.address));
    if (index < 0) {
      contacts.push({ id: crypto.randomUUID(), name: `陌生地址 ${short(envelope.sender.address)}`, chain: envelope.sender.chain, address: envelope.sender.address, trust: 'unknown', fingerprint: await fingerprint(envelope.sender.publicKey), conversationId: envelope.conversationId, deviceId: envelope.sender.deviceId, devicePublicKey: envelope.sender.publicKey, deviceUpdatedAt: envelope.sender.updatedAt });
      index = contacts.length - 1;
    }
    let contact = contacts[index]!;
    if (contact.trust === 'blocked') { seen.add(envelope.messageId); ackIds.push(envelope.messageId); continue; }
    if (!contact.conversationId) { contact = { ...contact, conversationId: envelope.conversationId }; contacts[index] = contact; }
    if (!contact.devicePublicKey) { contact = await bindFirstDevice(contact, envelope.sender); contacts[index] = contact; }
    else if (contact.deviceId !== envelope.sender.deviceId || contact.devicePublicKey !== envelope.sender.publicKey) {
      contacts[index] = holdChangedDevice(contact, envelope.sender);
      if (!alreadyPending.has(envelope.messageId)) { pending.push(envelope); alreadyPending.add(envelope.messageId); }
      continue;
    }

    try {
      const plain = decodePlain(await decryptEnvelope(envelope, snapshot.device.privateKey, contact.devicePublicKey!));
      const sensitive = sensitiveMaterialReason(JSON.stringify(plain));
      if (sensitive) {
        messages.push({ id: envelope.messageId, contactId: contact.id, direction: 'incoming', kind: 'text', text: '收到的消息疑似包含私钥或助记词，已在本地隐藏。', createdAt: plain.createdAt, state: 'sent', error: sensitive });
      } else if (plain.kind === 'payment-request' && (!plain.payment || !await verifyPaymentRequest(plain.payment, envelope.sender))) {
        messages.push({ id: envelope.messageId, contactId: contact.id, direction: 'incoming', kind: 'text', text: '已阻止一条收款地址、网络、金额或有效期不匹配的付款请求。', createdAt: plain.createdAt, state: 'sent', error: '不安全的付款请求' });
      } else {
        messages.push({ id: envelope.messageId, contactId: contact.id, direction: 'incoming', kind: plain.kind, text: plain.text, createdAt: plain.createdAt, state: 'sent', payment: plain.payment });
      }
      seen.add(envelope.messageId); ackIds.push(envelope.messageId);
    } catch {
      messages.push({ id: envelope.messageId, contactId: contact.id, direction: 'incoming', kind: 'text', text: '一条无法验证的密文消息已被丢弃。', createdAt: envelope.timestamp, state: 'sent', error: '消息认证失败' });
      seen.add(envelope.messageId); ackIds.push(envelope.messageId);
    }
  }
  return { snapshot: { ...snapshot, contacts, messages, pendingInbox: pending, seenMessageIds: [...seen].slice(-2_000) }, ackIds };
}

export async function refreshContactDevice(contact: ChatContact, devices: RelayDevice[]) {
  const latest = devices[0];
  if (!latest) return contact;
  if (!contact.devicePublicKey) return bindFirstDevice(contact, latest);
  if (contact.deviceId !== latest.deviceId || contact.devicePublicKey !== latest.publicKey) return holdChangedDevice(contact, latest);
  return { ...contact, deviceUpdatedAt: latest.updatedAt };
}

export async function acceptPendingDevice(snapshot: ChatSnapshot, contactId: string) {
  const contact = snapshot.contacts.find(item => item.id === contactId);
  if (!contact?.pendingDeviceId || !contact.pendingDevicePublicKey) return snapshot;
  const next = {
    ...contact,
    trust: 'unknown' as const,
    deviceId: contact.pendingDeviceId,
    devicePublicKey: contact.pendingDevicePublicKey,
    deviceUpdatedAt: contact.pendingDeviceUpdatedAt,
    fingerprint: await fingerprint(contact.pendingDevicePublicKey),
    deviceChanged: false,
    pendingDeviceId: undefined,
    pendingDevicePublicKey: undefined,
    pendingDeviceUpdatedAt: undefined,
  };
  return { ...snapshot, contacts: snapshot.contacts.map(item => item.id === contactId ? next : item) };
}
