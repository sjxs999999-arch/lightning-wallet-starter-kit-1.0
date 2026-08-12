import { describe, expect, it } from 'vitest';
import { bridgeAddressValid, formatDuration, routeRisk, validateBridgeRequest } from './guard';
import type { BridgeQuoteRequest, BridgeRoute } from './types';

const request: BridgeQuoteRequest = {
  fromChainId: 1,
  toChainId: 42161,
  fromToken: 'USDC',
  toToken: 'USDC',
  fromAmount: '1000000',
  fromAddress: '0x0000000000000000000000000000000000000001',
  toAddress: '0x0000000000000000000000000000000000000001',
  slippageBps: 50,
  order: 'CHEAPEST',
};

describe('bridge guard', () => {
  it('validates supported cross-chain requests', () => expect(validateBridgeRequest(request)).toEqual(request));
  it('rejects same-chain and decimal raw amounts', () => {
    expect(() => validateBridgeRequest({ ...request, toChainId: 1 })).toThrow(/不同/);
    expect(() => validateBridgeRequest({ ...request, fromAmount: '1.2' })).toThrow(/最小单位/);
  });
  it('validates EVM and Solana addresses by family', () => {
    expect(bridgeAddressValid(1, request.fromAddress)).toBe(true);
    expect(bridgeAddressValid(1_151_111_081_099_710, '11111111111111111111111111111111')).toBe(true);
    expect(bridgeAddressValid(1_151_111_081_099_710, request.fromAddress)).toBe(false);
  });
  it('surfaces incomplete route protections', () => {
    const route = { id: 'r', provider: 'lifi', providerLabel: 'LI.FI', kind: 'aggregator', fromAmount: '1', steps: [], warnings: [] } satisfies BridgeRoute;
    expect(routeRisk(route)).toContain('路线未提供最低到账保护');
    expect(formatDuration(90)).toBe('约 2 分钟');
  });
});
