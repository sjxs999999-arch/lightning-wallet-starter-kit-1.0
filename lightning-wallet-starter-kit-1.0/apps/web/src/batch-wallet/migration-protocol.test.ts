import { afterEach, describe, expect, it, vi } from 'vitest';
import { MigrationWorkerError, recoverMigrationSecretInWorker } from './migration';
import type { LocalWalletRecord } from './types';

type WorkerResponse =
  | { type: 'progress'; completed: number; total: number }
  | { ok: false; code: 'INTERNAL_ERROR' }
  | {
    ok: true;
    walletId: string;
    address: string;
    path: string;
    kind: 'mnemonic' | 'privateKey';
    verifiedCount: number;
    secret: ArrayBuffer;
  };

class ControlledWorker {
  static latest: ControlledWorker | undefined;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor() {
    ControlledWorker.latest = this;
  }

  postMessage() {}

  terminate() {
    this.terminated = true;
  }

  emit(data: WorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
  }
}

const encrypted = { ciphertext: 'AA==', iv: 'AA==', version: 1 as const };
const wallet: LocalWalletRecord = {
  id: 'SOL-0',
  name: 'Synthetic wallet',
  chain: 'SOL',
  address: 'synthetic-address',
  publicKey: 'synthetic-address',
  path: "m/44'/501'/0'/0'",
  index: 0,
  encryptedPrivateKey: encrypted,
  encryptedMnemonic: encrypted,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function success(secret: ArrayBuffer): WorkerResponse {
  return {
    ok: true,
    walletId: wallet.id,
    address: wallet.address,
    path: wallet.path,
    kind: 'mnemonic',
    verifiedCount: 1,
    secret,
  };
}

describe('migration worker protocol', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    ControlledWorker.latest = undefined;
  });

  it('forwards validated progress and resolves the transferred secret once', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const progress: Array<[number, number]> = [];
    const pending = recoverMigrationSecretInWorker(
      {} as CryptoKey,
      wallet,
      [wallet],
      'mnemonic',
      undefined,
      (completed, total) => progress.push([completed, total]),
    );
    const worker = ControlledWorker.latest!;
    worker.emit({ type: 'progress', completed: 25, total: 50 });
    worker.emit({ type: 'progress', completed: 51, total: 50 });
    const secret = new Uint8Array([1, 2, 3]);
    worker.emit(success(secret.buffer));

    const recovered = await pending;
    expect(progress).toEqual([[25, 50]]);
    expect([...recovered.secretBytes]).toEqual([1, 2, 3]);
    expect(worker.terminated).toBe(true);
    recovered.secretBytes.fill(0);
  });

  it('wipes a late success buffer after cancellation has settled the request', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const controller = new AbortController();
    const pending = recoverMigrationSecretInWorker(
      {} as CryptoKey,
      wallet,
      [wallet],
      'mnemonic',
      controller.signal,
    );
    const worker = ControlledWorker.latest!;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    const lateSecret = new Uint8Array([91, 92, 93, 94]);
    worker.emit(success(lateSecret.buffer));
    expect([...lateSecret]).toEqual([0, 0, 0, 0]);
    expect(worker.terminated).toBe(true);
  });

  it('preserves INTERNAL_ERROR instead of reporting a decryption failure', async () => {
    vi.stubGlobal('Worker', ControlledWorker);
    const pending = recoverMigrationSecretInWorker(
      {} as CryptoKey,
      wallet,
      [wallet],
      'mnemonic',
    );
    ControlledWorker.latest!.emit({ ok: false, code: 'INTERNAL_ERROR' });
    await expect(pending).rejects.toEqual(new MigrationWorkerError('INTERNAL_ERROR'));
  });
});
