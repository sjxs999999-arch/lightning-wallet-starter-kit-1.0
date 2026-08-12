import { describe, expect, it, vi } from 'vitest';
import { createTransferJob, listTransferJobs, transferPlanSchema, transferResultSchema, updateTransferJob } from './transfers.js';

const task = { id: `0x${'1'.repeat(64)}`, row: 2, from: '0x0000000000000000000000000000000000000001', to: '0x0000000000000000000000000000000000000002', amount: '0.01', assetKind: 'native' as const, estimatedFee: '0.00021' };
const plan = { idempotencyKey: '00000000-0000-4000-8000-000000000001', chain: 'EVM' as const, mode: 'one-to-many' as const, dryRun: true, totalAmount: '0.01', totalEstimatedFee: '0.00021', tasks: [task] };

describe('batch transfer persistence', () => {
  it('accepts public plan metadata and rejects secret fields', () => {
    expect(transferPlanSchema.parse(plan).tasks).toHaveLength(1);
    expect(() => transferPlanSchema.parse({ ...plan, privateKey: 'blocked' })).toThrow();
  });
  it('persists only the allowlisted plan shape', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'job', status: 'validated' }] });
    await createTransferJob({ query }, plan);
    expect(query).toHaveBeenCalledOnce();
    expect(JSON.stringify(query.mock.calls[0]?.[1])).not.toMatch(/private|mnemonic|secret/i);
  });
  it('requires safe result codes rather than provider messages', () => {
    expect(transferResultSchema.parse({ outcomes: [{ id: task.id, status: 'failed', errorCode: 'PROVIDER_ERROR' }] })).toBeTruthy();
    expect(() => transferResultSchema.parse({ outcomes: [{ id: task.id, status: 'failed', error: 'raw provider detail' }] })).toThrow();
  });
  it('derives completion status and updates the existing job', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ payload: { count: 1, dryRun: true } }] }).mockResolvedValueOnce({ rows: [{ id: 'job', status: 'completed' }] });
    const result = await updateTransferJob({ query }, '00000000-0000-4000-8000-000000000002', { outcomes: [{ id: task.id, status: 'confirmed', txHash: 'DRY-RUN-12345678' }] });
    expect(result).toMatchObject({ status: 'completed' });
    expect(query.mock.calls[1]?.[1]?.[2]).toMatchObject({ confirmed: 1, serverBroadcast: false });
  });
  it('lists only transfer jobs with a bounded limit', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listTransferJobs({ query }, { limit: 10 });
    expect(query.mock.calls[0]?.[0]).toContain("kind='batch-transfer'");
    expect(query.mock.calls[0]?.[1]).toEqual([10]);
  });
});
