import { describe, expect, it } from 'vitest';
import { flashLoanLocalJob, loadLocalFlashLoanHistory, saveLocalFlashLoanJob } from './local-history';

describe('local flash loan audit history', () => {
  it('stores Dry Run metadata without a transaction hash or secrets', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const job = flashLoanLocalJob({ id: 'one', createdAt: '2026-08-19T00:00:00.000Z', network: 'sepolia', status: 'dry-run', protocol: 'Aave', asset: 'ETH', amount: '1' });
    saveLocalFlashLoanJob(job, storage);
    expect(loadLocalFlashLoanHistory(storage)).toEqual([job]);
    expect([...values.values()].join('')).not.toMatch(/privateKey|mnemonic|transactionHash":"0x/i);
  });

  it('ignores corrupt or incomplete injected records', () => {
    expect(loadLocalFlashLoanHistory({ getItem: () => JSON.stringify([{ id: 'local-bad', kind: 'flash-loan' }]) })).toEqual([]);
  });
});
