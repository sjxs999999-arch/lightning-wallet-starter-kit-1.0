import type { FlashLoanContext, FlashLoanHistoryItem } from './types';

export const SEPOLIA_CHAIN_ID = '0xaa36a7';
export const MAX_FLASH_LOAN_SESSION_SECONDS = 5 * 60;

export type FlashLoanEthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type MessageTarget = {
  postMessage(message: unknown, targetOrigin: string): void;
};

export function integrationOrigin(appUrl: string): string {
  return new URL(appUrl).origin;
}

export function flashLoanHealthReady(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const value = input as Record<string, unknown>;
  return value.status === 'ready' && value.network === 'sepolia' && value.mainnetEnabled === false;
}

export function flashLoanSessionExpiry(now: number, expiresIn: unknown): number {
  const requested = typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? Math.floor(expiresIn) : MAX_FLASH_LOAN_SESSION_SECONDS;
  const seconds = Math.min(MAX_FLASH_LOAN_SESSION_SECONDS, Math.max(1, requested));
  return now + seconds * 1_000;
}

export function flashLoanSessionActive(token: string, expiresAt: number, now = Date.now()): boolean {
  return token.length > 0 && Number.isFinite(expiresAt) && expiresAt > now;
}

export function postFlashLoanContext(target: MessageTarget, context: FlashLoanContext, targetOrigin: string): void {
  if (targetOrigin === '*' || targetOrigin === 'null') throw new Error('A precise Flash Loan origin is required');
  target.postMessage(context, targetOrigin);
}

export function flashLoanMessageOriginAllowed(eventOrigin: string, targetOrigin: string): boolean {
  return targetOrigin !== '*' && targetOrigin !== 'null' && eventOrigin === targetOrigin;
}

function chainId(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('FLASH_LOAN_CHAIN_UNAVAILABLE');
  return value.toLowerCase();
}

function account(value: unknown): string {
  if (!Array.isArray(value) || typeof value[0] !== 'string' || !/^0x[0-9a-f]{40}$/i.test(value[0])) throw new Error('FLASH_LOAN_ACCOUNT_UNAVAILABLE');
  return value[0];
}

export async function connectSepoliaWallet(walletProvider: FlashLoanEthereumProvider): Promise<string> {
  const authorizedAccount = account(await walletProvider.request({ method: 'eth_requestAccounts' }));
  const currentChainId = chainId(await walletProvider.request({ method: 'eth_chainId' }));
  if (currentChainId !== SEPOLIA_CHAIN_ID) {
    await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID }] });
  }
  const verifiedChainId = chainId(await walletProvider.request({ method: 'eth_chainId' }));
  if (verifiedChainId !== SEPOLIA_CHAIN_ID) throw new Error('FLASH_LOAN_WRONG_NETWORK');
  const verifiedAccount = account(await walletProvider.request({ method: 'eth_accounts' }));
  if (verifiedAccount.toLowerCase() !== authorizedAccount.toLowerCase()) throw new Error('FLASH_LOAN_ACCOUNT_CHANGED');
  return verifiedAccount;
}

export function buildExternalUrl(appUrl: string, context: Pick<FlashLoanContext, 'settings'>): string {
  const url = new URL(appUrl);
  url.searchParams.set('lightningIntegration', '1');
  url.searchParams.set('network', context.settings.network);
  url.searchParams.set('theme', context.settings.theme);
  url.searchParams.set('dryRun', String(context.settings.dryRun));
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
