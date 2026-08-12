import { describe, expect, it } from 'vitest';
import { collectionPlanPayload, collectionResultPayload } from './persistence';
import type { CollectorTask } from './types';

const task: CollectorTask = { id: `0x${'2'.repeat(64)}`, chain: 'EVM', address: '0x0000000000000000000000000000000000000001', destination: '0x0000000000000000000000000000000000000002', asset: 'native', symbol: 'ETH', balance: '1', reserve: '0', collectAmount: '0.99', estimatedFee: '0.01', status: 'ready', executionStatus: 'pending', attempts: 0 };

describe('asset collection persistence payloads', () => {
  it('sends only collectable public task metadata', () => {
    const payload = collectionPlanPayload([task, { ...task, id: `0x${'3'.repeat(64)}`, address: '0x0000000000000000000000000000000000000003', collectAmount: '0' }], true, '00000000-0000-4000-8000-000000000011');
    expect(payload.tasks).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toMatch(/private|mnemonic|seed|secret/i);
  });

  it('maps raw provider failures to bounded codes', () => {
    const payload = collectionResultPayload([{ ...task, executionStatus: 'failed', error: 'Wallet provider verbose internal error' }]);
    expect(payload.outcomes[0]).toEqual({ id: task.id, status: 'failed', errorCode: 'PROVIDER_ERROR' });
    expect(JSON.stringify(payload)).not.toContain('verbose internal error');
  });

  it('retains a public transaction reference for successful collection', () => {
    const payload = collectionResultPayload([{ ...task, executionStatus: 'confirmed', txHash: 'DRY-COLLECT-1234' }]);
    expect(payload.outcomes[0]).toMatchObject({ status: 'confirmed', txHash: 'DRY-COLLECT-1234' });
  });
});
