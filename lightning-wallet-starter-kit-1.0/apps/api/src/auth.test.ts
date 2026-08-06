import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyOperatorCredentials } from './auth.js';

function encoded(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 32).toString('hex')}`;
}

describe('operator credentials', () => {
  it('accepts only the configured email and password', () => {
    const hash = encoded('a-strong-production-password');
    expect(verifyOperatorCredentials('ops@example.com', 'a-strong-production-password', 'ops@example.com', hash)).toBe(true);
    expect(verifyOperatorCredentials('attacker@example.com', 'a-strong-production-password', 'ops@example.com', hash)).toBe(false);
    expect(verifyOperatorCredentials('ops@example.com', 'wrong-password', 'ops@example.com', hash)).toBe(false);
  });

  it('rejects malformed hashes', () => {
    expect(verifyOperatorCredentials('ops@example.com', 'password', 'ops@example.com', 'invalid')).toBe(false);
  });
});
