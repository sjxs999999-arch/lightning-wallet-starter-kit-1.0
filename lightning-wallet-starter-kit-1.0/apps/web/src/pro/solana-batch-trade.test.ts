import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executePreparedSolanaTrade, SolanaTradeFailedError } from './solana-batch-trade';

function serialized(payer = Keypair.generate().publicKey) {
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

const mainnetGenesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';

describe('Solana batch trade execution boundary', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MAINNET_EXECUTION_ENABLED', 'true');
    vi.stubEnv('VITE_ENABLE_MAINNET_SWAP', 'true');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects before RPC or wallet access while either production gate is closed', async () => {
    vi.stubEnv('VITE_ENABLE_MAINNET_SWAP', 'false');
    const getGenesisHash = vi.fn(), signAndSendTransaction = vi.fn();
    await expect(executePreparedSolanaTrade(Keypair.generate().publicKey.toBase58(), 'AA==', 'confirm', {
      provider: { signAndSendTransaction }, connection: { getGenesisHash, confirmTransaction: vi.fn() }, confirm: vi.fn(),
    })).rejects.toThrow(/双重生产开关/);
    expect(getGenesisHash).not.toHaveBeenCalled();
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });

  it('attests Mainnet genesis before account connection or confirmation', async () => {
    const owner = Keypair.generate().publicKey, connect = vi.fn(), confirm = vi.fn(), signAndSendTransaction = vi.fn();
    await expect(executePreparedSolanaTrade(owner.toBase58(), serialized(owner), 'confirm', {
      provider: { connect, signAndSendTransaction },
      connection: { getGenesisHash: vi.fn().mockResolvedValue('wrong-genesis'), confirmTransaction: vi.fn() }, confirm,
    })).rejects.toThrow(/Genesis.*不匹配/);
    expect(connect).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });

  it('rejects a transaction whose payer differs from the selected wallet', async () => {
    const owner = Keypair.generate().publicKey, signAndSendTransaction = vi.fn(), confirm = vi.fn();
    await expect(executePreparedSolanaTrade(owner.toBase58(), serialized(), 'confirm', {
      provider: { publicKey: { toString: () => owner.toBase58() }, signAndSendTransaction },
      connection: { getGenesisHash: vi.fn().mockResolvedValue(mainnetGenesis), confirmTransaction: vi.fn() }, confirm,
    })).rejects.toThrow(/付款人/);
    expect(confirm).not.toHaveBeenCalled();
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });

  it('never reports a failed chain confirmation as successful', async () => {
    const owner = Keypair.generate().publicKey, signAndSendTransaction = vi.fn().mockResolvedValue({ signature: 'failed-signature' });
    await expect(executePreparedSolanaTrade(owner.toBase58(), serialized(owner), 'confirm', {
      provider: { publicKey: { toString: () => owner.toBase58() }, signAndSendTransaction },
      connection: { getGenesisHash: vi.fn().mockResolvedValue(mainnetGenesis), confirmTransaction: vi.fn().mockResolvedValue({ value: { err: { InstructionError: [0, 'Custom'] } } }) },
      confirm: () => true,
    })).rejects.toMatchObject({ message: expect.stringMatching(/链上执行失败/), signature: 'failed-signature', name: 'SolanaTradeFailedError' } satisfies Partial<SolanaTradeFailedError>);
  });

  it('preserves the signature as submitted when confirmation RPC is unavailable', async () => {
    const owner = Keypair.generate().publicKey, signAndSendTransaction = vi.fn().mockResolvedValue({ signature: 'submitted-signature' });
    await expect(executePreparedSolanaTrade(owner.toBase58(), serialized(owner), 'confirm', {
      provider: { publicKey: { toString: () => owner.toBase58() }, signAndSendTransaction },
      connection: { getGenesisHash: vi.fn().mockResolvedValue(mainnetGenesis), confirmTransaction: vi.fn().mockRejectedValue(new Error('timeout')) },
      confirm: () => true,
    })).resolves.toEqual({ signature: 'submitted-signature', state: 'submitted' });
  });

  it('returns only after the matching wallet transaction is confirmed', async () => {
    const owner = Keypair.generate().publicKey, signAndSendTransaction = vi.fn().mockResolvedValue({ signature: 'confirmed-signature' });
    await expect(executePreparedSolanaTrade(owner.toBase58(), serialized(owner), 'confirm', {
      provider: { publicKey: { toString: () => owner.toBase58() }, signAndSendTransaction },
      connection: { getGenesisHash: vi.fn().mockResolvedValue(mainnetGenesis), confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }) },
      confirm: () => true,
    })).resolves.toEqual({ signature: 'confirmed-signature', state: 'confirmed' });
  });
});
