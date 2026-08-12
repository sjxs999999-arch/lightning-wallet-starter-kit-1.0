import { describe, expect, it } from 'vitest';
import { transferPlanPayload, transferResultPayload } from './persistence';
import type { TransferPlan } from './types';

const plan: TransferPlan = { chain: 'EVM', mode: 'one-to-many', dryRun: true, totalAmount: '0.01', totalEstimatedFee: '0.00021', risks: [], tasks: [{ id: `0x${'1'.repeat(64)}`, row: 2, chain: 'EVM', assetKind: 'native', from: '0x0000000000000000000000000000000000000001', to: '0x0000000000000000000000000000000000000002', amount: '0.01', status: 'pending', attempts: 0, estimatedFee: '0.00021' }] };

describe('batch transfer persistence payloads', () => {
  it('sends only public plan metadata', () => {
    const payload = transferPlanPayload(plan, '00000000-0000-4000-8000-000000000001');
    expect(payload.tasks[0]).toEqual(expect.objectContaining({ from: plan.tasks[0]?.from, to: plan.tasks[0]?.to }));
    expect(JSON.stringify(payload)).not.toMatch(/private|mnemonic|seed|secret/i);
  });
  it('maps raw provider errors to bounded codes', () => {
    const tasks = [{ ...plan.tasks[0]!, status: 'failed' as const, error: 'Wallet provider leaked a verbose internal message' }];
    const payload = transferResultPayload(tasks);
    expect(payload.outcomes[0]).toEqual({ id: tasks[0]?.id, status: 'failed', errorCode: 'PROVIDER_ERROR' });
    expect(JSON.stringify(payload)).not.toContain('verbose internal message');
  });
  it('retains public transaction references for confirmed tasks', () => {
    const tasks = [{ ...plan.tasks[0]!, status: 'confirmed' as const, txHash: 'DRY-RUN-12345678' }];
    expect(transferResultPayload(tasks).outcomes[0]).toMatchObject({ status: 'confirmed', txHash: 'DRY-RUN-12345678' });
  });
});
