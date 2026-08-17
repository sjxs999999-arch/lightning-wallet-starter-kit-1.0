/// <reference lib="webworker" />
import {
  MigrationError,
  recoverMigrationSecretBytes,
  type MigrationErrorCode,
  type MigrationSecretKind,
} from './migration-core';
import type { LocalWalletRecord } from './types';

type Request = {
  key: CryptoKey;
  wallet: LocalWalletRecord;
  wallets: LocalWalletRecord[];
  kind: MigrationSecretKind;
};

self.onmessage = async (event: MessageEvent<Request>) => {
  let secretBytes: Uint8Array | undefined;
  try {
    const recovered = await recoverMigrationSecretBytes(
      event.data.key,
      event.data.wallet,
      event.data.kind,
      event.data.wallets,
      (completed, total) => self.postMessage({ type: 'progress', completed, total }),
    );
    secretBytes = recovered.secretBytes;
    const secret = secretBytes.buffer as ArrayBuffer;
    self.postMessage({
      ok: true,
      walletId: recovered.walletId,
      address: recovered.address,
      path: recovered.path,
      kind: recovered.kind,
      verifiedCount: recovered.verifiedCount,
      secret,
    }, [secret]);
  } catch (cause) {
    const code: MigrationErrorCode = cause instanceof MigrationError ? cause.code : 'INTERNAL_ERROR';
    self.postMessage({ ok: false, code });
  } finally {
    if (secretBytes?.byteLength) secretBytes.fill(0);
    self.close();
  }
};

export {};
