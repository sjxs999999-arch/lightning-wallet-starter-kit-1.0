import { describe, expect, it } from 'vitest';
import { activityCsv, type ActivityItem } from './history';

describe('unified public activity export', () => {
  it('escapes spreadsheet formulas and exports no secret columns', () => {
    const item: ActivityItem = { id: '1', at: '2026-08-19T00:00:00.000Z', module: 'Swap', network: 'SOL', operation: '=HYPERLINK("bad")', status: 'confirmed', amount: '1', reference: 'hash' };
    const csv = activityCsv([item]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/privateKey|mnemonic|seedPhrase/i);
  });
});
