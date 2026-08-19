import { describe, expect, it } from 'vitest';
import { assertExecutionPolicy, isMainnet } from './execution-policy';
import type { TransferTask } from './types';

const task: TransferTask = { id: '0x1', row: 2, chain: 'EVM', assetKind: 'native', from: '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a', to: '0x1311897252Bd6D7E5705443D9e7c32eE22E73067', amount: '0.001', status: 'pending', attempts: 0, estimatedFee: '0.0001' };

describe('production execution policy', () => {
  it('supports configured EVM mainnets without hardcoded address pairs', () => {
    const enabled = { mainnetEnabled: true, maxBatchCount: 1000 };
    expect(() => assertExecutionPolicy([task], '0x1', enabled)).not.toThrow();
    expect(() => assertExecutionPolicy([{ ...task, from: '0x0000000000000000000000000000000000000001' }], '0x38', enabled)).not.toThrow();
    expect(isMainnet('EVM', '0xa4b1')).toBe(true);
  });

  it('fails closed when mainnet is not enabled', () => {
    expect(() => assertExecutionPolicy([task], '0x38', { mainnetEnabled: false, maxBatchCount: 1000 })).toThrow(/主网真实执行/);
    expect(() => assertExecutionPolicy([task], '0xaa36a7', { mainnetEnabled: false, maxBatchCount: 1000 })).not.toThrow();
  });

  it('rejects mixed senders, missing token decimals and oversized batches', () => {
    const enabled = { mainnetEnabled: true, maxBatchCount: 2 };
    expect(() => assertExecutionPolicy([task, { ...task, id: '0x2', row: 3, from: '0x0000000000000000000000000000000000000001' }], '0x1', enabled)).toThrow(/同一发送账户/);
    expect(() => assertExecutionPolicy([{ ...task, token: '0x0000000000000000000000000000000000000002', assetKind: 'token' }], '0x1', enabled)).toThrow(/decimals/);
    expect(() => assertExecutionPolicy([task, { ...task, id: '0x2', row: 3, to: '0x0000000000000000000000000000000000000002' }, { ...task, id: '0x3', row: 4, to: '0x0000000000000000000000000000000000000003' }], '0x1', enabled)).toThrow(/上限/);
  });
});
