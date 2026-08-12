import { describe, expect, it, vi } from 'vitest';
import { collectionPlanSchema, createCollectionJob, listCollectionJobs, updateCollectionJob } from './collections.js';

const task = { id: `0x${'2'.repeat(64)}`, address: '0x0000000000000000000000000000000000000001', destination: '0x0000000000000000000000000000000000000002', amount: '0.99', assetKind: 'native' as const, symbol: 'ETH', estimatedFee: '0.00021' };
const plan = { idempotencyKey: '00000000-0000-4000-8000-000000000011', chain: 'EVM' as const, dryRun: true, destination: task.destination, tasks: [task] };

describe('asset collection persistence', () => {
  it('accepts public collection metadata and rejects secret fields', () => {
    expect(collectionPlanSchema.parse(plan).tasks).toHaveLength(1);
    expect(() => collectionPlanSchema.parse({ ...plan, privateKey: 'blocked' })).toThrow();
  });

  it('requires every task to use the plan destination', () => {
    expect(() => collectionPlanSchema.parse({ ...plan, destination: '0x0000000000000000000000000000000000000003' })).toThrow();
  });

  it('persists only the allowlisted public plan shape', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'job', status: 'validated' }] });
    await createCollectionJob({ query }, plan);
    expect(JSON.stringify(query.mock.calls[0]?.[1])).not.toMatch(/private|mnemonic|secret/i);
    expect(query.mock.calls[0]?.[0]).toContain("'asset-collection'");
  });

  it('derives completion status and keeps server signing disabled', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ payload: { ...plan, count: 1, nativeCount: 1, tokenCount: 0 } }] }).mockResolvedValueOnce({ rows: [{ id: 'job', status: 'completed' }] });
    const result = await updateCollectionJob({ query }, '00000000-0000-4000-8000-000000000012', { outcomes: [{ id: task.id, status: 'confirmed', txHash: 'DRY-COLLECT-1234' }] });
    expect(result).toMatchObject({ status: 'completed', result: { confirmed: 1, serverSigning: false, serverBroadcast: false } });
  });

  it('lists only collection jobs with a bounded limit', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listCollectionJobs({ query }, { limit: 12 });
    expect(query.mock.calls[0]?.[0]).toContain("kind='asset-collection'");
    expect(query.mock.calls[0]?.[1]).toEqual([12]);
  });
});
