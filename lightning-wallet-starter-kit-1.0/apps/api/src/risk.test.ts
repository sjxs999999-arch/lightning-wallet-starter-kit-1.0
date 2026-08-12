import { describe, expect, it } from 'vitest';
import { riskTokenSchema } from './risk.js';

describe('riskTokenSchema', () => {
  it('accepts public token addresses only', () => expect(riskTokenSchema.parse({ chain: '1', address: '0x0000000000000000000000000000000000000001' }).chain).toBe('1'));
  it('rejects extra secret fields and short input', () => {
    expect(() => riskTokenSchema.parse({ chain: '1', address: 'short' })).toThrow();
    expect(() => riskTokenSchema.parse({ chain: '1', address: '0x0000000000000000000000000000000000000001', privateKey: 'never' })).toThrow();
  });
});
