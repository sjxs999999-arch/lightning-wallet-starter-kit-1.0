import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('production optional provider configuration', () => {
  it('normalizes empty optional provider values before URL and length validation', () => {
    const source = readFileSync(new URL('./config.ts', import.meta.url), 'utf8');
    expect(source).toContain("TRON_SWAP_PROVIDER_URL:z.preprocess(value=>value===''?undefined:value");
    expect(source).toContain("WEBHOOK_SIGNING_SECRET:z.preprocess(value=>value===''?undefined:value");
  });
});
