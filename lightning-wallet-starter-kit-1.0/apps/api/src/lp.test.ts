import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPublicLpPositions, lpPositionInputSchema, normalizeRaydiumPositions } from './lp.js';

const owner = '11111111111111111111111111111111';

afterEach(() => vi.restoreAllMocks());

describe('LP public position reader', () => {
  it('accepts only a Raydium protocol and public Solana address', () => {
    expect(lpPositionInputSchema.parse({ protocol: 'raydium', owner })).toEqual({ protocol: 'raydium', owner });
    expect(() => lpPositionInputSchema.parse({ protocol: 'raydium', owner, privateKey: 'blocked' })).toThrow();
    expect(() => lpPositionInputSchema.parse({ protocol: 'meteora', owner })).toThrow();
  });

  it('returns a bounded, public-only summary', () => {
    const result = normalizeRaydiumPositions(owner, { data: { positions: [{ poolId: 'pool-1', poolName: 'SOL-USDC', type: 'CPMM', stakedAmount: '12345', pendingRewards: [{ mint: 'RAY' }] }] } });
    expect(result).toMatchObject({ protocol: 'raydium', owner, count: 1, rewardEntries: 1, positions: [{ id: 'pool-1', label: 'SOL-USDC', kind: 'CPMM', stakedAmount: '12345', pendingRewardCount: 1 }] });
    expect(JSON.stringify(result)).not.toContain('privateKey');
  });

  it('treats the official empty response as zero positions', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 404 }));
    await expect(fetchPublicLpPositions({ protocol: 'raydium', owner })).resolves.toMatchObject({ count: 0, positions: [] });
  });
});
