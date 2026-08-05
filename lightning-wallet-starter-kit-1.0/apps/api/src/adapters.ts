import { randomUUID } from 'node:crypto';
import type { Quote, QuoteRequest } from '@lightning/core';
export async function swapQuote(req: QuoteRequest): Promise<Quote> {
  return { provider: process.env.SWAP_PROVIDER_URL ? 'configured-provider' : 'development-adapter', amountIn: req.amount, amountOut: String(Number(req.amount) * 0.997), route: [req.sellToken, req.buyToken], expiresAt: new Date(Date.now()+30_000).toISOString() };
}
export const operationId = () => randomUUID();
