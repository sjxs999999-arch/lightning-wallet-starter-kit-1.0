import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createVault,
  loadVault,
  saveVault,
  unlockVault,
  type VaultEnvelope,
} from './vault';

const AUTO_LOCK_MS = 15 * 60_000;

type LocalWalletSessionValue = {
  vault: VaultEnvelope | null;
  vaultKey: CryptoKey | null;
  initialError: string;
  create(password: string): Promise<VaultEnvelope>;
  unlock(password: string): Promise<void>;
  commit(next: VaultEnvelope): void;
  replace(next: VaultEnvelope): void;
  lock(): void;
  isKeyActive(key: CryptoKey): boolean;
};

const LocalWalletSessionContext = createContext<LocalWalletSessionValue | null>(null);

function readInitialVault() {
  try { return { vault: loadVault(), error: '' }; }
  catch (cause) { return { vault: null, error: cause instanceof Error ? cause.message : '本地保险库无法读取' }; }
}

export function LocalWalletSessionProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readInitialVault);
  const [vault, setVault] = useState<VaultEnvelope | null>(initial.vault);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const vaultKeyRef = useRef<CryptoKey | null>(null);

  const lock = useCallback(() => {
    vaultKeyRef.current = null;
    setVaultKey(null);
  }, []);
  const isKeyActive = useCallback((key: CryptoKey) => vaultKeyRef.current === key, []);

  useEffect(() => {
    if (!vaultKey) return;
    let timer = window.setTimeout(lock, AUTO_LOCK_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, AUTO_LOCK_MS);
    };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('pagehide', lock);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('pagehide', lock);
    };
  }, [lock, vaultKey]);

  const value = useMemo<LocalWalletSessionValue>(() => ({
    vault,
    vaultKey,
    initialError: initial.error,
    async create(password) {
      const created = await createVault(password);
      saveVault(created.vault);
      setVault(created.vault);
      vaultKeyRef.current = created.key;
      setVaultKey(created.key);
      return created.vault;
    },
    async unlock(password) {
      if (!vault) throw new Error('本地保险库不存在');
      const key = await unlockVault(vault, password);
      vaultKeyRef.current = key;
      setVaultKey(key);
    },
    commit(next) {
      saveVault(next);
      setVault(next);
    },
    replace(next) {
      saveVault(next);
      setVault(next);
      lock();
    },
    lock,
    isKeyActive,
  }), [initial.error, isKeyActive, lock, vault, vaultKey]);

  return <LocalWalletSessionContext.Provider value={value}>{children}</LocalWalletSessionContext.Provider>;
}

export function useLocalWalletSession() {
  const value = useContext(LocalWalletSessionContext);
  if (!value) throw new Error('LocalWalletSessionProvider is missing');
  return value;
}
