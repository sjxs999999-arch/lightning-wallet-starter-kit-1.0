import type { MigrationErrorCode, MigrationSecretKind } from './migration-core';
import type { LocalWalletRecord } from './types';

type Success = {
  ok: true;
  walletId: string;
  address: string;
  path: string;
  kind: MigrationSecretKind;
  verifiedCount: number;
  secret: ArrayBuffer;
};
type Failure = { ok: false; code: MigrationErrorCode };
type Progress = { type: 'progress'; completed: number; total: number };

export class MigrationWorkerError extends Error {
  constructor(public readonly code: MigrationErrorCode | 'WORKER_FAILED') {
    super(code);
    this.name = 'MigrationWorkerError';
  }
}

function abortError() {
  const error = new Error('本地迁移已取消');
  error.name = 'AbortError';
  return error;
}

export function recoverMigrationSecretInWorker(
  key: CryptoKey,
  wallet: LocalWalletRecord,
  wallets: LocalWalletRecord[],
  kind: MigrationSecretKind,
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number) => void,
) {
  return new Promise<Omit<Success, 'ok' | 'secret'> & { secretBytes: Uint8Array }>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const worker = new Worker(new URL('./migration.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    const fail = (cause: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cause);
    };
    const onAbort = () => fail(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onerror = () => fail(new MigrationWorkerError('WORKER_FAILED'));
    worker.onmessage = (event: MessageEvent<Success | Failure | Progress>) => {
      const response = event.data;
      if ('type' in response) {
        if (
          !settled
          && response.type === 'progress'
          && Number.isInteger(response.completed)
          && Number.isInteger(response.total)
          && response.completed >= 0
          && response.completed <= response.total
        ) {
          try {
            onProgress?.(response.completed, response.total);
          } catch {
            // Progress rendering is advisory and must not interrupt recovery.
          }
        }
        return;
      }
      if (settled) {
        if (response.ok) new Uint8Array(response.secret).fill(0);
        return;
      }
      if (!response.ok) {
        fail(new MigrationWorkerError(response.code));
        return;
      }
      settled = true;
      cleanup();
      resolve({
        walletId: response.walletId,
        address: response.address,
        path: response.path,
        kind: response.kind,
        verifiedCount: response.verifiedCount,
        secretBytes: new Uint8Array(response.secret),
      });
    };
    try {
      worker.postMessage({ key, wallet, wallets, kind });
    } catch (cause) {
      fail(cause instanceof Error ? cause : new MigrationWorkerError('WORKER_FAILED'));
    }
  });
}
