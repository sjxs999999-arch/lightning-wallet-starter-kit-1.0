import { describe, expect, it } from 'vitest';
import { loadLocalTransferHistory, saveLocalTransferJob } from './local-history';
import type { TransferJob } from './persistence';

describe('local transfer history', () => {
  it('persists only local transfer audit jobs and replaces updates by id', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const base: TransferJob = { id: 'local-1', kind: 'batch-transfer', status: 'validated', payload: { chain: 'EVM', mode: 'one-to-many', dryRun: true, count: 1, totalAmount: '1', totalEstimatedFee: '0.1' }, result: { dryRun: true, serverSigning: false, serverBroadcast: false, confirmed: 0, failed: 0, pending: 1 }, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() };
    saveLocalTransferJob(base, storage);
    saveLocalTransferJob({ ...base, status: 'completed', result: { ...base.result, confirmed: 1, pending: 0 } }, storage);
    expect(loadLocalTransferHistory(storage)).toHaveLength(1);
    expect(loadLocalTransferHistory(storage)[0]?.status).toBe('completed');
  });

  it('fails closed on corrupt browser data', () => {
    expect(loadLocalTransferHistory({ getItem: () => '{invalid' })).toEqual([]);
    expect(loadLocalTransferHistory({ getItem: () => JSON.stringify([{ id: 'local-incomplete', kind: 'batch-transfer' }]) })).toEqual([]);
  });
});
