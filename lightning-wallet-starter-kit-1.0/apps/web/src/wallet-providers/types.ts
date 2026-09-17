export type WalletFamily = 'EVM' | 'SOL' | 'TRON';
export type WalletName = 'MetaMask' | 'WalletConnect' | 'OKX Wallet' | 'Rabby' | 'Phantom' | 'Backpack' | 'Solflare' | 'TronLink';
export type WalletNetworkMode = 'testnet' | 'mainnet';

export type ConnectedWallet = {
  name: WalletName;
  family: WalletFamily;
  address: string;
  network: string;
  mode: WalletNetworkMode;
  chainId: string;
  readOnly: boolean;
  provider: unknown;
  eventProvider?: unknown;
};

export type ProviderHistory = {
  id: string;
  wallet: WalletName;
  family: WalletFamily;
  network: string;
  mode: WalletNetworkMode;
  address: string;
  operation: 'connect' | 'sign' | 'broadcast';
  hash?: string;
  status: 'connected' | 'signed' | 'broadcast' | 'confirmed' | 'rejected' | 'failed';
  at: string;
  error?: string;
};

// Kept as an alias so existing imports and locally stored v1 records continue to work.
export type TestnetHistory = ProviderHistory;

export type RequestProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  disconnect?(): Promise<void>;
};
