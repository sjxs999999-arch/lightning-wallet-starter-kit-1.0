import { describe, expect, it } from 'vitest';
import { loadLocalTransferHistory, saveLocalTransferHistory } from './local-transfer-history';

describe('local transfer public history', () => {
  it('stores public metadata and rejects unexpected secret fields', () => {
    let stored = '';
    saveLocalTransferHistory([{
      id: '1', walletId: 'wallet-1', chain: 'EVM', network: 'Sepolia', from: '0xfrom', to: '0xto',
      asset: 'ETH', amount: '0.1', hash: '0xhash', state: 'confirmed', createdAt: new Date().toISOString(),
    }], { setItem: (_key, value) => { stored = value; } });
    expect(stored).not.toMatch(/private|mnemonic|secret/i);
    expect(loadLocalTransferHistory({ getItem: () => stored })).toHaveLength(1);
    expect(loadLocalTransferHistory({ getItem: () => JSON.stringify([{ ...JSON.parse(stored)[0], privateKey: 'unsafe' }]) })).toEqual([]);
  });
});

