import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Vercel SUN.io route parity', () => {
  it('uses the official router and does not depend on a private TRON provider URL', () => {
    const source = readFileSync(new URL('../../web/public/api/v1/[...path].js', import.meta.url), 'utf8');
    expect(source).toContain('https://rot.endjgfsv.link/swap/routerUniversal?');
    expect(source).toContain("includeUnverifiedV4Hook:'false'");
    expect(source).toContain("provider:'SUN.io Smart Router'");
    expect(source).not.toContain('TRON_SWAP_PROVIDER_URL');
  });
});
