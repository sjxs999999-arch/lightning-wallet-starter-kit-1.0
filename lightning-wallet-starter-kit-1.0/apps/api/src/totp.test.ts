import { describe, expect, it } from 'vitest';
import { totpCode, verifyTotp } from './totp.js';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('operator TOTP', () => {
  it('matches RFC 6238 SHA-1 vectors at six digits', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
    expect(verifyTotp('287082', RFC_SECRET, 59_000)).toBe(true);
  });

  it('accepts a one-step clock window and rejects malformed codes', () => {
    const code = totpCode(RFC_SECRET, 90_000);
    expect(verifyTotp(code, RFC_SECRET, 120_000)).toBe(true);
    expect(verifyTotp('12345', RFC_SECRET, 90_000)).toBe(false);
    expect(verifyTotp(undefined, RFC_SECRET, 90_000)).toBe(false);
    expect(verifyTotp(undefined, undefined, 90_000)).toBe(true);
  });
});
