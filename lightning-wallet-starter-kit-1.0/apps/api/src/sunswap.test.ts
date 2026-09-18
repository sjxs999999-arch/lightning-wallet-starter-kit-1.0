import { describe, expect, it, vi } from 'vitest';
import { fetchSunSwapCandidates, normalizeSunSwapRoutes, type SwapQuoteInput } from './swap.js';

const input: SwapQuoteInput = {
  chain: 'TRON',
  sellToken: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
  buyToken: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  sellAmount: '1000000',
  sellDecimals: 6,
  taker: 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA',
  slippageBps: 50,
};

const route = {
  amountIn: '1.000000', amountInRaw: '1000000', amountOut: '0.340000', amountOutRaw: '340000', amountOutMinimum: '0.340000', amountOutMinimumRaw: '340000',
  inUsd: '0.34', outUsd: '0.339', impact: '-0.0215', fee: '0.0005', containsUnverifiedHook: false,
  tokens: [input.sellToken, 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', input.buyToken],
  symbols: ['TRX', 'WTRX', 'USDT'], poolFees: ['0', '500', '0'], poolVersions: ['v2', 'v3'], poolKeys: [null, null], stepAmountsOut: ['1.000000', '0.340000'],
};

const v4Route = {
  ...route,
  tokens: [input.sellToken, input.buyToken], symbols: ['TRX', 'USDT'], poolFees: ['500', '0'], poolVersions: ['v4'], stepAmountsOut: ['0.340000'],
  poolKeys: [{ token0: input.sellToken, token1: input.buyToken, hooks: input.sellToken, fee: 500, parameters: '0x00000000000000000000000000000000000000000000000000000000000a0000' }],
};

describe('SUN.io Smart Router normalization', () => {
  it('keeps only verified matching routes and applies an exact slippage floor', () => {
    const candidates = normalizeSunSwapRoutes(input, { code: 0, data: [route, { ...route, containsUnverifiedHook: true }, { ...route, amountInRaw: '999999' }] });
    expect(candidates).toEqual([{
      provider: 'SUN.io Smart Router', amountIn: '1000000', amountOut: '340000', minReceived: '338300', priceImpactPct: 2.15,
      route: ['TRX', 'WTRX', 'USDT'], display: { amountIn: '1', amountOut: '0.34', minReceived: '0.3383', sellSymbol: 'TRX', buySymbol: 'USDT', sellDecimals: 6, buyDecimals: 6, usdValuationAvailable: true }, raw: { source: 'SUN.io Smart Router', network: 'mainnet', poolVersions: ['v2', 'v3'], verifiedHooksOnly: true, sunRoute: route },
    }]);
  });

  it('requests the official mainnet router without forwarding wallet secrets', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: [route] }), { status: 200 }));
    await expect(fetchSunSwapCandidates(input, fetcher)).resolves.toHaveLength(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('https://rot.endjgfsv.link/swap/routerUniversal?');
    expect(String(url)).toContain('includeUnverifiedV4Hook=false');
    expect(String(url)).not.toMatch(/private|mnemonic|seed/i);
    expect(init?.method).toBe('GET');
  });

  it('accepts a no-hook V4 pool but rejects a non-zero hook or malformed pool key', () => {
    expect(normalizeSunSwapRoutes(input, { code: 0, data: [v4Route] })).toHaveLength(1);
    expect(normalizeSunSwapRoutes(input, { code: 0, data: [{ ...v4Route, poolKeys: [{ ...v4Route.poolKeys[0], hooks: input.buyToken }] }] })).toHaveLength(0);
    expect(normalizeSunSwapRoutes(input, { code: 0, data: [{ ...v4Route, poolKeys: [{ ...v4Route.poolKeys[0], unexpected: true }] }] })).toHaveLength(0);
  });

  it('fails closed when the router returns only mismatched or unverified routes', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: [{ ...route, containsUnverifiedHook: true }] }), { status: 200 }));
    await expect(fetchSunSwapCandidates(input, fetcher)).rejects.toThrow('no verified route');
  });

  it('treats SUN impact as a ratio, formats atomic units, and rejects a decimals mismatch', () => {
    const productionRoute = { ...route, amountIn: '30.000000', amountInRaw: '30000000', amountOut: '29.943919', amountOutRaw: '29943919', amountOutMinimum: '29.943919', amountOutMinimumRaw: '29943919', impact: '-0.000068', inUsd: '29.98', outUsd: '0', tokens: [input.sellToken, input.buyToken], symbols: ['USDT', 'Usclt'], poolFees: ['500', '0'], poolVersions: ['v3'], poolKeys: [null], stepAmountsOut: ['29.943919'] };
    const correct = normalizeSunSwapRoutes({ ...input, sellAmount: '30000000' }, { code: 0, data: [productionRoute] });
    expect(correct[0]).toMatchObject({ priceImpactPct: 0.0068, display: { amountIn: '30', amountOut: '29.943919', minReceived: '29.794199', sellDecimals: 6, buyDecimals: 6, usdValuationAvailable: false } });
    expect(normalizeSunSwapRoutes({ ...input, sellAmount: '30000000000000000000' }, { code: 0, data: [{ ...productionRoute, amountIn: '30000000000000.000000', amountInRaw: '30000000000000000000', amountOut: '2340.053542', amountOutRaw: '2340053542', impact: '-0.999500' }] })[0]?.priceImpactPct).toBe(99.95);
    expect(normalizeSunSwapRoutes({ ...input, sellDecimals: 18 }, { code: 0, data: [route] })).toEqual([]);
  });
});
