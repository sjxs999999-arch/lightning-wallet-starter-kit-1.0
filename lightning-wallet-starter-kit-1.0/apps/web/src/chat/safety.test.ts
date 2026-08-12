import { describe, expect, it } from 'vitest';
import { addressLooksValid, sensitiveMaterialReason } from './safety';

describe('chat safety', () => {
  it('blocks private key shaped content', () => expect(sensitiveMaterialReason(`0x${'a'.repeat(64)}`)).toContain('私钥'));
  it('blocks private keys embedded in structured payment fields', () => expect(sensitiveMaterialReason(JSON.stringify({ asset: `0x${'a'.repeat(64)}` }))).toContain('私钥'));
  it('accepts normal messages', () => expect(sensitiveMaterialReason('明天见，请发付款请求')).toBeNull());
  it('validates representative addresses', () => {
    expect(addressLooksValid('EVM', `0x${'a'.repeat(40)}`)).toBe(true);
    expect(addressLooksValid('TRON', `T${'A'.repeat(33)}`)).toBe(true);
    expect(addressLooksValid('SOL', '11111111111111111111111111111111')).toBe(true);
  });
});
