import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareSolanaSwap, solanaSwapTransactionSchema } from './solana-swap.js';

const input = { sellToken: 'So11111111111111111111111111111111111111112', buyToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', sellAmount: '1000000', taker: '11111111111111111111111111111111', slippageBps: 50, priority: 'auto' as const };

afterEach(() => vi.restoreAllMocks());

describe('Solana swap transaction preparation', () => {
  it('accepts only public bounded inputs', () => {
    expect(solanaSwapTransactionSchema.parse(input).taker).toBe(input.taker);
    expect(() => solanaSwapTransactionSchema.parse({ ...input, privateKey: 'blocked' })).toThrow();
    expect(() => solanaSwapTransactionSchema.parse({ ...input, buyToken: input.sellToken })).toThrow();
  });

  it('builds and simulates before returning an unsigned transaction', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ inAmount: '1000000', outAmount: '900000', otherAmountThreshold: '895000', priceImpactPct: '0.001', routePlan: [{ swapInfo: { label: 'Raydium' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ swapTransaction: 'A'.repeat(120), lastValidBlockHeight: 99, prioritizationFeeLamports: 1234 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { value: { err: null, unitsConsumed: 200000 } } }), { status: 200 }));
    await expect(prepareSolanaSwap(input, ['https://rpc.example'])).resolves.toMatchObject({ simulation: { ok: true, unitsConsumed: 200000 }, quote: { provider: 'Jupiter', route: ['Raydium'] } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]?.[1]?.body)).toContain('simulateTransaction');
  });

  it('blocks excessive price impact before transaction construction', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ inAmount: '1', outAmount: '1', otherAmountThreshold: '1', priceImpactPct: '0.031' }), { status: 200 }));
    await expect(prepareSolanaSwap(input, ['https://rpc.example'])).rejects.toThrow('PRICE_IMPACT_BLOCKED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
