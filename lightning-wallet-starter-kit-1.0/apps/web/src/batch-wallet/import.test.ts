import { describe, expect, it } from 'vitest';
import { createExportKey, decryptValue, deriveExportKey, encryptValue } from './crypto';
import { deriveWallet, newMnemonic } from './engine';
import { parseEncryptedWalletBackup } from './import';
import type { BatchChain, LocalWalletRecord } from './types';
import { verifyWalletControl } from './verification';

const encrypted = { ciphertext: 'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB', iv: 'QUFBQUFBQUFBQUFB', version: 1 as const };
const header = { format: 'lightning-wallet-encrypted-v1', algorithm: 'AES-256-GCM', kdf: { name: 'PBKDF2-SHA-256', iterations: 600000, salt: 'QUFBQUFBQUFBQUFBQUFBQQ==' } };

async function recordFor(chain: BatchChain, index = 0): Promise<LocalWalletRecord> {
  const wallet = await deriveWallet(chain, newMnemonic(), index);
  return { id: `${chain}-${index}`, name: `${chain}-Wallet-${String(index + 1).padStart(4, '0')}`, chain, address: wallet.address, publicKey: wallet.publicKey, path: wallet.path, index, encryptedPrivateKey: encrypted, encryptedMnemonic: encrypted, createdAt: '2026-08-07T00:00:00.000Z' };
}

describe('encrypted wallet backup import', () => {
  it.each(['EVM', 'SOL', 'TRON'] as const)('loads encrypted %s records and preserves chain metadata', async chain => {
    const wallet = await recordFor(chain);
    const result = parseEncryptedWalletBackup(JSON.stringify({ ...header, wallets: [wallet] }));
    expect(result).toMatchObject({ chain, salt: header.kdf.salt });
    expect(result.wallets).toEqual([wallet]);
  });

  it('rejects plaintext secret fields', async () => {
    const wallet = await recordFor('TRON');
    expect(() => parseEncryptedWalletBackup(JSON.stringify({ ...header, wallets: [{ ...wallet, privateKey: 'secret' }] }))).toThrow(/明文私钥/);
  });

  it('rejects unsupported formats and excessive batches', async () => {
    const wallet = await recordFor('TRON');
    expect(() => parseEncryptedWalletBackup('{}')).toThrow(/不支持/);
    expect(() => parseEncryptedWalletBackup(JSON.stringify({ ...header, wallets: Array(1001).fill(wallet) }))).toThrow(/1–1000/);
  });

  it('rejects mixed-chain and tampered public metadata', async () => {
    const evm = await recordFor('EVM');
    const otherEvm = await recordFor('EVM', 1);
    const sol = await recordFor('SOL', 1);
    expect(() => parseEncryptedWalletBackup(JSON.stringify({ ...header, wallets: [evm, sol] }))).toThrow(/同一网络/);
    expect(() => parseEncryptedWalletBackup(JSON.stringify({ ...header, wallets: [{ ...evm, address: otherEvm.address }] }))).toThrow(/字段无效/);
  });

  it.each(['EVM', 'SOL', 'TRON'] as const)('restores and verifies an encrypted %s wallet without exposing secrets', async chain => {
    const wallet = await deriveWallet(chain, newMnemonic(), 0);
    const password = 'unique-offline-password';
    const derived = await createExportKey(password);
    const record: LocalWalletRecord = { id: `${chain}-roundtrip`, name: `${chain}-Wallet-0001`, chain, address: wallet.address, publicKey: wallet.publicKey, path: wallet.path, index: 0, encryptedPrivateKey: await encryptValue(derived.key, wallet.privateKey), encryptedMnemonic: await encryptValue(derived.key, wallet.mnemonic), createdAt: new Date().toISOString() };
    const json = JSON.stringify({ ...header, kdf: { ...header.kdf, salt: derived.salt }, wallets: [record] });
    expect(json).not.toContain(wallet.privateKey);
    expect(json).not.toContain(wallet.mnemonic);
    const imported = parseEncryptedWalletBackup(json);
    const key = await deriveExportKey(password, imported.salt);
    const privateKey = await decryptValue(key, imported.wallets[0]!.encryptedPrivateKey);
    expect((await verifyWalletControl(chain, imported.wallets[0]!, privateKey)).pass).toBe(true);
  }, 30_000);
});
