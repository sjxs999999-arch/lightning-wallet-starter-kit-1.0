import { describe, expect, it } from 'vitest';
import { createMfaQrCode } from './mfa-qr';

describe('local Authenticator QR generation', () => {
  it('creates an in-memory PNG data URL for a TOTP enrollment URI', async () => {
    const result = await createMfaQrCode('otpauth://totp/Lightning%20Wallet:operator%40test.invalid?secret=JBSWY3DPEHPK3PXP&issuer=Lightning%20Wallet');
    expect(result.startsWith('data:image/png;base64,')).toBe(true);
    expect(result.length).toBeGreaterThan(500);
  });

  it('rejects non-Authenticator URLs before QR generation', async () => {
    await expect(createMfaQrCode('https://example.com/not-an-enrollment')).rejects.toThrow(/Invalid Authenticator/);
  });
});
