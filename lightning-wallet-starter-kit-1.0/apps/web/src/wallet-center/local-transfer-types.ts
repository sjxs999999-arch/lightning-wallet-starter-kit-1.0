import type { BatchChain, EncryptedValue } from '../batch-wallet/types';

export type LocalTransferAsset = {
  symbol: string;
  address?: string;
  decimals: number;
};

export type LocalTransferDraft = {
  walletId: string;
  chain: BatchChain;
  from: string;
  to: string;
  amount: string;
  asset: LocalTransferAsset;
};

export type LocalSigningPayload =
  | { chain: 'EVM'; transaction: Record<string, string | number> }
  | { chain: 'SOL'; transaction: string }
  | { chain: 'TRON'; transaction: Record<string, unknown> };

export type LocalSigningWallet = {
  id: string;
  chain: BatchChain;
  address: string;
  encryptedPrivateKey: EncryptedValue;
};

export type LocalTransferPlan = {
  id: string;
  createdAt: string;
  expiresAt: string;
  network: string;
  draft: LocalTransferDraft;
  feeLabel: string;
  risk: string[];
  signingPayload: LocalSigningPayload;
  confirmation?: { blockhash: string; lastValidBlockHeight: number };
};

export type LocalSignedPayload =
  | { chain: 'EVM'; signedTransaction: string }
  | { chain: 'SOL'; signedTransaction: ArrayBuffer }
  | { chain: 'TRON'; signedTransaction: Record<string, unknown> };

export type LocalTransferHistoryEntry = {
  id: string;
  walletId: string;
  chain: BatchChain;
  network: string;
  from: string;
  to: string;
  asset: string;
  amount: string;
  hash: string;
  state: 'submitted' | 'confirmed';
  createdAt: string;
};

