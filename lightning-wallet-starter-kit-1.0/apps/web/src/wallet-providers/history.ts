import type { TestnetHistory } from './types';

const KEY = 'lightning-provider-history-v2';
const LEGACY_KEY = 'lightning-testnet-provider-history-v1';
const names = new Set(['MetaMask', 'WalletConnect', 'OKX Wallet', 'Rabby', 'Phantom', 'Backpack', 'Solflare', 'TronLink']);
const families = new Set(['EVM', 'SOL', 'TRON']);
const operations = new Set(['connect', 'sign', 'broadcast']);
const statuses = new Set(['connected', 'signed', 'broadcast', 'confirmed', 'rejected', 'failed']);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isHistory(value: unknown): value is TestnetHistory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return isText(row.id) && names.has(String(row.wallet)) && families.has(String(row.family)) && isText(row.network)
    && (row.mode === 'mainnet' || row.mode === 'testnet')
    && isText(row.address) && operations.has(String(row.operation)) && statuses.has(String(row.status)) && isText(row.at)
    && (row.hash === undefined || isText(row.hash));
}

export function loadProviderHistory(storage: Pick<Storage, 'getItem'> = localStorage): TestnetHistory[] {
  try {
    const current: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (Array.isArray(current) && current.some(isHistory)) return current.filter(isHistory).slice(0, 100);
    const legacy: unknown = JSON.parse(storage.getItem(LEGACY_KEY) ?? '[]');
    if (!Array.isArray(legacy)) return [];
    return legacy.map(value => {
      if (!value || typeof value !== 'object') return null;
      const row = value as Record<string, unknown>;
      return { ...row, mode: 'testnet' };
    }).filter(isHistory).slice(0, 100);
  } catch { return []; }
}

export function saveProviderHistory(row: Omit<TestnetHistory, 'id' | 'at'>, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): TestnetHistory[] {
  const { error: _discardedError, ...publicRow } = row;
  const next = [{ ...publicRow, id: crypto.randomUUID(), at: new Date().toISOString() }, ...loadProviderHistory(storage)].slice(0, 100);
  storage.setItem(KEY, JSON.stringify(next));
  return next;
}
