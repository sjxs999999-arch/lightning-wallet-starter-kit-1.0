import { describe, expect, it } from 'vitest';
import { createExportKey, encryptValue } from './crypto';
import { deriveWallet, deriveWalletPublicBatch, newMnemonic } from './engine';
import { MigrationError, recoverMigrationSecretBytes } from './migration-core';
import type { BatchChain, LocalWalletRecord } from './types';

const decoder = new TextDecoder();

async function encryptedBatch(chain: BatchChain, count = 3) {
  const mnemonic = newMnemonic();
  const password = 'unique-offline-password';
  const { key } = await createExportKey(password);
  const wallets: LocalWalletRecord[] = [];
  for (let index = 0; index < count; index++) {
    const wallet = await deriveWallet(chain, mnemonic, index);
    wallets.push({
      id: `${chain}-${index}`,
      name: `${chain}-Wallet-${index + 1}`,
      chain,
      address: wallet.address,
      publicKey: wallet.publicKey,
      path: wallet.path,
      index,
      encryptedPrivateKey: await encryptValue(key, wallet.privateKey),
      encryptedMnemonic: await encryptValue(key, wallet.mnemonic),
      createdAt: new Date().toISOString(),
    });
    wallet.privateKey = '';
    wallet.mnemonic = '';
  }
  return { key, mnemonic, wallets };
}

describe.each(['SOL', 'EVM', 'TRON'] as const)('%s migration recovery', chain => {
  it('reveals a selected private key only after proving address control', async () => {
    const { key, wallets } = await encryptedBatch(chain);
    const selected = wallets[1]!;
    const recovered = await recoverMigrationSecretBytes(key, selected, 'privateKey');
    expect(recovered).toMatchObject({ walletId: selected.id, address: selected.address, kind: 'privateKey' });
    expect(recovered.secretBytes.length).toBeGreaterThan(20);
    recovered.secretBytes.fill(0);
  });

  it('reveals a mnemonic only after rederiving the selected address and path', async () => {
    const { key, mnemonic, wallets } = await encryptedBatch(chain);
    const selected = wallets[2]!;
    const progress: Array<[number, number]> = [];
    const recovered = await recoverMigrationSecretBytes(
      key,
      selected,
      'mnemonic',
      wallets,
      (completed, total) => progress.push([completed, total]),
    );
    expect(decoder.decode(recovered.secretBytes)).toBe(mnemonic);
    expect(recovered).toMatchObject({ walletId: selected.id, address: selected.address, path: selected.path, kind: 'mnemonic', verifiedCount: wallets.length });
    expect(progress).toEqual([[wallets.length, wallets.length]]);
    recovered.secretBytes.fill(0);
  });

  it('blocks a mismatched claimed address', async () => {
    const { key, wallets } = await encryptedBatch(chain);
    const tampered = { ...wallets[0]!, address: wallets[1]!.address };
    await expect(recoverMigrationSecretBytes(key, tampered, 'privateKey')).rejects.toMatchObject({ code: 'ADDRESS_MISMATCH' } satisfies Partial<MigrationError>);
    await expect(recoverMigrationSecretBytes(key, tampered, 'mnemonic', [tampered])).rejects.toMatchObject({ code: 'ADDRESS_MISMATCH' } satisfies Partial<MigrationError>);
  });

  it('blocks the shared mnemonic if any wallet in the batch does not match', async () => {
    const { key, wallets } = await encryptedBatch(chain);
    const other = await encryptedBatch(chain);
    const mixed = [wallets[0]!, { ...wallets[1]!, address: other.wallets[1]!.address, publicKey: other.wallets[1]!.publicKey }];
    await expect(recoverMigrationSecretBytes(key, wallets[0]!, 'mnemonic', mixed)).rejects.toMatchObject({ code: 'ADDRESS_MISMATCH' } satisfies Partial<MigrationError>);
  });
});

it('returns only a fixed error code for a wrong password', async () => {
  const original = await encryptedBatch('SOL');
  const wrong = await createExportKey('another-offline-password');
  await expect(recoverMigrationSecretBytes(wrong.key, original.wallets[0]!, 'privateKey')).rejects.toMatchObject({ code: 'DECRYPT_FAILED' } satisfies Partial<MigrationError>);
});

it('derives public-only batch records with progress every 25 wallets', async () => {
  const mnemonic = newMnemonic();
  const indices = Array.from({ length: 52 }, (_, index) => index);
  const progress: Array<[number, number]> = [];
  const wallets = await deriveWalletPublicBatch(
    'EVM',
    mnemonic,
    indices,
    (completed, total) => progress.push([completed, total]),
  );
  expect(wallets).toHaveLength(indices.length);
  expect(progress).toEqual([[25, 52], [50, 52], [52, 52]]);
  expect(wallets[0]).not.toHaveProperty('privateKey');
  expect(wallets[0]).not.toHaveProperty('mnemonic');
});

it('distinguishes an invalid decrypted mnemonic from a decryption failure', async () => {
  const { key, wallets } = await encryptedBatch('SOL', 1);
  const invalid = {
    ...wallets[0]!,
    encryptedMnemonic: await encryptValue(key, 'not a valid BIP39 mnemonic'),
  };
  await expect(recoverMigrationSecretBytes(key, invalid, 'mnemonic', [invalid])).rejects.toMatchObject({
    code: 'SECRET_INVALID',
  } satisfies Partial<MigrationError>);
});

it('maps an unexpected verification failure to INTERNAL_ERROR', async () => {
  const { key, wallets } = await encryptedBatch('SOL', 1);
  await expect(recoverMigrationSecretBytes(
    key,
    wallets[0]!,
    'mnemonic',
    wallets,
    () => { throw new Error('synthetic progress transport failure'); },
  )).rejects.toMatchObject({ code: 'INTERNAL_ERROR' } satisfies Partial<MigrationError>);
});
