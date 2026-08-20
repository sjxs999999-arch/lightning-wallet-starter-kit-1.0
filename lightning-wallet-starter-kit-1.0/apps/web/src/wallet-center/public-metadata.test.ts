import { describe, expect, it } from 'vitest';
import { makeAddressBookEntry, makeCustomToken } from './public-metadata';

describe('wallet public metadata validation', () => {
  it('accepts checksummed EVM address-book and token records', () => {
    const address = '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a';
    expect(makeAddressBookEntry('Treasury', 'EVM', address).address).toBe(address);
    expect(makeCustomToken('wallet-1', 'EVM', 'usdt', address, 18).symbol).toBe('USDT');
  });

  it('rejects invalid public metadata', () => {
    expect(() => makeAddressBookEntry('', 'SOL', 'bad')).toThrow();
    expect(() => makeCustomToken('wallet-1', 'TRON', 'bad symbol!', 'bad', 31)).toThrow();
  });
});
