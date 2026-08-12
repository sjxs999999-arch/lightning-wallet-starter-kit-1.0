import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Production Vercel handler is intentionally plain ESM JavaScript.
import { fetchBridgeQuotes, normalizeRaydiumPositions, parseBridgeRequest, parseLpRequest, parseRiskRequest, parseSolanaSwapRequest } from '../../web/public/api/v1/pro-lib.js';

const bridge = { fromChainId: 1, toChainId: 42161, fromToken: 'USDC', toToken: 'USDC', fromAmount: '1000000', fromAddress: '0x0000000000000000000000000000000000000001', toAddress: '0x0000000000000000000000000000000000000001', slippageBps: 50, order: 'CHEAPEST' };

afterEach(() => vi.restoreAllMocks());

describe('production serverless Pro API', () => {
  it('strictly accepts public bridge, risk, and Solana swap fields', () => {
    expect(parseBridgeRequest(bridge)).toEqual(bridge);
    expect(parseBridgeRequest({ ...bridge, privateKey: 'blocked' })).toBeNull();
    expect(parseRiskRequest({ chain: '1', address: bridge.fromAddress })).toEqual({ chain: '1', address: bridge.fromAddress });
    expect(parseRiskRequest({ chain: '1', address: bridge.fromAddress, mnemonic: 'blocked' })).toBeNull();
    expect(parseSolanaSwapRequest({ sellToken: 'So11111111111111111111111111111111111111112', buyToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', sellAmount: '1', taker: '11111111111111111111111111111111', slippageBps: 50, priority: 'auto' })).not.toBeNull();
    expect(parseLpRequest({ protocol: 'raydium', owner: '11111111111111111111111111111111' })).not.toBeNull();
    expect(parseLpRequest({ protocol: 'raydium', owner: '11111111111111111111111111111111', seedPhrase: 'blocked' })).toBeNull();
  });

  it('normalizes Raydium cached positions without returning upstream secrets', () => {
    const result = normalizeRaydiumPositions('11111111111111111111111111111111', { data: { positions: [{ poolId: 'pool-1', poolName: 'SOL-USDC', stakedAmount: '100', pendingRewards: [{}] }] } });
    expect(result).toMatchObject({ count: 1, rewardEntries: 1, positions: [{ id: 'pool-1', label: 'SOL-USDC', stakedAmount: '100' }] });
  });

  it('returns a bounded signable quote and a distinct official route', async () => {
    const response = { id: 'quote-1', tool: 'across', toolDetails: { name: 'Across' }, action: { fromToken: { address: '0x0000000000000000000000000000000000000004' } }, estimate: { fromAmount: '1000000', toAmount: '999000', toAmountMin: '995000', executionDuration: 30, approvalAddress: '0x0000000000000000000000000000000000000003', feeCosts: [{ amountUSD: '0.1' }], gasCosts: [{ amountUSD: '0.2' }], fromAmountUSD: '1', toAmountUSD: '0.999' }, transactionRequest: { to: '0x0000000000000000000000000000000000000002', data: '0x1234', value: '0' } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 }));
    const routes = await fetchBridgeQuotes(bridge);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(routes[0]).toMatchObject({ kind: 'aggregator', fromTokenAddress: response.action.fromToken.address, approvalAddress: response.estimate.approvalAddress, transaction: { family: 'EVM', to: response.transactionRequest.to, data: '0x1234', value: '0x0' } });
    expect(routes.some((route: { kind: string; officialUrl?: string }) => route.kind === 'official' && route.officialUrl?.includes('arbitrum'))).toBe(true);
  });
});
