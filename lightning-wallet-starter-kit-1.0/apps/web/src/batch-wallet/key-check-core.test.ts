import { describe,expect,it } from 'vitest';
import { createExportKey,decryptBytes,deriveExportKey,encryptBytes,encryptValue } from './crypto';
import { validateEncryptedValue } from './key-check-core';

describe('worker export password validation',()=>{
  it('validates AES-GCM data without returning plaintext',async()=>{const password='worker-only-export-password',created=await createExportKey(password),encrypted=await encryptValue(created.key,'0x0123456789abcdef');expect(await validateEncryptedValue(await deriveExportKey(password,created.salt),encrypted)).toBe(true);expect(await validateEncryptedValue(await deriveExportKey('wrong-worker-password',created.salt),encrypted)).toBe(false)});
});

it('encrypts raw local key bytes without serializing them into an export field',async()=>{const original=Uint8Array.from([1,2,3,4,5]),created=await createExportKey('worker-only-export-password'),encrypted=await encryptBytes(created.key,original),decrypted=await decryptBytes(await deriveExportKey('worker-only-export-password',created.salt),encrypted);expect([...decrypted]).toEqual([...original]);expect(JSON.stringify(encrypted)).not.toContain('1,2,3,4,5');decrypted.fill(0);original.fill(0)});
