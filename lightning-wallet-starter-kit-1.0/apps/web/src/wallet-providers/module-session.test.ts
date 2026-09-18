import { describe, expect, it } from 'vitest';
import { connectedEvmProvider, connectedWalletAddress, evmChainIdNumber, matchingConnectedSolanaProvider, requireConnectedWallet, sameWalletAddress, shortWalletAddress } from './module-session';
import type { ConnectedWallet } from './types';

const provider = { request: async () => [] };
const evm: ConnectedWallet = {
  name: 'MetaMask', family: 'EVM', address: '0x0000000000000000000000000000000000000001',
  network: 'Ethereum Mainnet', mode: 'mainnet', chainId: '0x1', readOnly: true, provider,
};

describe('shared external wallet module session', () => {
  it('reuses the exact connected provider without exposing secret material', () => {
    expect(connectedEvmProvider(evm, '0x0000000000000000000000000000000000000001')).toBe(provider);
    expect(JSON.stringify(evm)).not.toMatch(/privateKey|mnemonic|seedPhrase/i);
  });

  it('normalizes EVM addresses while keeping non-EVM addresses exact', () => {
    expect(sameWalletAddress('EVM', evm.address, evm.address.toUpperCase().replace('0X', '0x'))).toBe(true);
    expect(sameWalletAddress('SOL', 'Abc', 'abc')).toBe(false);
  });

  it('fails closed on a missing, wrong-family, or mismatched shared wallet', () => {
    expect(() => requireConnectedWallet(null, 'EVM')).toThrow(/钱包中心/);
    expect(() => requireConnectedWallet({ ...evm, family: 'SOL' }, 'EVM')).toThrow(/切换/);
    expect(() => requireConnectedWallet(evm, 'EVM', '0x0000000000000000000000000000000000000002')).toThrow(/不一致/);
  });

  it('provides public autofill metadata only for a matching family', () => {
    expect(connectedWalletAddress(evm, 'EVM')).toBe(evm.address);
    expect(connectedWalletAddress(evm, 'TRON')).toBe('');
    expect(evmChainIdNumber(evm)).toBe(1);
    expect(shortWalletAddress(evm.address)).toBe('0x000000…000001');
  });

  it('uses the shared Solana provider only for the exact active row and otherwise permits injected-wallet fallback', () => {
    const solProvider = { signAndSendTransaction: async () => ({ signature: 'signature' }) };
    const sol: ConnectedWallet = { name: 'Phantom', family: 'SOL', address: 'row-one', network: 'Solana Mainnet', mode: 'mainnet', chainId: 'mainnet', readOnly: true, provider: solProvider };
    expect(matchingConnectedSolanaProvider(sol, 'row-one')).toBe(solProvider);
    expect(matchingConnectedSolanaProvider(sol, 'row-two')).toBeUndefined();
    expect(matchingConnectedSolanaProvider(null, 'row-two')).toBeUndefined();
  });
});
