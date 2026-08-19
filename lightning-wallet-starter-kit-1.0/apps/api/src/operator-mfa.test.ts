import { describe, expect, it, vi } from 'vitest';
import { beginMfaEnrollment, base32Encode, confirmMfaEnrollment, decryptMfaSecret, disableOperatorMfa, encryptMfaSecret, generateRecoveryCodes, recoveryCodeHash, validMfaEncryptionKey, verifyOperatorMfa } from './operator-mfa.js';
import { totpCode } from './totp.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('operator MFA material', () => {
  it('encodes RFC 4648 base32 without padding', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('encrypts authenticator secrets with authenticated encryption', () => {
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP', KEY);
    expect(encrypted.ciphertext).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptMfaSecret(encrypted, KEY)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptMfaSecret({ ...encrypted, tag: Buffer.alloc(16).toString('base64') }, KEY)).toThrow();
  });

  it('generates non-ambiguous one-time recovery codes and keyed hashes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every(code => /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){2}$/.test(code))).toBe(true);
    expect(recoveryCodeHash(codes[0]!, KEY)).toMatch(/^[a-f0-9]{64}$/);
    expect(recoveryCodeHash(codes[0]!.replaceAll('-', '').toLowerCase(), KEY)).toBe(recoveryCodeHash(codes[0]!, KEY));
  });

  it('accepts only exact 256-bit encryption keys', () => {
    expect(validMfaEncryptionKey(KEY)).toBe(true);
    expect(validMfaEncryptionKey(Buffer.alloc(32, 8).toString('hex'))).toBe(true);
    expect(validMfaEncryptionKey('short')).toBe(false);
  });

  it('stores only encrypted enrollment material and confirms a valid TOTP', async () => {
    const beginQuery = vi.fn().mockResolvedValue({ rows: [{ email: 'ops@example.com' }] });
    const enrollment = await beginMfaEnrollment({ query: beginQuery }, 'ops@example.com', KEY, new Date(0));
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrollment.otpauthUri).toContain('otpauth://totp/Lightning%20Wallet:ops%40example.com');
    expect(JSON.stringify(beginQuery.mock.calls)).not.toContain(enrollment.secret);
    const encrypted = encryptMfaSecret(enrollment.secret, KEY);
    const confirmQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ secret_ciphertext: encrypted.ciphertext, secret_iv: encrypted.iv, secret_tag: encrypted.tag }] })
      .mockResolvedValueOnce({ rows: [{ email: 'ops@example.com' }] });
    const confirmed = await confirmMfaEnrollment({ query: confirmQuery }, 'ops@example.com', totpCode(enrollment.secret, 59_000), KEY, 59_000);
    expect(confirmed.enabled).toBe(true);
    expect(confirmed.recoveryCodes).toHaveLength(10);
    expect(JSON.stringify(confirmQuery.mock.calls)).not.toContain(enrollment.secret);
    expect(JSON.stringify(confirmQuery.mock.calls)).not.toContain(confirmed.recoveryCodes[0]);
  });

  it('consumes a recovery code once and deletes MFA only after verification', async () => {
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP', KEY);
    const code = 'ABCD-EFGH-JKLM';
    const row = { secret_ciphertext: encrypted.ciphertext, secret_iv: encrypted.iv, secret_tag: encrypted.tag, recovery_code_hashes: [recoveryCodeHash(code, KEY)], enabled: true };
    const verifyQuery = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ email: 'ops@example.com' }] });
    await expect(verifyOperatorMfa({ query: verifyQuery }, { email: 'ops@example.com', recoveryCode: code, encodedKey: KEY })).resolves.toEqual({ required: true, verified: true, recoveryUsed: true });
    expect(JSON.stringify(verifyQuery.mock.calls)).not.toContain(code);

    const disableQuery = vi.fn().mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ email: 'ops@example.com' }] }).mockResolvedValueOnce({ rows: [] });
    await expect(disableOperatorMfa({ query: disableQuery }, { email: 'ops@example.com', recoveryCode: code, encodedKey: KEY })).resolves.toEqual({ disabled: true, recoveryUsed: true });
    expect(disableQuery.mock.calls[2]?.[0]).toContain('DELETE FROM operator_mfa');
  });
});
