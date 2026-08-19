import { describe, expect, it } from 'vitest';
import { pendingSenderCount, senderCount, tasksForActiveSender } from './sender-groups';
import type { TransferTask } from './types';

const task = (id: string, chain: TransferTask['chain'], from: string, status: TransferTask['status'] = 'pending'): TransferTask => ({
  id,
  row: Number(id.replace(/\D/g, '')) + 2,
  chain,
  from,
  to: chain === 'EVM' ? '0x1311897252Bd6D7E5705443D9e7c32eE22E73067' : `${chain}-recipient`,
  amount: '1',
  assetKind: 'native',
  status,
  attempts: 0,
  estimatedFee: '0.1',
});

describe('multi-sender execution groups', () => {
  it('matches EVM accounts case-insensitively without mixing senders', () => {
    const first = task('1', 'EVM', '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a');
    const same = task('2', 'EVM', '0x42bae181b2fbd5cc8f04762770942c719dd4d30a');
    const other = task('3', 'EVM', '0x0000000000000000000000000000000000000001');
    expect(senderCount([first, same, other])).toBe(2);
    expect(tasksForActiveSender([first, same, other], first.from)).toEqual([first, same]);
  });

  it('keeps Solana and TRON sender matching exact', () => {
    const sol = task('1', 'SOL', '7qDtJXnNGWpccPmdVwMUKYuAGGE7uDiXgtVSYxw3eeDL');
    const tron = task('2', 'TRON', 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA');
    expect(tasksForActiveSender([sol], sol.from)).toEqual([sol]);
    expect(tasksForActiveSender([tron], tron.from.toLowerCase())).toEqual([]);
  });

  it('counts only unfinished sender groups for the next wallet switch', () => {
    expect(pendingSenderCount([
      task('1', 'EVM', '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a', 'confirmed'),
      task('2', 'EVM', '0x0000000000000000000000000000000000000001'),
      task('3', 'EVM', '0x0000000000000000000000000000000000000002', 'failed'),
    ])).toBe(2);
  });
});
