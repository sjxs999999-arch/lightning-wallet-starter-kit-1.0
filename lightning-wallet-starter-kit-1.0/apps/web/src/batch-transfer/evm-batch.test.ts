import { describe, expect, it } from 'vitest';
import { Interface } from 'ethers';
import { buildEvmCalls, executeEvmBatch } from './evm-batch';
import type { TransferTask } from './types';

const task: TransferTask = { id: '0x1', row: 2, chain: 'EVM', assetKind: 'native', from: '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a', to: '0x1311897252Bd6D7E5705443D9e7c32eE22E73067', amount: '0.001', status: 'pending', attempts: 0, estimatedFee: '0.0001' };

describe('EIP-5792 batch calls', () => {
  it('builds native and token calls without private key material', () => {
    const token = { ...task, id: '0x2', row: 3, assetKind: 'token' as const, token: '0x0000000000000000000000000000000000000002', decimals: 6, amount: '12.5' };
    const calls = buildEvmCalls([task, token]);
    expect(calls[0]).toEqual({ to: task.to, value: '0x38d7ea4c68000' });
    expect(calls[1]!.to).toBe(token.token);
    expect(new Interface(['function transfer(address,uint256)']).decodeFunctionData('transfer', calls[1]!.data!)[1]).toBe(12_500_000n);
    expect(JSON.stringify(calls)).not.toMatch(/private|mnemonic|seed/i);
  });

  it('keeps a returned batch id submitted when status polling times out', async () => {
    const request = async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [task.from];
      if (method === 'eth_chainId') return '0xaa36a7';
      if (method === 'wallet_getCapabilities') return {};
      if (method === 'wallet_sendCalls') return 'batch-123';
      throw new Error('RPC timeout');
    };
    await expect(executeEvmBatch([task], { request })).resolves.toEqual([{ index: 0, hash: 'batch-123', state: 'submitted' }]);
  });

  it('rejects a pre-broadcast wallet failure and mixed senders', async () => {
    const request = async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [task.from];
      if (method === 'eth_chainId') return '0xaa36a7';
      if (method === 'wallet_getCapabilities') return {};
      throw new Error('wallet_sendCalls rejected');
    };
    await expect(executeEvmBatch([task], { request })).rejects.toThrow('wallet_sendCalls rejected');
    await expect(executeEvmBatch([task, { ...task, id: '0x2', row: 3, from: '0x0000000000000000000000000000000000000001' }], { request })).rejects.toThrow('同一发送账户');
  });
});
