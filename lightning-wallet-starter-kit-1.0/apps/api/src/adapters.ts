import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ChainFamily, ChainId, Quote, QuoteRequest } from '@lightning/core';

export interface WalletAdapter { family: ChainFamily; generate(): { address: string; encryptedMaterial: string }; validateAddress(address: string): boolean }
const material = () => randomBytes(32).toString('hex');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const adapters: Record<ChainFamily, WalletAdapter> = {
  evm: { family: 'evm', generate: () => { const m=material(); return { address: `0x${digest(m).slice(0,40)}`, encryptedMaterial: `IMPORT_AND_ENCRYPT:${m}` }; }, validateAddress: a => /^0x[a-fA-F0-9]{40}$/.test(a) },
  solana: { family: 'solana', generate: () => { const m=material(); return { address: `So${digest(m).slice(0,42)}`, encryptedMaterial: `IMPORT_AND_ENCRYPT:${m}` }; }, validateAddress: a => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) },
  tron: { family: 'tron', generate: () => { const m=material(); return { address: `T${digest(m).slice(0,33)}`, encryptedMaterial: `IMPORT_AND_ENCRYPT:${m}` }; }, validateAddress: a => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) }
};
export function familyFor(chain: ChainId): ChainFamily { return chain === 'solana' ? 'solana' : chain === 'tron' ? 'tron' : 'evm'; }
export async function swapQuote(req: QuoteRequest): Promise<Quote> {
  return { provider: process.env.SWAP_PROVIDER_URL ? 'configured-provider' : 'development-adapter', amountIn: req.amount, amountOut: String(Number(req.amount) * 0.997), route: [req.sellToken, req.buyToken], expiresAt: new Date(Date.now()+30_000).toISOString() };
}
export const operationId = () => randomUUID();
