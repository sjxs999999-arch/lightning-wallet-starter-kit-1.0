import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { deriveExportKey } from './crypto';
import {
  MigrationWorkerError,
  recoverMigrationSecretInWorker,
} from './migration';
import type { MigrationSecretKind } from './migration-core';
import type { LocalWalletRecord } from './types';

type RevealMeta = {
  kind: MigrationSecretKind;
  walletId: string;
  walletName: string;
  address: string;
  path: string;
  chain: LocalWalletRecord['chain'];
  verifiedCount: number;
};

type MigrationProgress = { completed: number; total: number } | null;

const decoder = new TextDecoder('utf-8', { fatal: true });
const REVEAL_MILLISECONDS = 60_000;

function errorMessage(cause: unknown) {
  if (cause instanceof MigrationWorkerError) {
    if (cause.code === 'ADDRESS_MISMATCH') return '密钥与所选地址不匹配，已阻止显示';
    if (cause.code === 'SECRET_INVALID') return '助记词格式无效或派生数据已损坏';
    if (cause.code === 'DECRYPT_FAILED') return '密码错误或加密 JSON 已损坏';
  }
  return '本地迁移线程异常，未显示任何密钥';
}

function walletFingerprint(wallet?: LocalWalletRecord) {
  if (!wallet) return '';
  return [
    wallet.id,
    wallet.chain,
    wallet.address,
    wallet.publicKey,
    wallet.path,
    wallet.index,
    wallet.encryptedPrivateKey.iv,
    wallet.encryptedPrivateKey.ciphertext,
    wallet.encryptedMnemonic.iv,
    wallet.encryptedMnemonic.ciphertext,
  ].join('\u0000');
}

function privateKeyFormat(chain?: LocalWalletRecord['chain']) {
  if (chain === 'SOL') return 'Solana Base58 私钥（解码后 64 字节）';
  if (chain === 'TRON') return 'TRON 0x 开头的 32 字节十六进制私钥';
  return 'EVM 0x 开头的 32 字节十六进制私钥';
}

export function MigrationPanel({
  wallet,
  wallets,
  batchSalt,
  batchRevision,
  disabled = false,
  onSensitiveStateChange,
}: {
  wallet?: LocalWalletRecord;
  wallets: LocalWalletRecord[];
  batchSalt: string;
  batchRevision: number;
  disabled?: boolean;
  onSensitiveStateChange?: (active: boolean) => void;
}) {
  const secretRef = useRef<HTMLTextAreaElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestEpochRef = useRef(0);
  const mountedRef = useRef(false);
  const sensitiveCallbackRef = useRef(onSensitiveStateChange);
  const latestRef = useRef({
    wallet,
    wallets,
    batchSalt,
    batchRevision,
    disabled,
    walletFingerprint: walletFingerprint(wallet),
  });
  const [busy, setBusy] = useState<MigrationSecretKind | null>(null);
  const [progress, setProgress] = useState<MigrationProgress>(null);
  const [revealed, setRevealed] = useState<RevealMeta | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState('');
  const currentWalletFingerprint = walletFingerprint(wallet);

  useLayoutEffect(() => {
    sensitiveCallbackRef.current = onSensitiveStateChange;
    latestRef.current = {
      wallet,
      wallets,
      batchSalt,
      batchRevision,
      disabled,
      walletFingerprint: currentWalletFingerprint,
    };
  }, [wallet, wallets, batchSalt, batchRevision, disabled, currentWalletFingerprint, onSensitiveStateChange]);

  const clearImperative = useCallback(() => {
    requestEpochRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (secretRef.current) secretRef.current.value = '';
    if (passwordRef.current) passwordRef.current.value = '';
    sensitiveCallbackRef.current?.(false);
  }, []);

  const resetSensitiveState = useCallback(() => {
    clearImperative();
    if (!mountedRef.current) return;
    setBusy(null);
    setProgress(null);
    setRevealed(null);
    setExpiresAt(null);
    setRemaining(0);
  }, [clearImperative]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearImperative();
    };
  }, [clearImperative]);

  // Layout cleanup runs while the DOM refs are still attached. Any batch,
  // selection or operation change therefore clears a visible secret before paint.
  useLayoutEffect(() => {
    clearImperative();
    setBusy(null);
    setProgress(null);
    setRevealed(null);
    setExpiresAt(null);
    setRemaining(0);
    setError('');
    return clearImperative;
  }, [batchRevision, batchSalt, currentWalletFingerprint, wallets, disabled, clearImperative]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') resetSensitiveState();
    };
    const onPageHide = () => resetSensitiveState();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [resetSensitiveState]);

  useEffect(() => {
    if (expiresAt === null) return;
    const update = () => {
      if (!mountedRef.current) return;
      const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) resetSensitiveState();
    };
    update();
    const interval = window.setInterval(update, 250);
    const timeout = window.setTimeout(resetSensitiveState, Math.max(0, expiresAt - Date.now()) + 25);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [expiresAt, resetSensitiveState]);

  const requestIsCurrent = useCallback((
    requestEpoch: number,
    requestedWallets: LocalWalletRecord[],
    requestedRevision: number,
    requestedFingerprint: string,
  ) => {
    const latest = latestRef.current;
    return requestEpochRef.current === requestEpoch
      && latest.wallets === requestedWallets
      && latest.batchRevision === requestedRevision
      && latest.walletFingerprint === requestedFingerprint
      && !latest.disabled;
  }, []);

  async function reveal(kind: MigrationSecretKind) {
    if (!wallet || !batchSalt || disabled) return;
    const label = kind === 'mnemonic' ? '整批助记词' : `${wallet.name} 的私钥`;
    if (!window.confirm(`即将在本机临时显示${label}。任何看到它的人都能控制资产；确认继续吗？`)) return;
    let password = passwordRef.current?.value ?? '';
    if (!password) {
      setError('请先输入这份加密 JSON 的密码');
      passwordRef.current?.focus();
      return;
    }

    clearImperative();
    setError('');
    setRevealed(null);
    setExpiresAt(null);
    setRemaining(0);
    setProgress(kind === 'mnemonic' ? { completed: 0, total: wallets.length } : null);
    setBusy(kind);
    sensitiveCallbackRef.current?.(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    const requestedWallets = wallets;
    const requestedRevision = batchRevision;
    const requestedFingerprint = currentWalletFingerprint;
    const requestedWallet = wallet;
    let secretBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let secretText = '';
    try {
      const key = await deriveExportKey(password, batchSalt);
      password = '';
      if (passwordRef.current) passwordRef.current.value = '';
      if (!requestIsCurrent(requestEpoch, requestedWallets, requestedRevision, requestedFingerprint)) {
        throw new DOMException('本地迁移已取消', 'AbortError');
      }
      const recovered = await recoverMigrationSecretInWorker(
        key,
        requestedWallet,
        requestedWallets,
        kind,
        controller.signal,
        (completed, total) => {
          if (requestIsCurrent(requestEpoch, requestedWallets, requestedRevision, requestedFingerprint)) {
            setProgress({ completed, total });
          }
        },
      );
      secretBytes = recovered.secretBytes;
      if (
        !requestIsCurrent(requestEpoch, requestedWallets, requestedRevision, requestedFingerprint)
        || recovered.walletId !== requestedWallet.id
        || recovered.address !== requestedWallet.address
        || recovered.path !== requestedWallet.path
        || recovered.kind !== kind
      ) {
        throw new DOMException('本地迁移已取消', 'AbortError');
      }
      secretText = decoder.decode(secretBytes);
      if (!secretRef.current) throw new Error('密钥显示区域不可用');
      secretRef.current.value = secretText;
      setRevealed({
        kind: recovered.kind,
        walletId: recovered.walletId,
        walletName: requestedWallet.name,
        address: recovered.address,
        path: recovered.path,
        chain: requestedWallet.chain,
        verifiedCount: recovered.verifiedCount,
      });
      setExpiresAt(Date.now() + REVEAL_MILLISECONDS);
      setRemaining(Math.ceil(REVEAL_MILLISECONDS / 1000));
      setProgress(null);
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      if (requestEpochRef.current === requestEpoch) {
        resetSensitiveState();
        if (!aborted) setError(errorMessage(cause));
      }
    } finally {
      password = '';
      secretText = '';
      secretBytes.fill(0);
      if (abortRef.current === controller) abortRef.current = null;
      if (requestEpochRef.current === requestEpoch) setBusy(null);
    }
  }

  const busyLabel = busy === 'mnemonic' && progress
    ? `正在核验 ${progress.completed}/${progress.total}…`
    : '正在本地核验…';
  const migrationGuidance = revealed?.kind === 'mnemonic'
    ? `目标钱包导入助记词后，需按派生路径 ${revealed.path} 恢复账户；多账户可能要按索引逐个创建。`
    : `${privateKeyFormat(revealed?.chain)}；消费级钱包通常需要逐个导入。`;

  const liveStatus = busy
    ? (progress ? `本地正在核验 ${progress.completed}/${progress.total}` : '本地正在核验所选钱包')
    : revealed
      ? `核验完成，恢复密钥已临时显示，${REVEAL_MILLISECONDS / 1000} 秒内自动清除`
      : '';

  return <section className="wallet-recovery" aria-busy={Boolean(busy)}>
    <div className="wallet-recovery-head">
      <div><b>迁移到其他钱包</b><small>私钥会签名并核对地址；助记词会重新派生并核对整批地址</small></div>
      <ShieldCheck size={18}/>
    </div>
    <div className="wallet-recovery-actions">
      <label>加密 JSON 密码<input ref={passwordRef} type="password" autoComplete="off" minLength={12} disabled={!wallet || disabled || Boolean(busy)} placeholder="仅在本机用于本次解密" data-1p-ignore="true" data-lpignore="true" data-bwignore="true"/></label>
      <button
        type="button"
        onClick={() => void reveal('mnemonic')}
        disabled={!wallet || disabled || Boolean(busy)}
      ><KeyRound size={15}/>{busy === 'mnemonic' ? busyLabel : '显示整批助记词'}</button>
      <button
        type="button"
        onClick={() => void reveal('privateKey')}
        disabled={!wallet || disabled || Boolean(busy)}
      ><Eye size={15}/>{busy === 'privateKey' ? busyLabel : '显示所选钱包私钥'}</button>
      {busy && <button type="button" className="wallet-recovery-hide" onClick={resetSensitiveState}><X size={15}/>取消核验</button>}
      {revealed && <button type="button" className="wallet-recovery-hide" onClick={resetSensitiveState}><EyeOff size={15}/>立即隐藏</button>}
    </div>
    <div className="wallet-recovery-live" role="status" aria-live="polite" aria-atomic="true">{liveStatus}</div>
    <div className="wallet-recovery-warning"><TriangleAlert size={16}/>不提供批量明文导出；切换钱包、导入新批次、切换页面或真实 60 秒结束都会清除。浏览器只能尽力缩短明文在内存中的停留时间。</div>
    {error && <div className="batch-error" role="alert">{error}</div>}
    <div className={`wallet-recovery-secret ${revealed ? 'is-visible' : ''}`} aria-hidden={!revealed}>
      <div>
        <b>{revealed?.kind === 'mnemonic' ? '整批共用助记词' : `${revealed?.walletName ?? ''} · ${revealed?.chain ?? ''} 私钥`}</b>
        <span>已核对 {revealed?.verifiedCount ?? 0} 个地址 · {remaining} 秒后清除</span>
      </div>
      <textarea
        ref={secretRef}
        readOnly
        rows={revealed?.kind === 'mnemonic' ? 3 : 4}
        aria-label="临时恢复密钥"
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        tabIndex={revealed ? 0 : -1}
        onFocus={event => event.currentTarget.select()}
      />
      <code>{revealed?.address}</code>
      <small>{migrationGuidance} 只粘贴到目标钱包官方 App 的导入页面。</small>
    </div>
  </section>;
}
