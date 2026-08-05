import type { FlashLoanContext, FlashLoanHistoryItem } from './types';

const HISTORY_KEY = 'lightning-flash-loan-history-v1';
const MAX_HISTORY_ITEMS = 100;

export function integrationOrigin(appUrl: string): string {
  return new URL(appUrl).origin;
}

export function buildExternalUrl(appUrl: string, context: Pick<FlashLoanContext, 'walletAddress' | 'settings'>): string {
  const url = new URL(appUrl);
  url.searchParams.set('lightningIntegration', '1');
  url.searchParams.set('network', context.settings.network);
  url.searchParams.set('theme', context.settings.theme);
  url.searchParams.set('dryRun', String(context.settings.dryRun));
  if (context.walletAddress) url.searchParams.set('wallet', context.walletAddress);
  return url.toString();
}

export function sanitizeHistory(input: unknown): FlashLoanHistoryItem | null {
  if (!input || typeof input !== 'object') return null;
  const item = input as Record<string, unknown>;
  const status = item.status;
  if (!['dry-run', 'submitted', 'confirmed', 'failed', 'rejected'].includes(String(status))) return null;
  const clean = (value: unknown, max = 160) => typeof value === 'string' ? value.slice(0, max) : undefined;
  return {
    id: clean(item.id, 80) || crypto.randomUUID(),
    createdAt: clean(item.createdAt, 40) || new Date().toISOString(),
    network: 'sepolia',
    walletAddress: clean(item.walletAddress, 80),
    status: status as FlashLoanHistoryItem['status'],
    transactionHash: clean(item.transactionHash, 100),
    protocol: clean(item.protocol, 40),
    asset: clean(item.asset, 40),
    amount: clean(item.amount, 80),
  };
}

export function readHistory(storage: Pick<Storage, 'getItem'> = localStorage): FlashLoanHistoryItem[] {
  try {
    const value = JSON.parse(storage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value.map(sanitizeHistory).filter((item): item is FlashLoanHistoryItem => Boolean(item)).slice(0, MAX_HISTORY_ITEMS) : [];
  } catch { return []; }
}

export function saveHistory(item: FlashLoanHistoryItem, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): FlashLoanHistoryItem[] {
  const next = [item, ...readHistory(storage).filter(existing => existing.id !== item.id)].slice(0, MAX_HISTORY_ITEMS);
  storage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function containsSensitiveFields(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value as object).some(key => /private|mnemonic|seed|secret/i.test(key));
}
