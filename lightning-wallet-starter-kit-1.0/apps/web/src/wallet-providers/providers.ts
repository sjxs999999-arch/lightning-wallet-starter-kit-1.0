import { BrowserProvider, getAddress, isAddress } from 'ethers';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { validateAddress } from '../batch-transfer/validation';
import type { ConnectedWallet, RequestProvider, WalletName } from './types';

type Eip6963 = { info: { name: string; rdns: string }; provider: RequestProvider };
type SolProvider = {
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
  };
};
type TronProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown>; tronWeb?: TronWeb };
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

const SEPOLIA_CHAIN_ID = '0xaa36a7';
const SOLANA_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const TRON_TEST_NETWORKS: Record<string, string> = {
  'nile.trongrid.io': 'TRON Nile',
  'api.nileex.io': 'TRON Nile',
  'api.shasta.trongrid.io': 'TRON Shasta',
};
const win = () => window as WalletWindow;
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const solanaDevnetConnection = () => new Connection(import.meta.env.VITE_LAUNCHPAD_SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');

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

export async function connectEvm(name: WalletName, projectId?: string, discoveryWaitMs = 120): Promise<ConnectedWallet> {
  let provider: RequestProvider;
  if (name === 'WalletConnect') {
    if (!projectId) throw new Error('缺少 WalletConnect Project ID');
    const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider');
    provider = await EthereumProvider.init({
      projectId,
      chains: [11155111],
      showQrModal: true,
      rpcMap: { 11155111: 'https://ethereum-sepolia-rpc.publicnode.com' },
    }) as unknown as RequestProvider;
  } else {
    const item = (await discoverEvmProviders(discoveryWaitMs)).find(value => matchEvm(name, value));
    if (!item) throw new Error(`未检测到 ${name}`);
    provider = item.provider;
  }
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts[0] || !isAddress(accounts[0])) throw new Error('EVM 钱包未返回有效活动账户');
  let chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (chainId !== SEPOLIA_CHAIN_ID) {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID }] });
    chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  }
  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error('钱包没有切换到 Sepolia，已停止连接');
  return { name, family: 'EVM', address: getAddress(accounts[0]), network: 'Sepolia', provider };
}

export function getSolProvider(name: WalletName): SolProvider | undefined {
  const root = win();
  if (name === 'OKX Wallet') return root.okxwallet?.solana;
  if (name === 'Phantom') return root.phantom?.solana ?? (root.solana?.isPhantom ? root.solana : undefined);
  if (name === 'Backpack') return root.backpack ?? root.xnft?.solana;
  if (name === 'Solflare') return root.solflare;
  return undefined;
}

export async function assertSolanaDevnet(connection: Pick<Connection, 'getGenesisHash'>) {
  if (await connection.getGenesisHash() !== SOLANA_DEVNET_GENESIS) throw new Error('Solana RPC 不是 Devnet，已停止连接');
}

export async function connectSol(name: WalletName, connection: Pick<Connection, 'getGenesisHash'> = solanaDevnetConnection()): Promise<ConnectedWallet> {
  await assertSolanaDevnet(connection);
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
  return { name, family: 'SOL', address, network: 'Solana Devnet', provider };
}

function tronTestNetwork(tronWeb: TronWeb) {
  let hostname = '';
  try { hostname = new URL(String(tronWeb.fullNode?.host ?? '')).hostname.toLowerCase(); } catch { /* rejected below */ }
  const network = TRON_TEST_NETWORKS[hostname];
  if (!network) throw new Error('请先将 TRON 钱包切换到官方 Nile 或 Shasta 测试网 RPC');
  return network;
}

export async function connectTron(name: 'OKX Wallet' | 'TronLink' = 'TronLink'): Promise<ConnectedWallet> {
  const root = win();
  const provider = name === 'OKX Wallet' ? root.okxwallet?.tronLink : root.tron ?? root.tronLink;
  if (!provider) throw new Error(`未检测到 ${name}`);
  const result = await provider.request({ method: name === 'OKX Wallet' ? 'tron_requestAccounts' : 'eth_requestAccounts' }) as { code?: number } | undefined;
  if (result?.code && result.code !== 200) throw new Error(result.code === 4001 ? '用户拒绝连接' : `${name} TRON 连接失败`);
  const tronWeb = provider.tronWeb ?? root.tronWeb;
  const address = tronWeb?.defaultAddress?.base58;
  if (!tronWeb || !address || !validateAddress('TRON', address)) throw new Error('TRON 钱包未返回有效 Base58Check 地址');
  return { name, family: 'TRON', address, network: tronTestNetwork(tronWeb), provider: tronWeb };
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
  return signWalletMessage(wallet, `Lightning Wallet testnet ownership verification\n${crypto.randomUUID()}\n${new Date().toISOString()}`);
}

export async function broadcastSelfTest(wallet: ConnectedWallet, connection?: Connection) {
  if (wallet.family === 'EVM') {
    const requestProvider = wallet.provider as RequestProvider;
    const chainId = String(await requestProvider.request({ method: 'eth_chainId' })).toLowerCase();
    if (chainId !== SEPOLIA_CHAIN_ID) throw new Error('钱包已离开 Sepolia，未请求签名');
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
    const activeConnection = connection ?? solanaDevnetConnection();
    await assertSolanaDevnet(activeConnection);
    const from = new PublicKey(wallet.address);
    const { blockhash, lastValidBlockHeight } = await activeConnection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: from, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: from, lamports: 0 }));
    const { signature } = await provider.signAndSendTransaction(transaction);
    const confirmation = await activeConnection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (confirmation.value.err) throw new Error(`Solana Devnet 交易执行失败：${signature}`);
    return signature;
  }
  const tronWeb = wallet.provider as TronWeb;
  const network = tronTestNetwork(tronWeb);
  if (network !== wallet.network) throw new Error('TRON 钱包网络已变化，未请求签名');
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
