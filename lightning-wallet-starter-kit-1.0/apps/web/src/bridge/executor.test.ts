import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeBridgeRoute } from './executor';
import type { BridgeQuoteRequest, BridgeRoute } from './types';

const request: BridgeQuoteRequest = { fromChainId: 1, toChainId: 42161, fromToken: 'USDC', toToken: 'USDC', fromAmount: '1000000', fromAddress: '0x0000000000000000000000000000000000000001', toAddress: '0x0000000000000000000000000000000000000001', slippageBps: 50, order: 'CHEAPEST' };
const route: BridgeRoute = { id: 'route', provider: 'across', providerLabel: 'Across', kind: 'aggregator', fromAmount: request.fromAmount, toAmountMin: '990000', steps: ['across'], warnings: [], expiresAt: '2030-01-01T00:00:00.000Z', transaction: { family: 'EVM', chainId: 1, to: '0x0000000000000000000000000000000000000002', data: '0x1234', value: '0x0' } };

describe('bridge executor', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MAINNET_EXECUTION_ENABLED', 'true');
    vi.stubEnv('VITE_ENABLE_MAINNET_BRIDGE', 'true');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects before wallet discovery while either mainnet gate is closed', async () => {
    vi.stubEnv('VITE_ENABLE_MAINNET_BRIDGE', 'false');
    const provider = { request: vi.fn() };
    await expect(executeBridgeRoute(request, route, { evmProvider: provider, now: () => Date.parse('2029-01-01') })).rejects.toThrow(/双重生产开关/);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it('rejects expired quotes before connecting a wallet', async () => {
    const provider = { request: vi.fn() };
    await expect(executeBridgeRoute(request, { ...route, expiresAt: '2020-01-01T00:00:00.000Z' }, { evmProvider: provider, now: () => Date.parse('2029-01-01') })).rejects.toThrow(/过期/);
    expect(provider.request).not.toHaveBeenCalled();
  });

  it('simulates before sending and requires the exact active account', async () => {
    const requestCall = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [request.fromAddress];
      if (method === 'eth_accounts') return [request.fromAddress];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_sendTransaction') return '0xabc';
      if (method === 'eth_getTransactionReceipt') return { status: '0x1' };
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

  it('does not sign when the wallet fails to switch to the quoted network', async () => {
    const requestCall = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [request.fromAddress];
      if (method === 'eth_chainId') return '0x89';
      return null;
    });
    await expect(executeBridgeRoute(request, route, { evmProvider: { request: requestCall }, confirm: () => true, now: () => Date.parse('2029-01-01') })).rejects.toThrow(/没有切换/);
    expect(requestCall.mock.calls.some(([value]) => value.method === 'eth_sendTransaction')).toBe(false);
  });

  it('never reports an EVM failure receipt as a successful bridge', async () => {
    const requestCall = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [request.fromAddress];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'eth_estimateGas') return '0x5208';
      if (method === 'eth_sendTransaction') return '0xfailed';
      if (method === 'eth_getTransactionReceipt') return { status: '0x0' };
      return null;
    });
    await expect(executeBridgeRoute(request, route, { evmProvider: { request: requestCall }, confirm: () => true, now: () => Date.parse('2029-01-01') })).rejects.toThrow(/回执状态/);
  });

  it('attests Solana Mainnet genesis before requesting a signature', async () => {
    const solRequest: BridgeQuoteRequest = { ...request, fromChainId: 1_151_111_081_099_710, fromAddress: '11111111111111111111111111111111' };
    const solRoute: BridgeRoute = { ...route, transaction: { family: 'SOL', chainId: solRequest.fromChainId, serialized: 'AA==', simulated: true } };
    const signAndSendTransaction = vi.fn();
    const connection = { getGenesisHash: vi.fn().mockResolvedValue('wrong-genesis'), confirmTransaction: vi.fn() };
    await expect(executeBridgeRoute(solRequest, solRoute, { solanaProvider: { publicKey: { toString: () => solRequest.fromAddress }, signAndSendTransaction }, solanaConnection: connection, confirm: () => true, now: () => Date.parse('2029-01-01') })).rejects.toThrow(/Genesis.*不匹配/);
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });
});
