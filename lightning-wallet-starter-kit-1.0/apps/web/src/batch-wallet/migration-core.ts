import { decryptBytes } from './crypto';
import { deriveWalletPublicBatch, isValidMnemonic, type PublicDerivedWallet } from './engine';
import type { LocalWalletRecord } from './types';
import { verifyWalletControlBytes } from './verification';

export type MigrationSecretKind = 'mnemonic' | 'privateKey';
export type MigrationErrorCode = 'DECRYPT_FAILED' | 'SECRET_INVALID' | 'ADDRESS_MISMATCH' | 'INTERNAL_ERROR';
export type MigrationProgressCallback = (completed: number, total: number) => void;

export class MigrationError extends Error {
  constructor(public readonly code: MigrationErrorCode) {
    super(code);
    this.name = 'MigrationError';
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true });

function matchesDerivedWallet(wallet: LocalWalletRecord, derived: PublicDerivedWallet) {
  return derived.address === wallet.address
    && derived.publicKey === wallet.publicKey
    && derived.path === wallet.path
    && derived.index === wallet.index;
}

/**
 * Decrypt exactly one user-requested secret and prove that it controls the
 * selected address before releasing it to the one-shot migration worker.
 * The caller owns the returned buffer and must zero or transfer it.
 */
export async function recoverMigrationSecretBytes(
  key: CryptoKey,
  wallet: LocalWalletRecord,
  kind: MigrationSecretKind,
  batchWallets: LocalWalletRecord[] = [wallet],
  onProgress?: MigrationProgressCallback,
) {
  let plaintext = new Uint8Array();
  let releasePlaintext = false;
  try {
    try {
      plaintext = await decryptBytes(
        key,
        kind === 'mnemonic' ? wallet.encryptedMnemonic : wallet.encryptedPrivateKey,
      );
    } catch {
      throw new MigrationError('DECRYPT_FAILED');
    }

    try {
      if (kind === 'privateKey') {
        const verification = await verifyWalletControlBytes(wallet.chain, wallet, plaintext.slice());
        if (!verification.pass || !verification.addressMatched || !verification.signatureValid) {
          throw new MigrationError('ADDRESS_MISMATCH');
        }
      } else {
        if (!batchWallets.length || batchWallets.some(item => item.chain !== wallet.chain)) {
          throw new MigrationError('SECRET_INVALID');
        }
        let mnemonic = '';
        try {
          try {
            mnemonic = decoder.decode(plaintext);
          } catch {
            throw new MigrationError('SECRET_INVALID');
          }
          if (!isValidMnemonic(mnemonic)) throw new MigrationError('SECRET_INVALID');
          const derivedWallets = await deriveWalletPublicBatch(
            wallet.chain,
            mnemonic,
            batchWallets.map(item => item.index),
            onProgress,
          );
          for (let offset = 0; offset < batchWallets.length; offset++) {
            if (!matchesDerivedWallet(batchWallets[offset]!, derivedWallets[offset]!)) {
              throw new MigrationError('ADDRESS_MISMATCH');
            }
          }
        } finally {
          mnemonic = '';
        }
      }
    } catch (cause) {
      if (cause instanceof MigrationError) throw cause;
      throw new MigrationError('INTERNAL_ERROR');
    }

    releasePlaintext = true;
    return {
      walletId: wallet.id,
      address: wallet.address,
      path: wallet.path,
      kind,
      verifiedCount: kind === 'mnemonic' ? batchWallets.length : 1,
      secretBytes: plaintext,
    };
  } finally {
    if (!releasePlaintext) plaintext.fill(0);
  }
}
