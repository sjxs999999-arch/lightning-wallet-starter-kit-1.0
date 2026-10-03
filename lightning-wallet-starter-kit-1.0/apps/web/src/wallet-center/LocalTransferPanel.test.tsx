import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalTransferPanel } from './LocalTransferPanel';
import { LocalWalletSessionProvider } from './LocalWalletSession';
import type { VaultWallet } from './vault';

const descriptor: VaultWallet = {
  id: 'display-only-test', name: 'Display fixture', chain: 'EVM', address: '0x' + '11'.repeat(20), publicKey: '', path: '', index: 0,
  origin: 'created', hasMnemonic: false, createdAt: new Date().toISOString(),
  encryptedPrivateKey: { version: 1, ciphertext: '', iv: '' }, encryptedMnemonic: { version: 1, ciphertext: '', iv: '' },
};
afterEach(() => { vi.unstubAllEnvs();vi.unstubAllGlobals(); });
function render(enabled: boolean) {
  vi.stubEnv('VITE_LOCAL_EVM_MAINNET_ENABLED', String(enabled));vi.stubEnv('VITE_MAINNET_EXECUTION_ENABLED', 'false');
  vi.stubGlobal('localStorage', { getItem: () => null });
  return renderToStaticMarkup(<LocalWalletSessionProvider><LocalTransferPanel wallet={descriptor} vaultKey={{} as CryptoKey} tokens={[]} disabled/></LocalWalletSessionProvider>);
}
describe('local transfer network UI', () => {
  it('shows all five mainnets and defaults to Ethereum when the scoped feature is enabled', () => {
    const html = render(true);
    expect(html).toContain('MAINNET');expect(html).toMatch(/value="ethereum" selected/);
    for (const name of ['Ethereum Mainnet', 'BNB Smart Chain', 'Polygon', 'Base', 'Arbitrum One']) expect(html).toContain(name);
    expect(html).not.toContain('测试网限定');expect(html).not.toContain('主网总闸保持关闭');
  });
  it('keeps testnet as the default when both execution flags are off', () => {
    const html = render(false);
    expect(html).toContain('TESTNET');expect(html).toMatch(/value="sepolia" selected/);
  });
});
