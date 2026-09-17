import { BrowserProvider, formatUnits, getAddress, isAddress } from 'ethers';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { validateAddress } from '../batch-transfer/validation';
import type { ConnectedWallet, RequestProvider, WalletName, WalletNetworkMode } from './types';

type Eip6963 = { info: { name: string; rdns: string }; provider: RequestProvider };
type EventProvider = {
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  disconnect?(): Promise<void>;
};
type SolProvider = EventProvider & {
  isConnected?: boolean;
  publicKey?: { toString(): string };
  connect?(): Promise<{ publicKey?: { toString(): string } }>;
  signMessage?(message: Uint8Array): Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction(transaction: Transaction): Promise<{ signature: string }>;
};
type TronReceipt = { id?: string; receipt?: { result?: string } };
type TronWeb = {
  defaultAddress?: { base58?: string };
  fullNode?: { host?: string };
  transactionBuilder: { sendTrx(to: string, amount: number, from: string): Promise<Record<string, unknown> & { txID?: string }> };
  trx: {
    signMessageV2(message: string): Promise<string>;
    sign(transaction: unknown): Promise<Record<string, unknown> & { txID?: string }>;
    sendRawTransaction(transaction: unknown): Promise<{ result?: boolean; txid?: string; message?: string }>;
    getTransactionInfo(txId: string): Promise<TronReceipt>;
    getBalance?(address: string): Promise<number>;
  };
};
type TronProvider = EventProvider & { request(args: { method: string; params?: unknown[] }): Promise<unknown>; tronWeb?: TronWeb };
type WalletWindow = Window & {
  ethereum?: RequestProvider;
  okxwallet?: RequestProvider & { solana?: SolProvider; tronLink?: TronProvider };
  rabby?: RequestProvider;
  phantom?: { solana?: SolProvider };
  backpack?: SolProvider;
  xnft?: { solana?: SolProvider };
  solflare?: SolProvider;
  solana?: SolProvider & { isPhantom?: boolean };
  tron?: TronProvider;
  tronLink?: TronProvider;
  tronWeb?: TronWeb;
};

const SOLANA_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const SOLANA_MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const EVM_NETWORKS = {
  testnet: { chainId: '0xaa36a7', decimalChainId: 11155111, name: 'Sepolia', rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com' },
  mainnet: { chainId: '0x1', decimalChainId: 1, name: 'Ethereum Mainnet', rpcUrl: import.meta.env.VITE_EVM_RPC_URL || 'https://ethereum-rpc.publicnode.com' },
} as const;
const SOLANA_NETWORKS = {
  testnet: { chainId: SOLANA_DEVNET_GENESIS, name: 'Solana Devnet', rpcUrl: import.meta.env.VITE_LAUNCHPAD_SOLANA_RPC_URL || 'https://api.devnet.solana.com' },
  mainnet: { chainId: SOLANA_MAINNET_GENESIS, name: 'Solana Mainnet', rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com' },
} as const;
const TRON_NETWORKS: Record<string, { chainId: string; name: string; mode: WalletNetworkMode }> = {
  'api.trongrid.io': { chainId: '0x2b6653dc', name: 'TRON Mainnet', mode: 'mainnet' },
  'nile.trongrid.io': { chainId: '0xcd8690dc', name: 'TRON Nile', mode: 'testnet' },
  'api.nileex.io': { chainId: '0xcd8690dc', name: 'TRON Nile', mode: 'testnet' },
  'api.shasta.trongrid.io': { chainId: '0x94a9059e', name: 'TRON Shasta', mode: 'testnet' },
};

const win = () => window as WalletWindow;
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const solanaConnection = (mode: WalletNetworkMode) => new Connection(SOLANA_NETWORKS[mode].rpcUrl, 'confirmed');
const isMainnetWallet = (wallet: ConnectedWallet) => wallet.mode === 'mainnet' || wallet.readOnly || wallet.network.toLowerCase().includes('mainnet');

export async function discoverEvmProviders(waitMs = 120) {
  const found: Eip6963[] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963>).detail;
    if (detail?.provider && !found.some(item => item.info.rdns === detail.info.rdns)) found.push(detail);
  };
  window.addEventListener('eip6963:announceProvider', listener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await sleep(waitMs);
  window.removeEventListener('eip6963:announceProvider', listener);
  const root = win();
  for (const [provider, name, rdns] of [
    [root.ethereum, 'Injected EVM', 'injected'],
    [root.okxwallet, 'OKX Wallet', 'com.okex.wallet'],
    [root.rabby, 'Rabby', 'io.rabby'],
  ] as const) {
    if (provider && !found.some(value => value.provider === provider)) found.push({ info: { name, rdns }, provider });
  }
  return found;
}

function matchEvm(name: WalletName, item: Eip6963) {
  const text = `${item.info.name} ${item.info.rdns}`.toLowerCase();
  return name === 'MetaMask' ? text.includes('metamask')
    : name === 'OKX Wallet' ? text.includes('okx') || text.includes('okex')
      : name === 'Rabby' ? text.includes('rabby')
        : false;
}

export async function connectEvm(
  name: WalletName,
  projectId?: string,
  discoveryWaitMs = 120,
  mode: WalletNetworkMode = 'testnet',
): Promise<ConnectedWallet> {
  const network = EVM_NETWORKS[mode];
  let provider: RequestProvider;
  if (name === 'WalletConnect') {
    if (!projectId) throw new Error('缺少 WalletConnect Project ID');
    const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider');
    provider = await EthereumProvider.init({
      projectId,
      chains: [network.decimalChainId],
      showQrModal: true,
      rpcMap: { [network.decimalChainId]: network.rpcUrl },
    }) as unknown as RequestProvider;
  } else {
    const item = (await discoverEvmProviders(discoveryWaitMs)).find(value => matchEvm(name, value));
    if (!item) throw new Error(`未检测到 ${name}`);
    provider = item.provider;
  }
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts[0] || !isAddress(accounts[0])) throw new Error('EVM 钱包未返回有效活动账户');
  let chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (chainId !== network.chainId) {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: network.chainId }] });
    chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  }
  if (chainId !== network.chainId) throw new Error(`钱包没有切换到 ${network.name}，已停止连接`);
  return {
    name,
    family: 'EVM',
    address: getAddress(accounts[0]),
    network: network.name,
    mode,
    chainId: network.chainId,
    readOnly: mode === 'mainnet',
    provider,
    eventProvider: provider,
  };
}

export function getSolProvider(name: WalletName): SolProvider | undefined {
  const root = win();
  if (name === 'OKX Wallet') return root.okxwallet?.solana;
  if (name === 'Phantom') return root.phantom?.solana ?? (root.solana?.isPhantom ? root.solana : undefined);
  if (name === 'Backpack') return root.backpack ?? root.xnft?.solana;
  if (name === 'Solflare') return root.solflare;
  return undefined;
}

export async function assertSolanaNetwork(connection: Pick<Connection, 'getGenesisHash'>, mode: WalletNetworkMode) {
  const actual = await connection.getGenesisHash();
  const expected = SOLANA_NETWORKS[mode];
  if (actual !== expected.chainId) throw new Error(`Solana RPC 不是 ${expected.name.replace('Solana ', '')}，已停止连接`);
}

export async function assertSolanaDevnet(connection: Pick<Connection, 'getGenesisHash'>) {
  return assertSolanaNetwork(connection, 'testnet');
}

export async function connectSol(
  name: WalletName,
  connection?: Pick<Connection, 'getGenesisHash'>,
  mode: WalletNetworkMode = 'testnet',
): Promise<ConnectedWallet> {
  await assertSolanaNetwork(connection ?? solanaConnection(mode), mode);
  const provider = getSolProvider(name);
  if (!provider) throw new Error(`未检测到 ${name}`);
  const result = provider.connect ? await provider.connect() : undefined;
  const address = result?.publicKey?.toString() ?? provider.publicKey?.toString();
  if (!address) throw new Error('钱包未返回 Solana 地址');
  try {
    if (new PublicKey(address).toBase58() !== address) throw new Error();
  } catch {
    throw new Error('钱包返回了无效 Solana 地址');
  }
  const network = SOLANA_NETWORKS[mode];
  return {
    name,
    family: 'SOL',
    address,
    network: network.name,
    mode,
    chainId: network.chainId,
    readOnly: mode === 'mainnet',
    provider,
    eventProvider: provider,
  };
}

function tronNetwork(tronWeb: TronWeb, mode: WalletNetworkMode) {
  let hostname = '';
  try { hostname = new URL(String(tronWeb.fullNode?.host ?? '')).hostname.toLowerCase(); } catch { /* rejected below */ }
  const network = TRON_NETWORKS[hostname];
  if (!network || network.mode !== mode) {
    throw new Error(mode === 'mainnet'
      ? '请先将 TRON 钱包切换到官方 Mainnet RPC（api.trongrid.io）'
      : '请先将 TRON 钱包切换到官方 Nile 或 Shasta 测试网 RPC');
  }
  return network;
}

async function assertTronProviderChain(provider: TronProvider, expectedChainId: string) {
  try {
    const value = await provider.request({ method: 'eth_chainId' });
    if (typeof value === 'string' && value.startsWith('0x') && value.toLowerCase() !== expectedChainId) {
      throw new Error('TRON 钱包报告的 Chain ID 与 RPC 网络不一致，已停止连接');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Chain ID')) throw error;
    // Legacy providers may not expose eth_chainId; the exact official RPC hostname remains mandatory.
  }
}

export async function connectTron(
  name: 'OKX Wallet' | 'TronLink' = 'TronLink',
  mode: WalletNetworkMode = 'testnet',
): Promise<ConnectedWallet> {
  const root = win();
  const provider = name === 'OKX Wallet' ? root.okxwallet?.tronLink : root.tron ?? root.tronLink;
  if (!provider) throw new Error(`未检测到 ${name}`);
  const result = await provider.request({ method: name === 'OKX Wallet' ? 'tron_requestAccounts' : 'eth_requestAccounts' }) as { code?: number } | undefined;
  if (result?.code && result.code !== 200) throw new Error(result.code === 4001 ? '用户拒绝连接' : `${name} TRON 连接失败`);
  const tronWeb = provider.tronWeb ?? root.tronWeb;
  const address = tronWeb?.defaultAddress?.base58;
  if (!tronWeb || !address || !validateAddress('TRON', address)) throw new Error('TRON 钱包未返回有效 Base58Check 地址');
  const network = tronNetwork(tronWeb, mode);
  await assertTronProviderChain(provider, network.chainId);
  return {
    name,
    family: 'TRON',
    address,
    network: network.name,
    mode,
    chainId: network.chainId,
    readOnly: mode === 'mainnet',
    provider: tronWeb,
    eventProvider: provider,
  };
}

export async function assertConnectedWalletSession(wallet: ConnectedWallet, connection?: Pick<Connection, 'getGenesisHash'>) {
  if (wallet.family === 'EVM') {
    const provider = wallet.provider as RequestProvider;
    const chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
    if (chainId !== wallet.chainId) throw new Error('EVM 钱包网络已变化，请重新连接');
    const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
    if (!accounts.some(address => address.toLowerCase() === wallet.address.toLowerCase())) throw new Error('EVM 钱包账户已变化，请重新连接');
    return;
  }
  if (wallet.family === 'SOL') {
    await assertSolanaNetwork(connection ?? solanaConnection(wallet.mode), wallet.mode);
    const active = (wallet.provider as SolProvider).publicKey?.toString();
    if (active && active !== wallet.address) throw new Error('Solana 钱包账户已变化，请重新连接');
    return;
  }
  const tronWeb = wallet.provider as TronWeb;
  const current = tronNetwork(tronWeb, wallet.mode);
  if (current.chainId !== wallet.chainId) throw new Error('TRON 钱包网络已变化，请重新连接');
  if (tronWeb.defaultAddress?.base58 !== wallet.address) throw new Error('TRON 钱包账户已变化，请重新连接');
}

export async function signWalletMessage(wallet: ConnectedWallet, message: string) {
  if (wallet.family === 'EVM') {
    return String(await (wallet.provider as RequestProvider).request({
      method: 'personal_sign',
      params: [`0x${[...new TextEncoder().encode(message)].map(value => value.toString(16).padStart(2, '0')).join('')}`, wallet.address],
    }));
  }
  if (wallet.family === 'SOL') {
    const result = await (wallet.provider as SolProvider).signMessage?.(new TextEncoder().encode(message));
    if (!result) throw new Error('该 Solana 钱包不支持消息签名');
    const signature = result instanceof Uint8Array ? result : result.signature;
    return btoa(String.fromCharCode(...signature));
  }
  return String(await (wallet.provider as TronWeb).trx.signMessageV2(message));
}

export async function signChallenge(wallet: ConnectedWallet) {
  await assertConnectedWalletSession(wallet);
  const purpose = wallet.mode === 'mainnet' ? 'mainnet read-only ownership verification' : 'testnet ownership verification';
  return signWalletMessage(wallet, [
    'Lightning Wallet',
    'Domain: lightingwallet.com',
    `Purpose: ${purpose}`,
    `Network: ${wallet.network}`,
    `Address: ${wallet.address}`,
    'This signature does not approve or broadcast a transaction.',
    `Nonce: ${crypto.randomUUID()}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n'));
}

function displayUnits(value: bigint, decimals: number) {
  const formatted = formatUnits(value, decimals);
  const [whole = '0', fraction = ''] = formatted.split('.');
  const trimmed = fraction.slice(0, 6).replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export async function readNativeBalance(wallet: ConnectedWallet, connection?: Pick<Connection, 'getGenesisHash' | 'getBalance'>) {
  await assertConnectedWalletSession(wallet, connection);
  if (wallet.family === 'EVM') {
    const value = await (wallet.provider as RequestProvider).request({ method: 'eth_getBalance', params: [wallet.address, 'latest'] });
    return { symbol: 'ETH', formatted: displayUnits(BigInt(String(value)), 18) };
  }
  if (wallet.family === 'SOL') {
    const active = connection ?? solanaConnection(wallet.mode);
    const lamports = await active.getBalance(new PublicKey(wallet.address), 'confirmed');
    return { symbol: 'SOL', formatted: displayUnits(BigInt(lamports), 9) };
  }
  const tronWeb = wallet.provider as TronWeb;
  if (!tronWeb.trx.getBalance) throw new Error('当前 TRON 钱包不支持余额读取');
  const sun = await tronWeb.trx.getBalance(wallet.address);
  return { symbol: 'TRX', formatted: displayUnits(BigInt(sun), 6) };
}

export function subscribeWalletSession(wallet: ConnectedWallet, onInvalidated: (reason: string) => void) {
  const source = (wallet.eventProvider ?? wallet.provider) as EventProvider;
  const listeners: Array<[string, (...args: unknown[]) => void]> = [];
  let invalidated = false;
  const invalidate = (reason: string) => {
    if (invalidated) return;
    invalidated = true;
    onInvalidated(reason);
  };
  const listen = (event: string, listener: (...args: unknown[]) => void) => {
    if (!source.on) return;
    source.on(event, listener);
    listeners.push([event, listener]);
  };

  if (wallet.family === 'EVM') {
    listen('accountsChanged', value => {
      const accounts = Array.isArray(value) ? value.map(String) : [];
      if (!accounts.some(address => address.toLowerCase() === wallet.address.toLowerCase())) invalidate('EVM 钱包账户已变化，连接已安全断开');
    });
    listen('chainChanged', value => {
      if (String(value).toLowerCase() !== wallet.chainId) invalidate('EVM 钱包网络已变化，连接已安全断开');
    });
  } else if (wallet.family === 'SOL') {
    listen('accountChanged', value => {
      const address = value && typeof value === 'object' && 'toString' in value ? String(value) : '';
      if (address !== wallet.address) invalidate('Solana 钱包账户已变化，连接已安全断开');
    });
  } else {
    listen('accountsChanged', value => {
      const values = Array.isArray(value) ? value.map(String) : [];
      if (!values.includes(wallet.address)) invalidate('TRON 钱包账户已变化，连接已安全断开');
    });
    listen('chainChanged', value => {
      if (String(value).toLowerCase() !== wallet.chainId) invalidate('TRON 钱包网络已变化，连接已安全断开');
    });
  }
  listen('disconnect', () => invalidate('钱包已断开连接'));

  return () => {
    for (const [event, listener] of listeners) {
      source.removeListener?.(event, listener);
      source.off?.(event, listener);
    }
  };
}

export async function disconnectWallet(wallet: ConnectedWallet) {
  const source = (wallet.eventProvider ?? wallet.provider) as EventProvider;
  await source.disconnect?.().catch(() => undefined);
}

export async function broadcastSelfTest(wallet: ConnectedWallet, connection?: Connection) {
  if (isMainnetWallet(wallet)) throw new Error('主网连接仅支持只读验证，禁止广播自测交易');
  if (wallet.family === 'EVM') {
    const requestProvider = wallet.provider as RequestProvider;
    const chainId = String(await requestProvider.request({ method: 'eth_chainId' })).toLowerCase();
    if (chainId !== EVM_NETWORKS.testnet.chainId) throw new Error('钱包已离开 Sepolia，未请求签名');
    const accounts = await requestProvider.request({ method: 'eth_accounts' }) as string[];
    if (!accounts.some(address => address.toLowerCase() === wallet.address.toLowerCase())) throw new Error('当前 EVM 账户已变化，未请求签名');
    const provider = new BrowserProvider(requestProvider);
    const signer = await provider.getSigner();
    const transaction = await signer.sendTransaction({ to: wallet.address, value: 0n });
    const receipt = await transaction.wait(1);
    if (!receipt || receipt.status !== 1) throw new Error(`Sepolia 交易执行失败：${transaction.hash}`);
    return transaction.hash;
  }
  if (wallet.family === 'SOL') {
    const provider = wallet.provider as SolProvider;
    const activeConnection = connection ?? solanaConnection('testnet');
    await assertSolanaNetwork(activeConnection, 'testnet');
    const from = new PublicKey(wallet.address);
    const { blockhash, lastValidBlockHeight } = await activeConnection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: from, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: from, lamports: 0 }));
    const { signature } = await provider.signAndSendTransaction(transaction);
    const confirmation = await activeConnection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (confirmation.value.err) throw new Error(`Solana Devnet 交易执行失败：${signature}`);
    return signature;
  }
  const tronWeb = wallet.provider as TronWeb;
  const network = tronNetwork(tronWeb, 'testnet');
  if (network.name !== wallet.network) throw new Error('TRON 钱包网络已变化，未请求签名');
  if (tronWeb.defaultAddress?.base58 !== wallet.address) throw new Error('当前 TRON 账户已变化，未请求签名');
  const unsigned = await tronWeb.transactionBuilder.sendTrx(wallet.address, 1, wallet.address);
  const signed = await tronWeb.trx.sign(unsigned);
  const result = await tronWeb.trx.sendRawTransaction(signed);
  if (!result.result) throw new Error(result.message ?? 'TRON 广播失败');
  const txId = String(result.txid ?? signed.txID ?? unsigned.txID ?? '');
  if (!txId) throw new Error('TRON 钱包未返回交易 ID');
  for (let attempt = 0; attempt < 20; attempt++) {
    const info = await tronWeb.trx.getTransactionInfo(txId).catch(() => null);
    if (info?.id) {
      if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`TRON 测试网交易执行失败：${txId}`);
      return txId;
    }
    await sleep(1500);
  }
  throw new Error(`TRON 确认超时：${txId}`);
}
