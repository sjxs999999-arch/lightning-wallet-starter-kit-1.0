import { describe, expect, it } from 'vitest';
import { revalidatedEvmQuote } from './executor';
import type { SwapCandidate, SwapRequest } from './types';

const request: SwapRequest = { chain: 'EVM', chainId: 1, sellToken: '0x1111111111111111111111111111111111111111', buyToken: '0x2222222222222222222222222222222222222222', sellAmount: '1000000', taker: '0x3333333333333333333333333333333333333333', slippageBps: 50 };
const selected: SwapCandidate = { provider: 'LI.FI / SushiSwap', amountIn: '1000000', amountOut: '500000', minReceived: '497500', priceImpactPct: 0.2, route: ['sushiswap'], transaction: { to: '0x4444444444444444444444444444444444444444', data: '0x1234' }, raw: {} };

describe('EVM Swap pre-signature quote revalidation', () => {
  it('accepts a fresh route from the same aggregator family', () => {
    const fresh = { ...selected, provider: 'LI.FI / 1inch', amountOut: '501000', minReceived: '498000', expiresAt: '2027-01-01T00:00:00.000Z' };
    expect(revalidatedEvmQuote(request, selected, [fresh], Date.parse('2026-01-01T00:00:00.000Z'))).toBe(fresh);
  });

  it('fails closed on provider loss, reduced minimum, high impact, invalid calldata or expiry', () => {
    expect(() => revalidatedEvmQuote(request, selected, [{ ...selected, provider: '0x' }])).toThrow(/同一 Provider/);
    expect(() => revalidatedEvmQuote(request, selected, [{ ...selected, minReceived: '497499' }])).toThrow(/最低收到/);
    expect(() => revalidatedEvmQuote(request, selected, [{ ...selected, priceImpactPct: 3.01 }])).toThrow(/价格影响/);
    expect(() => revalidatedEvmQuote(request, selected, [{ ...selected, transaction: undefined }])).toThrow(/交易数据/);
    expect(() => revalidatedEvmQuote(request, selected, [{ ...selected, expiresAt: '2026-01-01T00:00:04.000Z' }], Date.parse('2026-01-01T00:00:00.000Z'))).toThrow(/过期/);
  });
});
