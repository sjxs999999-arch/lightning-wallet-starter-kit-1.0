import { safeErrorCode } from '../batch-transfer/persistence';
import type { TransferErrorCode } from '../batch-transfer/persistence';
import type { SwapCandidate, SwapRequest } from './types';

export type SwapJob = {
  id: string;
  kind: 'swap';
  status: 'validated' | 'completed' | 'failed';
  payload: { chain: string; dryRun: boolean; taker: string; sellToken: string; buyToken: string; sellAmount: string; slippageBps: number; provider: string; amountIn: string; amountOut: string; minReceived: string; priceImpactPct: number; route: string[] };
  result: { status: 'validated' | 'simulated' | 'submitted' | 'failed'; dryRun: boolean; serverSigning: false; serverBroadcast: false; broadcastByWallet?: boolean; txHash?: string; errorCode?: TransferErrorCode };
  created_at: string;
  updated_at: string;
};

export function swapPlanPayload(request: SwapRequest, quote: SwapCandidate, dryRun: boolean, idempotencyKey: string) {
  return { idempotencyKey, chain: request.chain, dryRun, taker: request.taker, sellToken: request.sellToken, buyToken: request.buyToken, sellAmount: request.sellAmount, slippageBps: request.slippageBps, provider: quote.provider, amountIn: quote.amountIn, amountOut: quote.amountOut, minReceived: quote.minReceived, priceImpactPct: quote.priceImpactPct, route: quote.route.slice(0, 12) };
}

export function swapResultPayload(status: 'simulated' | 'submitted' | 'failed', value?: string) {
  if (status === 'simulated') return { status };
  if (status === 'submitted') {
    const txHash = value?.trim();
    return { status, txHash: txHash && /^[A-Za-z0-9:_-]{8,128}$/.test(txHash) ? txHash : 'CLIENT-SWAP-REFERENCE' };
  }
  return { status, errorCode: safeErrorCode(value) };
}
