import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransferTask } from './types';
import type { VaultEnvelope, VaultWallet } from '../wallet-center/vault';
import { executeLocalVaultBatch, localDraft, selectLocalWallet, walletsForChain } from './local-vault-executor';

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  sign: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('../wallet-center/local-transfer', () => ({ planLocalTransfer: mocks.plan, broadcastLocalTransfer: mocks.broadcast }));
vi.mock('../wallet-center/local-signer', () => ({ signWithLocalWorker: mocks.sign }));

const encrypted = { version: 1 as const, ciphertext: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo=', iv: 'YWJjZGVmZ2hpamts' };
const wallet: VaultWallet = { id: 'wallet-1', name: 'Sepolia', chain: 'EVM', address: '0x1311897252Bd6D7E5705443D9e7c32eE22E73067', publicKey: '0x04', path: 'imported:EVM', index: 0, origin: 'private-key', hasMnemonic: false, encryptedPrivateKey: encrypted, encryptedMnemonic: encrypted, createdAt: '2026-08-21T00:00:00.000Z' };
const vault = { wallets: [wallet] } as VaultEnvelope;
const task: TransferTask = { id: 'task-1', row: 2, chain: 'EVM', from: wallet.address.toLowerCase(), to: '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a', amount: '0.001', assetKind: 'native', status: 'pending', attempts: 0, estimatedFee: '0.00021' };

describe('local vault batch selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plan.mockResolvedValue({ signingPayload: { chain: 'EVM', transaction: {} } });
    mocks.sign.mockResolvedValue({ chain: 'EVM', signedTransaction: '0xsigned' });
    mocks.broadcast.mockResolvedValue({ hash: '0xhash', state: 'confirmed' });
  });
  it('matches EVM senders case-insensitively and filters by chain', () => {
    expect(walletsForChain(vault, 'EVM')).toEqual([wallet]);
    const selected = selectLocalWallet(vault, 'EVM', wallet.id, [task]);
    expect(selected.wallet).toBe(wallet);
    expect(selected.tasks).toEqual([task]);
  });

  it('rejects a selected wallet that cannot control the CSV sender', () => {
    expect(() => selectLocalWallet(vault, 'EVM', wallet.id, [{ ...task, from: task.to }])).toThrow('与 CSV 发送钱包不一致');
  });

  it('converts only public task data into a testnet draft', () => {
    expect(localDraft(task, wallet)).toEqual({ walletId: wallet.id, chain: 'EVM', from: task.from, to: task.to, amount: '0.001', asset: { symbol: 'Sepolia ETH', decimals: 18 } });
  });

  it('uses one-shot local signing and reports a public result', async () => {
    const onStart = vi.fn(), onResult = vi.fn();
    await expect(executeLocalVaultBatch([task], wallet, {} as CryptoKey, { waitUntilResumed: async () => {}, shouldStop: () => false, onStart, onResult })).resolves.toEqual([{ index: 0, hash: '0xhash', state: 'confirmed' }]);
    expect(onStart).toHaveBeenCalledWith(0);
    expect(mocks.sign).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledWith({ index: 0, hash: '0xhash', state: 'confirmed' });
  });

  it('never broadcasts a signed transaction after the vault session locks', async () => {
    let locked = false;
    mocks.sign.mockImplementation(async () => { locked = true;return { chain: 'EVM', signedTransaction: '0xsigned' }; });
    const onResult = vi.fn();
    await executeLocalVaultBatch([task], wallet, {} as CryptoKey, { waitUntilResumed: async () => {}, shouldStop: () => locked, onStart: vi.fn(), onResult });
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith({ index: 0, error: '本地保险库已锁定；已签名交易没有广播' });
  });
});
