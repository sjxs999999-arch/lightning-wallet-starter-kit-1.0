import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeQuoteSchema, fetchBridgeRoutes } from './bridge.js';

const quote = { fromChainId: 1, toChainId: 42161, fromToken: 'USDC', toToken: 'USDC', fromAmount: '1000000', fromAddress: '0x0000000000000000000000000000000000000001', toAddress: '0x0000000000000000000000000000000000000001', slippageBps: 50, order: 'CHEAPEST' as const };
const boundAction = {
  fromChainId: quote.fromChainId,
  toChainId: quote.toChainId,
  fromAmount: quote.fromAmount,
  fromAddress: quote.fromAddress,
  toAddress: quote.toAddress,
  fromToken: { address: '0x0000000000000000000000000000000000000004', symbol: quote.fromToken },
  toToken: { address: '0x0000000000000000000000000000000000000005', symbol: quote.toToken },
};

afterEach(() => vi.restoreAllMocks());

describe('bridgeQuoteSchema', () => {
  it('accepts a supported non-custodial quote request', () => expect(bridgeQuoteSchema.parse(quote)).toEqual(quote));
  it('rejects same-chain, floating amounts, and excessive slippage', () => {
    expect(() => bridgeQuoteSchema.parse({ ...quote, toChainId: 1 })).toThrow();
    expect(() => bridgeQuoteSchema.parse({ ...quote, fromAmount: '1.5' })).toThrow();
    expect(() => bridgeQuoteSchema.parse({ ...quote, slippageBps: 301 })).toThrow();
  });
  it('rejects unknown fields that could contain secret material', () => expect(() => bridgeQuoteSchema.parse({ ...quote, privateKey: 'never' })).toThrow());
  it('returns a time-bounded signable quote plus the official bridge', async () => {
    const response = { id: 'route', tool: 'across', toolDetails: { name: 'Across' }, action: boundAction, estimate: { fromAmount: '1000000', toAmount: '999000', toAmountMin: '995000', executionDuration: 30, approvalAddress: '0x0000000000000000000000000000000000000003' }, transactionRequest: { from: quote.fromAddress, chainId: quote.fromChainId, to: '0x0000000000000000000000000000000000000002', data: '0x1234', value: '0' } };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));
    const routes = await fetchBridgeRoutes(quote);
    expect(routes[0]).toMatchObject({ kind: 'aggregator', toAmountMin: '995000', transaction: { family: 'EVM', data: '0x1234' }, fromTokenAddress: response.action.fromToken.address });
    expect(routes.filter(route => route.kind === 'aggregator')).toHaveLength(1);
    expect(routes.some(route => route.kind === 'official' && route.officialUrl.includes('arbitrum'))).toBe(true);
  });
  it('normalizes mixed-case EVM identifiers before requesting provider quotes', async () => {
    const mixed = { ...quote, fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', toToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', fromAddress: '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a', toAddress: '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a' };
    const response = { id: 'route', tool: 'across', action: { fromChainId: mixed.fromChainId, toChainId: mixed.toChainId, fromAmount: mixed.fromAmount, fromAddress: mixed.fromAddress.toLowerCase(), toAddress: mixed.toAddress.toLowerCase(), fromToken: { address: mixed.fromToken.toLowerCase() }, toToken: { address: mixed.toToken.toLowerCase() } }, estimate: { fromAmount: '1000000', toAmount: '999000', toAmountMin: '995000' }, transactionRequest: { from: mixed.fromAddress.toLowerCase(), chainId: mixed.fromChainId, to: '0x0000000000000000000000000000000000000002', data: '0x1234', value: '0' } };
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));
    await fetchBridgeRoutes(mixed);
    for (const [url] of fetcher.mock.calls) {
      const value = String(url);
      expect(value).toContain('fromToken=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      expect(value).toContain('toToken=0xaf88d065e77c8cc2239327c5edb3a432268e5831');
      expect(value).toContain('fromAddress=0x42bae181b2fbd5cc8f04762770942c719dd4d30a');
    }
  });
  it('rejects provider payloads that change the requested chain, amount, address or token', async () => {
    const valid = { id: 'route', tool: 'across', action: boundAction, estimate: { fromAmount: quote.fromAmount, toAmount: '999000' }, transactionRequest: { from: quote.fromAddress, chainId: quote.fromChainId, to: '0x0000000000000000000000000000000000000002', data: '0x1234', value: '0' } };
    for (const response of [
      { ...valid, action: { ...boundAction, toChainId: 10 } },
      { ...valid, action: { ...boundAction, fromAmount: '999999' } },
      { ...valid, action: { ...boundAction, toAddress: '0x0000000000000000000000000000000000000009' } },
      { ...valid, action: { ...boundAction, fromToken: { symbol: 'DAI' } } },
      { ...valid, transactionRequest: { ...valid.transactionRequest, from: '0x0000000000000000000000000000000000000009' } },
    ]) {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));
      const routes = await fetchBridgeRoutes(quote);
      expect(routes.every(route => route.kind === 'official')).toBe(true);
      vi.restoreAllMocks();
    }
  });
});
