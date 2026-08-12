import { describe, expect, it } from 'vitest';
import { quoteApiBase } from './quote';
import { swapPlanPayload, swapResultPayload } from './persistence';
import type { SwapCandidate, SwapRequest } from './types';

const request: SwapRequest = { chain: 'SOL', sellToken: 'So11111111111111111111111111111111111111112', buyToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', sellAmount: '1000000', taker: '11111111111111111111111111111111', slippageBps: 50 };
const quote: SwapCandidate = { provider: 'Jupiter', amountIn: '1000000', amountOut: '150000', minReceived: '149000', priceImpactPct: 0.1, route: ['Raydium'], raw: { transaction: 'must-not-persist' } };

describe('swap audit payloads', () => {
  it('uses the same-origin API in production', () => expect(quoteApiBase({ production: true })).toBe('/api/v1'));
  it('drops raw quote and transaction data from audit plans', () => {
    const payload = swapPlanPayload(request, quote, true, '00000000-0000-4000-8000-000000000021');
    expect(payload).not.toHaveProperty('raw');
    expect(JSON.stringify(payload)).not.toContain('must-not-persist');
  });
  it('maps wallet errors to safe codes', () => {
    expect(swapResultPayload('failed', 'Wallet provider leaked a verbose error')).toEqual({ status: 'failed', errorCode: 'PROVIDER_ERROR' });
    expect(JSON.stringify(swapResultPayload('failed', 'Wallet provider leaked a verbose error'))).not.toContain('verbose');
  });
});
