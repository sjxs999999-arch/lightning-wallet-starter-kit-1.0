import { describe, expect, it, vi } from 'vitest';
import { executeBridgeRoute } from './executor';
import type { BridgeQuoteRequest, BridgeRoute } from './types';

const request: BridgeQuoteRequest = { fromChainId: 1, toChainId: 42161, fromToken: 'USDC', toToken: 'USDC', fromAmount: '1000000', fromAddress: '0x0000000000000000000000000000000000000001', toAddress: '0x0000000000000000000000000000000000000001', slippageBps: 50, order: 'CHEAPEST' };
const route: BridgeRoute = { id: 'route', provider: 'across', providerLabel: 'Across', kind: 'aggregator', fromAmount: request.fromAmount, toAmountMin: '990000', steps: ['across'], warnings: [], expiresAt: '2030-01-01T00:00:00.000Z', transaction: { family: 'EVM', chainId: 1, to: '0x0000000000000000000000000000000000000002', data: '0x1234', value: '0x0' } };

describe('bridge executor', () => {
  it('rejects expired quotes before connecting a wallet', async () => {
    const provider = { request: vi.fn() };
    await expect(executeBridgeRoute(request, { ...route, expiresAt: '2020-01-01T00:00:00.000Z' }, { evmProvider: provider, now: () => Date.parse('2029-01-01') })).rejects.toThrow(/过期/);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it('simulates before sending and requires the exact active account', async () => {
    const requestCall = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [request.fromAddress];
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_sendTransaction') return '0xabc';
      return null;
    });
    await expect(executeBridgeRoute(request, route, { evmProvider: { request: requestCall }, confirm: () => true, now: () => Date.parse('2029-01-01') })).resolves.toEqual({ kind: 'bridge', reference: '0xabc' });
    expect(requestCall.mock.calls.findIndex(([value]) => value.method === 'eth_estimateGas')).toBeLessThan(requestCall.mock.calls.findIndex(([value]) => value.method === 'eth_sendTransaction'));
  });

  it('blocks a mismatched wallet before simulation or broadcast', async () => {
    const requestCall = vi.fn(async ({ method }: { method: string }) => method === 'eth_requestAccounts' ? ['0x0000000000000000000000000000000000000003'] : null);
    await expect(executeBridgeRoute(request, route, { evmProvider: { request: requestCall }, confirm: () => true, now: () => Date.parse('2029-01-01') })).rejects.toThrow(/不一致/);
    expect(requestCall).toHaveBeenCalledTimes(1);
  });
});
