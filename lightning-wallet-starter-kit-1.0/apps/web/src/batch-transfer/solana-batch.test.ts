import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { buildSolanaBatchTransactions } from './solana-batch';
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
});
