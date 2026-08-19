import { describe, expect, it } from 'vitest';
import { collectorTransferTask } from './transfer-task';
import type { CollectorTask } from './types';

describe('collector wallet transaction mapping', () => {
  it('maps only public transaction fields and preserves exact token scale', () => {
    const task: CollectorTask = { id: 'task-1', chain: 'EVM', address: '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a', destination: '0x1311897252Bd6D7E5705443D9e7c32eE22E73067', asset: 'token', token: '0x0000000000000000000000000000000000000002', decimals: 6, symbol: 'USDC', balance: '9007199254740993.000001', reserve: '0', collectAmount: '9007199254740993.000001', estimatedFee: '0.00065', status: 'ready', executionStatus: 'running', attempts: 1 };
    expect(collectorTransferTask(task, 2)).toMatchObject({ from: task.address, to: task.destination, amount: task.collectAmount, token: task.token, decimals: 6, row: 2 });
    expect(JSON.stringify(collectorTransferTask(task, 2))).not.toMatch(/private|mnemonic|seedPhrase/i);
  });
});
