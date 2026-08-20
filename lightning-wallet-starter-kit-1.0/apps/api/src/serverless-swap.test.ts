import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error Production Vercel helper is intentionally plain ESM JavaScript.
import { fetchLiFiEvmCandidate, normalizeLiFiEvmQuote, normalizeZeroXQuote } from '../../web/public/api/v1/lifi-swap-lib.js';
// @ts-expect-error Production Vercel route policy is intentionally plain ESM JavaScript.
import { routeRequiresAuth } from '../../web/public/api/v1/route-policy.js';

const input = { chain: 'EVM', chainId: 1, sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', sellAmount: '1000000', taker: '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a', slippageBps: 50 };
const quote = { id: 'quote-1', tool: 'sushiswap', toolDetails: { name: 'SushiSwap Aggregator' }, action: { fromChainId: 1, toChainId: 1, fromAmount: input.sellAmount, fromAddress: input.taker, toAddress: input.taker, fromToken: { address: input.sellToken, symbol: 'USDC' }, toToken: { address: input.buyToken, symbol: 'WETH' } }, estimate: { fromAmount: input.sellAmount, toAmount: '436232556501834', toAmountMin: '434051393719324', approvalAddress: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', fromAmountUSD: '0.9993', toAmountUSD: '0.9960', feeCosts: [{ amountUSD: '0.0025' }], gasCosts: [{ amountUSD: '0.7592' }] }, transactionRequest: { chainId: 1, from: input.taker, to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', data: '0x1234', value: '0', gasLimit: '651253' } };

describe('Vercel public EVM Swap parity', () => {
  it('keeps status and metadata-only quotes public while jobs stay operator protected', () => {
    expect(routeRequiresAuth('GET', 'swap/status')).toBe(false);
    expect(routeRequiresAuth('POST', 'swap/quotes')).toBe(false);
    expect(routeRequiresAuth('POST', 'swap/jobs')).toBe(true);
  });

  it('strictly normalizes matching same-chain transaction data', () => {
    expect(normalizeLiFiEvmQuote(input, quote, 1_700_000_000_000)).toMatchObject({ provider: 'LI.FI / SushiSwap Aggregator', amountIn: input.sellAmount, feeUsd: '0.0025', gasCostUsd: '0.7592', transaction: { to: quote.transactionRequest.to, data: '0x1234', value: '0x0' }, raw: { source: 'LI.FI', sameChain: true } });
    expect(() => normalizeLiFiEvmQuote(input, { ...quote, action: { ...quote.action, fromAddress: '0x1311897252Bd6D7E5705443D9e7c32eE22E73067' } })).toThrow(/MISMATCH/);
  });

  it('fails closed on malformed optional 0x execution data', () => {
    const raw = { sellAmount: input.sellAmount, buyAmount: '436232556501834', minBuyAmount: '434051393719324', estimatedPriceImpact: '0.002', issues: { allowance: { spender: quote.estimate.approvalAddress } }, route: { fills: [{ source: 'Uniswap_V3' }] }, transaction: { chainId: 1, from: input.taker, to: quote.transactionRequest.to, data: '0x1234', value: '0', gas: '500000' } };
    expect(normalizeZeroXQuote(input, raw)).toMatchObject({ provider: '0x', amountIn: input.sellAmount, transaction: { data: '0x1234', value: '0x0' } });
    expect(() => normalizeZeroXQuote(input, { ...raw, transaction: { ...raw.transaction, to: 'not-an-address' } })).toThrow(/MISMATCH/);
    expect(() => normalizeZeroXQuote(input, { ...raw, minBuyAmount: '999999999999999' })).toThrow(/MISMATCH/);
  });

  it('does not send secret or signing fields to LI.FI', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(quote), { status: 200 }));
    await fetchLiFiEvmCandidate(input, fetcher, {});
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('fromChain=1&toChain=1');
    expect(JSON.stringify(fetcher.mock.calls[0])).not.toMatch(/privateKey|mnemonic|seed|signature/i);
  });

  it('rate-limits the anonymous route without requiring an operator session', () => {
    const source = readFileSync(new URL('../../web/public/api/v1/[...path].js', import.meta.url), 'utf8');
    const route = source.slice(source.indexOf("if(method==='POST'&&route==='swap/quotes')"), source.indexOf("if(method==='POST'&&route==='swap/jobs')"));
    expect(route).toContain('swap-quotes:');
    expect(route).toContain("interval '1 minute'");
    expect(route).toContain('SWAP_QUOTE_RATE_LIMIT');
    expect(route).not.toContain('requireAuth');
  });
});
