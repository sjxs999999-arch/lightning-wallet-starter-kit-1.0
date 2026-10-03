import { afterEach, describe, expect, it, vi } from 'vitest';
import { Wallet, Transaction } from 'ethers';
import { assertEvmPlanAndSignature, localEvmExplorer, localEvmNetwork, assertLocalEvmExecutionPolicy, localEvmMainnetEnabled } from './local-evm-network';
import type { LocalTransferPlan } from './local-transfer-types';
import type { PortfolioNetworkId } from './portfolio-networks';

const wallet = new Wallet('0x' + '11'.repeat(32));
const to = new Wallet('0x' + '22'.repeat(32)).address;
function plan(networkId: PortfolioNetworkId): LocalTransferPlan {
  const network = localEvmNetwork(networkId);
  return {
    id: 'test', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90000).toISOString(),
    network: network.label, feeLabel: '', risk: [],
    draft: { walletId: 'test', networkId, chain: 'EVM', from: wallet.address, to, amount: '0.01', asset: { symbol: network.nativeSymbol, decimals: 18 } },
    signingPayload: { chain: 'EVM', transaction: { chainId: Number(network.evmChainId), nonce: 3, gasLimit: '21000', type: 0, gasPrice: '1000000000', to, value: '10000000000000000' } },
  };
}
async function signed(p: LocalTransferPlan, changes: Record<string, string | number> = {}) {
  if (p.signingPayload.chain !== 'EVM') throw new Error('test payload');
  return Transaction.from(await wallet.signTransaction({ ...p.signingPayload.transaction, ...changes }));
}

describe('local EVM network and signed plan binding', () => {
  it.each(['sepolia', 'ethereum', 'bsc', 'polygon', 'base', 'arbitrum'] as const)('accepts the exact user-confirmed transaction on %s', async id => {
    const p = plan(id);
    assertEvmPlanAndSignature(p, await signed(p));
    expect(localEvmExplorer(p.network)).toMatch(/^https:/);
  });
  it.each<Record<string, string | number>>([
    { chainId: 56 }, { to: wallet.address }, { value: '20000000000000000' },
    { nonce: 4 }, { gasLimit: '100000' }, { gasPrice: '9000000000' }, { data: '0x1234' },
  ])('rejects modified chain, recipient, amount, nonce, fee or calldata: %j', async changes => {
    const p = plan('ethereum');
    const altered = await signed(p, changes);
    expect(() => assertEvmPlanAndSignature(p, altered)).toThrow(/不匹配/);
  });
  it('rejects a signed transaction from another wallet', async () => {
    const p = plan('bsc');
    if (p.signingPayload.chain !== 'EVM') return;
    const other = new Wallet('0x' + '33'.repeat(32));
    const tx = Transaction.from(await other.signTransaction(p.signingPayload.transaction));
    expect(() => assertEvmPlanAndSignature(p, tx)).toThrow(/不匹配/);
  });
  it('rejects non-EVM networks and keeps legacy plans on Sepolia', () => {
    expect(() => localEvmNetwork('tron-mainnet')).toThrow();
    expect(localEvmNetwork().id).toBe('sepolia');
    expect(localEvmExplorer('unrecognized')).toBeUndefined();
  });
});

describe('scoped local EVM mainnet release flag', () => {
  afterEach(() => vi.unstubAllEnvs());
  const task = { id: 'test', row: 2, chain: 'EVM' as const, from: wallet.address, to, amount: '0.01', status: 'pending' as const, assetKind: 'native' as const, attempts: 0, estimatedFee: '0' };
  it('fails closed by default while preserving Sepolia', () => {
    vi.stubEnv('VITE_LOCAL_EVM_MAINNET_ENABLED', 'false');vi.stubEnv('VITE_MAINNET_EXECUTION_ENABLED', 'false');
    expect(localEvmMainnetEnabled()).toBe(false);
    expect(() => assertLocalEvmExecutionPolicy(task, '0x1')).toThrow(/未.*启用/);
    expect(() => assertLocalEvmExecutionPolicy(task, '0xaa36a7')).not.toThrow();
  });
  it('enables only supported single local EVM transactions', () => {
    vi.stubEnv('VITE_LOCAL_EVM_MAINNET_ENABLED', 'true');vi.stubEnv('VITE_MAINNET_EXECUTION_ENABLED', 'false');
    expect(localEvmMainnetEnabled()).toBe(true);
    expect(() => assertLocalEvmExecutionPolicy(task, '0x38')).not.toThrow();
    expect(() => assertLocalEvmExecutionPolicy(task, '0x999')).toThrow(/未启用/);
    expect(() => assertLocalEvmExecutionPolicy({ ...task, chain: 'SOL' }, 'mainnet-beta')).toThrow(/仅适用于 EVM/);
  });
});
