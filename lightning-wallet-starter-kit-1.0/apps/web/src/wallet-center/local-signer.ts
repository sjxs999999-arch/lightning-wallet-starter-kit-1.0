import type { LocalSignedPayload, LocalSigningPayload, LocalSigningWallet } from './local-transfer-types';

type WorkerResponse = { ok: true; result: LocalSignedPayload } | { ok: false; code: string };
const messages: Record<string, string> = {
  DECRYPT_FAILED: '本地密钥解密失败；保险库可能已锁定或损坏',
  KEY_MISMATCH: '解密密钥与所选钱包地址不匹配，已停止签名',
  PAYLOAD_INVALID: '待签名交易与所选钱包不匹配，已停止签名',
  SIGNING_FAILED: '本地签名失败；交易没有广播',
};

export function signWithLocalWorker(key: CryptoKey, wallet: LocalSigningWallet, payload: LocalSigningPayload) {
  return new Promise<LocalSignedPayload>((resolve, reject) => {
    const worker = new Worker(new URL('./local-signer.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const timeout = window.setTimeout(() => finish(new Error('本地签名线程超时；交易没有广播')), 30_000);
    const cleanup = () => { window.clearTimeout(timeout);worker.terminate(); };
    const finish = (error?: Error, value?: LocalSignedPayload) => {
      if (settled) return;
      settled = true;cleanup();
      if (error) reject(error); else resolve(value!);
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.ok) finish(undefined, event.data.result);
      else finish(new Error(messages[event.data.code] ?? messages.SIGNING_FAILED));
    };
    worker.onerror = () => finish(new Error('本地签名线程异常；交易没有广播'));
    try { worker.postMessage({ key, wallet, payload }); }
    catch { finish(new Error('浏览器无法启动隔离签名线程；交易没有广播')); }
  });
}

