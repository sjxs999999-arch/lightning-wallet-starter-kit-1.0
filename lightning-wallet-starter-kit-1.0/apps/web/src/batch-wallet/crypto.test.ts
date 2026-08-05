import { describe, expect, it } from 'vitest';
import {
  createExportKey,
  decryptValue,
  deriveExportKey,
  encryptValue,
} from './crypto';

describe('batch wallet export encryption', () => {
  it('encrypts secret material and rejects the wrong password', async () => {
    const password = 'correct-horse-battery-staple';
    const secret = 'never-store-this-private-key';
    const { key, salt } = await createExportKey(password);
    const encrypted = await encryptValue(key, secret);

    expect(JSON.stringify(encrypted)).not.toContain(secret);

    const restoredKey = await deriveExportKey(password, salt);
    await expect(decryptValue(restoredKey, encrypted)).resolves.toBe(secret);

    const wrongKey = await deriveExportKey('wrong-password-value', salt);
    await expect(decryptValue(wrongKey, encrypted)).rejects.toThrow();
  });
});
