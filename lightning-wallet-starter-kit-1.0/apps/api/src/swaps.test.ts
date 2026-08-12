import { describe, expect, it, vi } from 'vitest';
import { createSwapJob, listSwapJobs, swapPlanSchema, swapResultSchema, updateSwapJob } from './swaps.js';

const plan = { idempotencyKey: '00000000-0000-4000-8000-000000000021', chain: 'SOL' as const, dryRun: true, taker: '11111111111111111111111111111111', sellToken: 'So11111111111111111111111111111111111111112', buyToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', sellAmount: '1000000', slippageBps: 50, provider: 'Jupiter', amountIn: '1000000', amountOut: '150000', minReceived: '149000', priceImpactPct: 0.1, route: ['Raydium'] };

describe('swap persistence', () => {
  it('accepts public quote metadata and rejects secret or transaction fields', () => {
    expect(swapPlanSchema.parse(plan).provider).toBe('Jupiter');
    expect(() => swapPlanSchema.parse({ ...plan, privateKey: 'blocked' })).toThrow();
    expect(() => swapPlanSchema.parse({ ...plan, raw: { transaction: 'blocked' } })).toThrow();
  });
  it('persists only safe quote metadata', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'job', status: 'validated' }] });
    await createSwapJob({ query }, plan);
    expect(JSON.stringify(query.mock.calls[0]?.[1])).not.toMatch(/private|mnemonic|transaction|raw/i);
  });
  it('requires bounded results', () => {
    expect(swapResultSchema.parse({ status: 'simulated' })).toEqual({ status: 'simulated' });
    expect(() => swapResultSchema.parse({ status: 'failed', error: 'raw provider error' })).toThrow();
  });
  it('completes a dry-run without server broadcast', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ payload: plan }] }).mockResolvedValueOnce({ rows: [{ id: 'job', status: 'completed' }] });
    const result = await updateSwapJob({ query }, '00000000-0000-4000-8000-000000000022', { status: 'simulated' });
    expect(result).toMatchObject({ status: 'completed', result: { status: 'simulated', serverSigning: false, serverBroadcast: false } });
  });
  it('lists only swap jobs with a bounded limit', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await listSwapJobs({ query }, { limit: 7 });
    expect(query.mock.calls[0]?.[0]).toContain("kind='swap'");
    expect(query.mock.calls[0]?.[1]).toEqual([7]);
  });
});
