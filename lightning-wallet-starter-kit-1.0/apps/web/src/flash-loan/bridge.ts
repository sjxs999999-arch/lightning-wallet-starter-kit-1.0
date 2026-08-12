import type { FlashLoanContext, FlashLoanHistoryItem } from './types';

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
  if (!['dry-run', 'failed', 'rejected'].includes(String(status))) return null;
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

export function containsSensitiveFields(value: unknown, seen = new WeakSet<object>(), depth = 0): boolean {
  if (!value || typeof value !== 'object') return false;
  if (depth > 8 || seen.has(value)) return depth > 8;
  seen.add(value);
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => /private|mnemonic|seed|secret/i.test(key) || containsSensitiveFields(nested, seen, depth + 1));
}
