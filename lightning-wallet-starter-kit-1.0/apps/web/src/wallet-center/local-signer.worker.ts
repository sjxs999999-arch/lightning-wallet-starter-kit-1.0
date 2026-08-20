/// <reference lib="webworker" />
import { signLocalPayload, type LocalSigningErrorCode } from './local-signer-core';
import type { LocalSigningPayload, LocalSigningWallet } from './local-transfer-types';

type SignRequest = { key: CryptoKey; wallet: LocalSigningWallet; payload: LocalSigningPayload };

self.onmessage = async (event: MessageEvent<SignRequest>) => {
  try {
    const { key, wallet, payload } = event.data;
    const result = await signLocalPayload(key, wallet, payload);
    if (result.chain === 'SOL') {
      const signed = result.signedTransaction;
      self.postMessage({ ok: true, result }, [signed]);
      return;
    }
    self.postMessage({ ok: true, result });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    const code: LocalSigningErrorCode = message === 'DECRYPT_FAILED' || message === 'KEY_MISMATCH' || message === 'PAYLOAD_INVALID'
      ? message
      : 'SIGNING_FAILED';
    self.postMessage({ ok: false, code });
  } finally {
    self.close();
  }
};

export {};
