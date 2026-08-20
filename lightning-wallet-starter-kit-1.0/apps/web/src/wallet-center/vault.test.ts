import { describe, expect, it } from 'vitest';
import { deriveWallet, newMnemonic } from '../batch-wallet/engine';
import { createVault, encryptVaultWallet, parseVault, saveVault, unlockVault, WALLET_VAULT_STORAGE_KEY } from './vault';

describe('local wallet vault', () => {
  it('persists only encrypted key material and unlocks with the correct password', async () => {
    const password = 'correct horse battery staple';
    const mnemonic = newMnemonic();
    const derived = await deriveWallet('EVM', mnemonic, 0);
    const created = await createVault(password);
    const record = await encryptVaultWallet(created.key, {
      id: crypto.randomUUID(), name: 'Primary', chain: 'EVM', address: derived.address,
      publicKey: derived.publicKey, path: derived.path, index: 0, origin: 'created', createdAt: new Date().toISOString(),
    }, derived.privateKey, mnemonic);
    const vault = { ...created.vault, wallets: [record] };
    let stored = '';
    saveVault(vault, { setItem: (key, value) => { expect(key).toBe(WALLET_VAULT_STORAGE_KEY);stored = value; } });
    expect(stored).not.toContain(derived.privateKey);
    expect(stored).not.toContain(mnemonic);
    expect(parseVault(stored)?.wallets[0]?.address).toBe(derived.address);
    await expect(unlockVault(vault, password)).resolves.toBeDefined();
    await expect(unlockVault(vault, 'wrong password value')).rejects.toThrow('密码错误');
  });

  it('rejects plaintext secret fields and duplicate addresses', async () => {
    const created = await createVault('another secure vault password');
    const unsafe = { ...created.vault, privateKey: '0xdeadbeef' };
    expect(() => parseVault(JSON.stringify(unsafe))).toThrow('格式无效');
  });
});
