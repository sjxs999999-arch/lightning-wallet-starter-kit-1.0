import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { disconnectWallet, subscribeWalletSession } from './providers';
import type { ConnectedWallet } from './types';

type ExternalWalletSessionValue = {
  connected: ConnectedWallet | null;
  notice: string;
  activate(wallet: ConnectedWallet): void;
  disconnect(): Promise<void>;
  clearNotice(): void;
};

const ExternalWalletSessionContext = createContext<ExternalWalletSessionValue | null>(null);

export function ExternalWalletSessionProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState<ConnectedWallet | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!connected) return;
    return subscribeWalletSession(connected, reason => {
      setConnected(null);
      setNotice(reason);
    }, updated => setConnected(current => current && current.provider === updated.provider && current.address === updated.address ? updated : current));
  }, [connected]);

  const activate = useCallback((wallet: ConnectedWallet) => {
    setNotice('');
    setConnected(wallet);
  }, []);

  const disconnect = useCallback(async () => {
    const wallet = connected;
    setConnected(null);
    if (wallet) await disconnectWallet(wallet);
  }, [connected]);

  const clearNotice = useCallback(() => setNotice(''), []);
  const value = useMemo(() => ({ connected, notice, activate, disconnect, clearNotice }), [activate, clearNotice, connected, disconnect, notice]);

  return <ExternalWalletSessionContext.Provider value={value}>{children}</ExternalWalletSessionContext.Provider>;
}

export function useExternalWalletSession() {
  const value = useContext(ExternalWalletSessionContext);
  if (!value) throw new Error('ExternalWalletSessionProvider is missing');
  return value;
}
