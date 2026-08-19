import { describe, expect, it } from 'vitest';
import { loadProviderHistory, saveProviderHistory } from './history';

describe('wallet provider public history', () => {
  it('drops verbose provider errors and keeps public connection metadata', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const rows = saveProviderHistory({ wallet: 'MetaMask', family: 'EVM', network: 'Sepolia', address: '0x1111111111111111111111111111111111111111', operation: 'sign', status: 'failed', error: 'provider verbose secret' }, storage);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('provider verbose secret');
  });

  it('ignores malformed injected records', () => {
    expect(loadProviderHistory({ getItem: () => JSON.stringify([{ id: 'bad' }]) })).toEqual([]);
  });
});
