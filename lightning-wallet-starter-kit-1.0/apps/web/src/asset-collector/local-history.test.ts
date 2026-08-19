import { describe, expect, it } from 'vitest';
import { loadLocalCollectionHistory, saveLocalCollectionJob } from './local-history';
import type { CollectionJob } from './persistence';

describe('local collection history', () => {
  it('persists local collection status across browser reloads', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const job: CollectionJob = { id: 'local-1', kind: 'asset-collection', status: 'completed', payload: { chain: 'SOL', dryRun: true, destination: 'destination', count: 1, nativeCount: 1, tokenCount: 0 }, result: { dryRun: true, serverSigning: false, serverBroadcast: false, confirmed: 1, failed: 0, pending: 0 }, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() };
    saveLocalCollectionJob(job, storage);
    expect(loadLocalCollectionHistory(storage)).toEqual([job]);
  });

  it('ignores non-local records injected into storage', () => {
    const value = JSON.stringify([{ id: 'server-id', kind: 'asset-collection' }, { id: 'local-incomplete', kind: 'asset-collection' }]);
    expect(loadLocalCollectionHistory({ getItem: () => value })).toEqual([]);
  });
});
