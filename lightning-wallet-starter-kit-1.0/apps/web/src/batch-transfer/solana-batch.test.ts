import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { broadcastSigned, buildSolanaBatchTransactions, executeSolanaBatch } from './solana-batch';
import type { TransferTask } from './types';

function task(index: number): TransferTask {
  return { id: `sol-${index}`, row: index + 2, chain: 'SOL', from: Keypair.generate().publicKey.toBase58(), to: Keypair.generate().publicKey.toBase58(), amount: '0.001', assetKind: 'native', estimatedFee: '0.000005', status: 'pending', attempts: 0 };
}

describe('Solana batch transaction construction', () => {
  it('constructs 1000 native transfers for one wallet batch prompt', () => {
    const owner = Keypair.generate().publicKey;
    const tasks = Array.from({ length: 1000 }, (_, index) => ({ ...task(index), from: owner.toBase58() }));
    const started = performance.now();
    const transactions = buildSolanaBatchTransactions(tasks, owner, Keypair.generate().publicKey.toBase58(), new Map());
    expect(transactions).toHaveLength(1000);
    expect(transactions.every(transaction => transaction.instructions.length === 1 && transaction.instructions[0]?.programId.equals(SystemProgram.programId))).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('fails closed when token program discovery is missing', () => {
    const owner = Keypair.generate().publicKey;
    const tokenTask = { ...task(0), from: owner.toBase58(), token: Keypair.generate().publicKey.toBase58(), decimals: 6, assetKind: 'token' as const };
    expect(() => buildSolanaBatchTransactions([tokenTask], owner, Keypair.generate().publicKey.toBase58(), new Map<string, PublicKey>())).toThrow('Token Program 未加载');
  });

  it('rejects token and native amounts above the Solana u64 limit before construction', () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey.toBase58();
    const blockhash = Keypair.generate().publicKey.toBase58();
    const tokenTask = { ...task(0), from: owner.toBase58(), token: mint, decimals: 0, amount: '18446744073709551616', assetKind: 'token' as const };
    const programs = new Map([[mint, new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')]]);
    expect(() => buildSolanaBatchTransactions([tokenTask], owner, blockhash, programs)).toThrow('u64');
    expect(() => buildSolanaBatchTransactions([{ ...task(1), from: owner.toBase58(), amount: '18446744074' }], owner, blockhash, new Map())).toThrow('u64');
  });

  it('does not broadcast signed transactions after the page execution is stopped', async () => {
    const sendRawTransaction = vi.fn(async () => 'must-not-run');
    const connection = { sendRawTransaction } as unknown as import('@solana/web3.js').Connection;
    const signed = [{ serialize: () => new Uint8Array([1, 2, 3]) }];
    await expect(broadcastSigned(connection, signed, { shouldStop: () => true })).rejects.toThrow('剩余已签名交易未广播');
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });

  it('rejects a wrong RPC genesis before requesting a wallet signature', async () => {
    const owner = Keypair.generate().publicKey;
    const signAllTransactions = vi.fn();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { solana: { publicKey: { toString: () => owner.toBase58() }, signAndSendTransaction: vi.fn(), signAllTransactions } } });
    const connection = { getGenesisHash: vi.fn().mockResolvedValue('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') } as unknown as import('@solana/web3.js').Connection;
    await expect(executeSolanaBatch([{ ...task(0), from: owner.toBase58() }], { connection })).rejects.toThrow(/Genesis/);
    expect(signAllTransactions).not.toHaveBeenCalled();
  });
});
