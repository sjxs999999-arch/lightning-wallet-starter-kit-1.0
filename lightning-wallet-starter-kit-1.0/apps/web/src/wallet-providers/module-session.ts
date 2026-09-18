import { getAddress, isAddress } from 'ethers';
import type { ConnectedWallet, RequestProvider, WalletFamily } from './types';

export type SolanaSessionProvider = {
  publicKey?: { toString(): string };
  connect?(): Promise<{ publicKey?: { toString(): string } }>;
  signAndSendTransaction(transaction: unknown): Promise<{ signature: string }>;
  signAllTransactions?(transactions: unknown[]): Promise<{ serialize(): Uint8Array }[]>;
};

export type TronSessionProvider = {
  defaultAddress?: { base58?: string };
  fullNode?: { host?: string };
  [key: string]: unknown;
};

export function shortWalletAddress(address: string) {
  return address.length > 18 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

export function sameWalletAddress(family: WalletFamily, left: string, right: string) {
  if (family === 'EVM') {
    return isAddress(left) && isAddress(right) && getAddress(left) === getAddress(right);
  }
  return left === right;
}

export function connectedWalletAddress(wallet: ConnectedWallet | null, family: WalletFamily) {
  return wallet?.family === family ? wallet.address : '';
}

export function requireConnectedWallet(wallet: ConnectedWallet | null, family: WalletFamily, expectedAddress?: string) {
  if (!wallet) throw new Error(`请先在钱包中心连接 ${family} 钱包`);
  if (wallet.family !== family) throw new Error(`当前连接的是 ${wallet.family} 钱包，请先切换到 ${family} 钱包`);
  if (expectedAddress && !sameWalletAddress(family, wallet.address, expectedAddress)) throw new Error('当前共享钱包账户与业务参数地址不一致，已停止请求签名');
  return wallet;
}

export function connectedEvmProvider(wallet: ConnectedWallet | null, expectedAddress?: string) {
  return requireConnectedWallet(wallet, 'EVM', expectedAddress).provider as RequestProvider;
}

export function connectedSolanaProvider(wallet: ConnectedWallet | null, expectedAddress?: string) {
  return requireConnectedWallet(wallet, 'SOL', expectedAddress).provider as SolanaSessionProvider;
}

export function matchingConnectedSolanaProvider(wallet: ConnectedWallet | null, expectedAddress: string) {
  if (wallet?.family !== 'SOL' || !sameWalletAddress('SOL', wallet.address, expectedAddress)) return undefined;
  return wallet.provider as SolanaSessionProvider;
}

export function connectedTronProvider(wallet: ConnectedWallet | null, expectedAddress?: string) {
  return requireConnectedWallet(wallet, 'TRON', expectedAddress).provider as TronSessionProvider;
}

export function evmChainIdNumber(wallet: ConnectedWallet | null) {
  if (wallet?.family !== 'EVM' || !/^0x[0-9a-f]+$/i.test(wallet.chainId)) return undefined;
  const value = Number.parseInt(wallet.chainId, 16);
  return Number.isSafeInteger(value) ? value : undefined;
}
