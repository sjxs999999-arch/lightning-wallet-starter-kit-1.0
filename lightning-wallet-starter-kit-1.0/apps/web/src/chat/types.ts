export type ChatChain = 'EVM' | 'SOL' | 'TRON';
export type TrustState = 'unknown' | 'trusted' | 'blocked';

export type ChatContact = {
  id: string;
  name: string;
  chain: ChatChain;
  address: string;
  trust: TrustState;
  fingerprint: string;
  conversationId?: string;
  deviceId?: string;
  devicePublicKey?: string;
  deviceUpdatedAt?: string;
  deviceChanged?: boolean;
  pendingDeviceId?: string;
  pendingDevicePublicKey?: string;
  pendingDeviceUpdatedAt?: string;
};

export type ChatDevice = {
  id: string;
  publicKey: string;
  privateKey: string;
  createdAt: string;
};

export type ChatIdentity = {
  chain: ChatChain;
  address: string;
  walletName: string;
  network: string;
  verifiedAt: string;
  signature: string;
};

export type PaymentRequest = {
  requestId: string;
  chain: ChatChain;
  chainId: string;
  asset: string;
  amount: string;
  payTo: string;
  requesterAddress: string;
  expiresAt: string;
  memo: string;
  status: 'pending' | 'rejected' | 'expired' | 'paid';
  signature: string;
};

export type ChatMessage = {
  id: string;
  contactId: string;
  direction: 'incoming' | 'outgoing';
  kind: 'text' | 'payment-request';
  text: string;
  createdAt: string;
  state: 'sent' | 'queued' | 'failed';
  error?: string;
  payment?: PaymentRequest;
};

export type RelaySession = {
  token: string;
  expiresAt: string;
};

export type ChatOutboxItem = {
  messageId: string;
  contactId: string;
  envelope: ChatEnvelope;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
};

export type RelayDevice = {
  deviceId: string;
  chain: ChatChain;
  address: string;
  publicKey: string;
  updatedAt: string;
  revokedAt?: string;
};

export type RelayIncomingEnvelope = ChatEnvelope & {
  sender: RelayDevice;
  receivedAt?: string;
};

export type ChatSnapshot = {
  version: 1;
  device?: ChatDevice;
  identity?: ChatIdentity;
  relay?: RelaySession;
  contacts: ChatContact[];
  messages: ChatMessage[];
  outbox?: ChatOutboxItem[];
  pendingInbox?: RelayIncomingEnvelope[];
  inboxCursor?: string;
  seenMessageIds?: string[];
};

export type ChatEnvelopeMetadata = {
  version: 1;
  messageId: string;
  conversationId: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  timestamp: string;
};

export type ChatEnvelope = ChatEnvelopeMetadata & {
  salt: string;
  iv: string;
  ciphertext: string;
};

export type EncryptedVault = {
  version: 1;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
};
