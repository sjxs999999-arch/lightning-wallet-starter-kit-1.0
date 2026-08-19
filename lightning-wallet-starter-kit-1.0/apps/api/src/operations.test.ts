import { describe, expect, it, vi } from 'vitest';
import { listOperationActivity, publicOperationActivity } from './operations.js';

describe('operator operation activity', () => {
  it('returns only normalized public metadata', () => {
    const value = publicOperationActivity({ id: '12345678', kind: 'swap', status: 'completed', payload: { chain: 'SOL', provider: 'Jupiter', amountIn: '1', amountOut: '2', privateKey: 'blocked' }, result: { txHash: 'abcdefgh12345678', signature: 'blocked' }, updated_at: '2026-08-19T00:00:00.000Z' });
    expect(value).toMatchObject({ module: '闪电兑换', network: 'SOL', reference: 'abcdefgh12345678' });
    expect(JSON.stringify(value)).not.toMatch(/privateKey|signature|blocked/);
  });

  it('queries a bounded allowlist of job kinds', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(listOperationActivity({ query }, { limit: 20 })).resolves.toEqual([]);
    expect(query.mock.calls[0]?.[1]?.[0]).toContain('batch-transfer');
    expect(query.mock.calls[0]?.[1]?.[1]).toBe(20);
  });
});
