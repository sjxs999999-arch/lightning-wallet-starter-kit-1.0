import { describe, expect, it } from 'vitest';
import { loadLocalSwapHistory, saveLocalSwapJob } from './local-history';
import type { SwapJob } from './persistence';

const job: SwapJob = { id: 'local-1', kind: 'swap', status: 'validated', payload: { chain: 'SOL', dryRun: true, taker: '11111111111111111111111111111111', sellToken: 'So11111111111111111111111111111111111111112', buyToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', sellAmount: '1', slippageBps: 50, provider: 'Jupiter', amountIn: '1', amountOut: '2', minReceived: '1', priceImpactPct: 0.1, route: ['Jupiter'] }, result: { status: 'validated', dryRun: true, serverSigning: false, serverBroadcast: false }, created_at: '2026-08-19T00:00:00.000Z', updated_at: '2026-08-19T00:00:00.000Z' };

describe('local swap history', () => {
  it('persists only public swap metadata across reloads', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    saveLocalSwapJob(job, storage);
    expect(loadLocalSwapHistory(storage)).toEqual([job]);
    expect([...values.values()].join('')).not.toMatch(/privateKey|mnemonic|seedPhrase/);
  });
});
