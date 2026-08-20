import { describe, expect, it } from 'vitest';
import { deriveWallet, newMnemonic } from '../batch-wallet/engine';
import { importPrivateWallet } from './import';

describe('local private-key import', () => {
  for (const chain of ['EVM', 'SOL', 'TRON'] as const) {
    it(`reconstructs the ${chain} address locally`, async () => {
      const source = await deriveWallet(chain, newMnemonic(), 0);
      const imported = importPrivateWallet(chain, source.privateKey);
      expect(imported.address).toBe(source.address);
      expect(imported.publicKey).toBe(source.publicKey);
    });
  }

  it('rejects malformed private keys', () => {
    expect(() => importPrivateWallet('EVM', 'not-a-key')).toThrow('32 字节');
    expect(() => importPrivateWallet('SOL', 'not-a-key')).toThrow();
  });
});
