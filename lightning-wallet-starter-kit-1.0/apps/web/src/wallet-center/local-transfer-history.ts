import type { LocalTransferHistoryEntry } from './local-transfer-types';

export const LOCAL_TRANSFER_HISTORY_KEY = 'lightning-wallet.local-transfer-history.v1';
const MAX_HISTORY = 200;
const allowedKeys = new Set(['id', 'walletId', 'chain', 'network', 'from', 'to', 'asset', 'amount', 'hash', 'state', 'createdAt']);

function valid(entry: unknown): entry is LocalTransferHistoryEntry {
  const item = entry as Partial<LocalTransferHistoryEntry> | null;
  return Boolean(item && typeof item === 'object' && !Array.isArray(item)
    && Object.keys(item).every(key => allowedKeys.has(key))
    && typeof item.id === 'string' && item.id
    && typeof item.walletId === 'string' && item.walletId
    && (item.chain === 'EVM' || item.chain === 'SOL' || item.chain === 'TRON')
    && typeof item.network === 'string' && item.network.length <= 64
    && typeof item.from === 'string' && item.from.length <= 128
    && typeof item.to === 'string' && item.to.length <= 128
    && typeof item.asset === 'string' && item.asset.length <= 32
    && typeof item.amount === 'string' && /^\d+(\.\d+)?$/.test(item.amount)
    && typeof item.hash === 'string' && item.hash.length <= 160
    && (item.state === 'submitted' || item.state === 'confirmed')
    && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)));
}

export function loadLocalTransferHistory(storage: Pick<Storage, 'getItem'> = localStorage) {
  try {
    const value: unknown = JSON.parse(storage.getItem(LOCAL_TRANSFER_HISTORY_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(valid).slice(0, MAX_HISTORY) : [];
  } catch {
    return [];
  }
}

export function saveLocalTransferHistory(entries: LocalTransferHistoryEntry[], storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(LOCAL_TRANSFER_HISTORY_KEY, JSON.stringify(entries.filter(valid).slice(0, MAX_HISTORY)));
}

