import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { configSchema } from './config.js';

describe('production optional provider configuration', () => {
  it('normalizes empty optional provider values before URL and length validation', () => {
    const source = readFileSync(new URL('./config.ts', import.meta.url), 'utf8');
    expect(source).toContain("GASFREE_PROVIDER_URL: z.preprocess(value=>value===''?undefined:value");
    expect(source).toContain("WEBHOOK_SIGNING_SECRET:z.preprocess(value=>value===''?undefined:value");
  });

  it('requires a distinct chat signing secret in production', () => {
    const production = { NODE_ENV: 'production', JWT_SECRET: 'o'.repeat(32), CHAT_JWT_SECRET: 'c'.repeat(32), ADMIN_PASSWORD_HASH: `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}` };
    expect(configSchema.safeParse(production).success).toBe(true);
    expect(configSchema.safeParse({ ...production, CHAT_JWT_SECRET: production.JWT_SECRET }).success).toBe(false);
    expect(configSchema.safeParse({ ...production, CHAT_JWT_SECRET: undefined }).success).toBe(false);
  });

  it('accepts only exact 256-bit operator MFA encryption keys', () => {
    const base = { NODE_ENV: 'test', OPERATOR_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') };
    expect(configSchema.safeParse(base).success).toBe(true);
    expect(configSchema.safeParse({ ...base, OPERATOR_MFA_ENCRYPTION_KEY: 'too-short' }).success).toBe(false);
    expect(configSchema.safeParse({ ...base, OPERATOR_MFA_ENCRYPTION_KEY: '' }).success).toBe(true);
  });
});
