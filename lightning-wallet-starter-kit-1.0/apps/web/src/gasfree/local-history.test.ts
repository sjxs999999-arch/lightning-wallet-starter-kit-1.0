import { describe, expect, it } from 'vitest';
import { loadLocalGasHistory, saveLocalGasJob } from './local-history';
import type { GasAuditJob } from './types';

describe('local GasFree history', () => {
  it('keeps public estimate metadata only', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const job: GasAuditJob = { id: 'local-one', kind: 'gas-estimate', status: 'completed', payload: { network: 'Sepolia', from: '0x1111111111111111111111111111111111111111', dryRun: true }, result: { estimatedCostWei: '1', serverSigning: false, serverBroadcast: false }, created_at: '2026-08-19T00:00:00.000Z', updated_at: '2026-08-19T00:00:00.000Z' };
    saveLocalGasJob(job, storage);
    expect(loadLocalGasHistory(storage)).toEqual([job]);
  });

  it('fails closed for incomplete records', () => {
    expect(loadLocalGasHistory({ getItem: () => JSON.stringify([{ id: 'local-bad', kind: 'gas-estimate' }]) })).toEqual([]);
  });
});
