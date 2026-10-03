import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Wallet } from 'ethers';
import { broadcastLocalTransfer, planLocalTransfer } from './local-transfer';
import type { LocalTransferDraft } from './local-transfer-types';

const rpc = vi.hoisted(() => ({
  network: vi.fn(), nonce: vi.fn(), gas: vi.fn(), fees: vi.fn(), balance: vi.fn(), broadcast: vi.fn(), tokenDecimals: vi.fn(), tokenBalance: vi.fn(),
}));
vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  return { ...actual,
    JsonRpcProvider: class {
      destroy() {}
      getNetwork = rpc.network;getTransactionCount = rpc.nonce;estimateGas = rpc.gas;getFeeData = rpc.fees;getBalance = rpc.balance;broadcastTransaction = rpc.broadcast;
    },
    Contract: class {
      getFunction(name: string) { return name === 'decimals' ? rpc.tokenDecimals : rpc.tokenBalance; }
    },
  };
});
const signer = new Wallet('0x' + '44'.repeat(32));
const to = new Wallet('0x' + '55'.repeat(32)).address;
const draft: LocalTransferDraft = { walletId: 'test', chain: 'EVM', networkId: 'bsc', from: signer.address, to, amount: '0.01', asset: { symbol: 'BNB', decimals: 18 } };

beforeEach(() => {
  vi.resetAllMocks();vi.stubEnv('VITE_LOCAL_EVM_MAINNET_ENABLED', 'true');vi.stubEnv('VITE_MAINNET_EXECUTION_ENABLED', 'false');
  rpc.network.mockResolvedValue({ chainId: 56n });rpc.nonce.mockResolvedValue(1);rpc.gas.mockResolvedValue(21000n);
  rpc.fees.mockResolvedValue({ gasPrice: 1000000000n, maxFeePerGas: null, maxPriorityFeePerGas: null });
  rpc.balance.mockResolvedValue(1000000000000000000n);
  rpc.broadcast.mockResolvedValue({ hash: '0x' + 'aa'.repeat(32), wait: async () => ({ status: 1 }) });
  rpc.tokenDecimals.mockResolvedValue(6n);rpc.tokenBalance.mockResolvedValue(1000000000n);
});
afterEach(() => vi.unstubAllEnvs());

describe('local EVM planning and broadcast boundaries', () => {
  it('plans BNB on chain 56 and broadcasts only the exact signed transaction', async () => {
    const p = await planLocalTransfer(draft);
    expect(p.network).toBe('BNB Smart Chain');expect(p.feeLabel).toContain('BNB');expect(p.risk).toContain('主网真实资产');
    if (p.signingPayload.chain !== 'EVM') throw new Error('expected EVM');
    const signedTransaction = await signer.signTransaction(p.signingPayload.transaction);
    expect(await broadcastLocalTransfer(p, { chain: 'EVM', signedTransaction })).toMatchObject({ state: 'confirmed' });
    expect(rpc.broadcast).toHaveBeenCalledExactlyOnceWith(signedTransaction);
  });
  it('uses a verified fallback when the first RPC is unavailable', async () => {
    rpc.network.mockRejectedValueOnce(new Error('offline'));
    const p = await planLocalTransfer(draft);expect(p.evmRpcUrl).toBe('https://bsc-dataseed.bnbchain.org');
  });
  it('stops when RPC is on a different chain from the selected network', async () => {
    rpc.network.mockResolvedValue({ chainId: 1n });
    await expect(planLocalTransfer(draft)).rejects.toThrow(/Chain ID 不匹配/);expect(rpc.gas).not.toHaveBeenCalled();
  });
  it('rechecks the chain before broadcast and never sends on a switched RPC', async () => {
    const p = await planLocalTransfer(draft);if (p.signingPayload.chain !== 'EVM') return;
    const signedTransaction = await signer.signTransaction(p.signingPayload.transaction);
    rpc.network.mockResolvedValue({ chainId: 1n });
    await expect(broadcastLocalTransfer(p, { chain: 'EVM', signedTransaction })).rejects.toThrow(/发生变化/);
    expect(rpc.broadcast).not.toHaveBeenCalled();
  });
  it('rejects tampered recipients before any RPC broadcast', async () => {
    const p = await planLocalTransfer(draft);if (p.signingPayload.chain !== 'EVM') return;
    const signedTransaction = await signer.signTransaction({ ...p.signingPayload.transaction, to: signer.address });
    await expect(broadcastLocalTransfer(p, { chain: 'EVM', signedTransaction })).rejects.toThrow(/不匹配/);
    expect(rpc.broadcast).not.toHaveBeenCalled();
  });
  it('rejects insufficient native funds including the fee cap', async () => {
    rpc.balance.mockResolvedValue(10000000000000000n);
    await expect(planLocalTransfer(draft)).rejects.toThrow(/手续费上限/);
  });
  it('checks ERC-20 decimals on the selected network', async () => {
    await expect(planLocalTransfer({ ...draft, asset: { symbol: 'TEST', address: to, decimals: 18 } })).rejects.toThrow(/decimals/);
    expect(rpc.gas).not.toHaveBeenCalled();
  });
  it('plans an ERC-20 transfer with zero native value and the correct contract', async () => {
    const p = await planLocalTransfer({ ...draft, asset: { symbol: 'TEST', address: to, decimals: 6 } });
    if (p.signingPayload.chain !== 'EVM') return;
    expect(p.signingPayload.transaction).toMatchObject({ to, value: '0', chainId: 56 });
    expect(p.signingPayload.transaction.data).toMatch(/^0xa9059cbb/);
  });
  it('rechecks the scoped release flag before broadcast', async () => {
    const p = await planLocalTransfer(draft);if (p.signingPayload.chain !== 'EVM') return;
    const signedTransaction = await signer.signTransaction(p.signingPayload.transaction);
    vi.stubEnv('VITE_LOCAL_EVM_MAINNET_ENABLED', 'false');
    await expect(broadcastLocalTransfer(p, { chain: 'EVM', signedTransaction })).rejects.toThrow(/未.*启用/);
    expect(rpc.broadcast).not.toHaveBeenCalled();
  });
});
