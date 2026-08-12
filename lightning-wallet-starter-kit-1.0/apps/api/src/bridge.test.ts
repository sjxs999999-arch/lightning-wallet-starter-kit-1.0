import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeQuoteSchema, fetchBridgeRoutes } from './bridge.js';

const quote = { fromChainId: 1, toChainId: 42161, fromToken: 'USDC', toToken: 'USDC', fromAmount: '1000000', fromAddress: '0x0000000000000000000000000000000000000001', toAddress: '0x0000000000000000000000000000000000000001', slippageBps: 50, order: 'CHEAPEST' as const };

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
    const response = { id: 'route', tool: 'across', toolDetails: { name: 'Across' }, action: { fromToken: { address: '0x0000000000000000000000000000000000000004' } }, estimate: { fromAmount: '1000000', toAmount: '999000', toAmountMin: '995000', executionDuration: 30, approvalAddress: '0x0000000000000000000000000000000000000003' }, transactionRequest: { to: '0x0000000000000000000000000000000000000002', data: '0x1234', value: '0' } };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));
    const routes = await fetchBridgeRoutes(quote);
    expect(routes[0]).toMatchObject({ kind: 'aggregator', toAmountMin: '995000', transaction: { family: 'EVM', data: '0x1234' }, fromTokenAddress: response.action.fromToken.address });
    expect(routes.some(route => route.kind === 'official' && route.officialUrl.includes('arbitrum'))).toBe(true);
  });
});
