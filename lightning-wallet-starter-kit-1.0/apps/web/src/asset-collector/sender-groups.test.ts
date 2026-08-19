import { describe, expect, it } from 'vitest';
import { collectorSenderCount, collectorTasksForActiveSender } from './sender-groups';
import type { CollectorTask } from './types';

function task(id: string, address: string, chain: CollectorTask['chain'] = 'EVM'): CollectorTask {
  return { id, chain, address, asset: 'native', symbol: chain === 'EVM' ? 'ETH' : chain === 'SOL' ? 'SOL' : 'TRX', balance: '2', estimatedFee: '0.01', status: 'ready', destination: 'destination', reserve: '0.1', collectAmount: '1.89', executionStatus: 'pending', attempts: 0 };
}

describe('asset collector sender groups', () => {
  it('groups every asset belonging to the active EVM account', () => {
    const native = task('1', '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a');
    const token = { ...task('2', native.address.toLowerCase()), asset: 'token' as const, symbol: 'USDC', token: '0x0000000000000000000000000000000000000002', decimals: 6 };
    const other = task('3', '0x0000000000000000000000000000000000000001');
    expect(collectorSenderCount([native, token, other])).toBe(2);
    expect(collectorTasksForActiveSender([native, token, other], native.address)).toEqual([native, token]);
  });

  it('does not case-fold Solana or TRON addresses', () => {
    const tron = task('1', 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA', 'TRON');
    expect(collectorTasksForActiveSender([tron], tron.address.toLowerCase())).toEqual([]);
  });
});
