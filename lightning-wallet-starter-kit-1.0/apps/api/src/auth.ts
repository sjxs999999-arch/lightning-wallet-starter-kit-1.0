import { scryptSync, timingSafeEqual } from 'node:crypto';

const HASH_BYTES = 32;

export function verifyOperatorCredentials(
  email: string,
  password: string,
  expectedEmail: string,
  encodedHash: string,
): boolean {
  const [scheme, saltHex, digestHex, extra] = encodedHash.split('$');
  if (scheme !== 'scrypt' || extra !== undefined) return false;
  if (!/^[a-f0-9]{32}$/i.test(saltHex ?? '') || !/^[a-f0-9]{64}$/i.test(digestHex ?? '')) return false;

  const emailMatches = email.trim().toLowerCase() === expectedEmail.trim().toLowerCase();
  const expected = Buffer.from(digestHex!, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex!, 'hex'), HASH_BYTES);
  return emailMatches && timingSafeEqual(actual, expected);
}
