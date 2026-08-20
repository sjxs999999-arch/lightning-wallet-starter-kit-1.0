import { Buffer } from 'buffer';
import { Interface, isAddress, parseEther, parseUnits } from 'ethers';
import { api } from '../api';
import { discoverEvmProviders } from '../wallet-providers/providers';
import { assertExecutionPolicy, assertSolanaRpcNetwork } from './execution-policy';
import type { TransferChain, TransferTask } from './types';

type EvmProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type TronSendResult = string | { txid?: string; txID?: string };
type TronWeb = {
  defaultAddress?: { base58?: string };
  fullNode?: { host?: string };
  trx: { sendTransaction(to: string, amount: number): Promise<{ result: boolean; txid: string }>; getTransactionInfo?(txId: string): Promise<{ id?: string; receipt?: { result?: string } }> };
  contract(): { at(address: string): Promise<{ transfer(to: string, amount: string): { send(): Promise<TronSendResult> } }> };
};
export type SolanaProvider = { publicKey?: { toString(): string }; connect?(): Promise<{ publicKey?: { toString(): string } }>; signAndSendTransaction(tx: unknown): Promise<{ signature: string }>; signAllTransactions?(transactions: unknown[]): Promise<{ serialize(): Uint8Array }[]> };
type OkxWallet = EvmProvider & { tronLink?: { request(args: { method: string; params?: unknown[] }): Promise<{ code?: number } | unknown>; tronWeb?: TronWeb }; solana?: SolanaProvider };
export type ExecutionResult = { hash: string; state: 'submitted' | 'confirmed' };

type TronExtension = { request(args: { method: string; params?: unknown[] }): Promise<{ code?: number } | unknown>; tronWeb?: TronWeb };
declare global { interface Window { ethereum?: EvmProvider; okxwallet?: OkxWallet; rabby?: EvmProvider; tronWeb?: TronWeb; tron?: TronExtension; tronLink?: TronExtension; solana?: SolanaProvider; phantom?: { solana?: SolanaProvider }; backpack?: SolanaProvider; xnft?: { solana?: SolanaProvider }; solflare?: SolanaProvider } }

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const unique = <T extends object>(values: (T | undefined)[]) => values.filter((value, index, all): value is T => Boolean(value) && all.indexOf(value) === index);
const normalized = (addresses: string[]) => new Set(addresses.map(address => address.toLowerCase()));
const evmProviderCache = new Map<string, { provider: EvmProvider; root: Window }>();

async function authorizedAccounts(provider: EvmProvider): Promise<string[]> {
  const response = await provider.request({ method: 'eth_accounts' }).catch(() => []);
  return Array.isArray(response) ? response.filter((value): value is string => typeof value === 'string' && isAddress(value)) : [];
}

export async function resolveEvmProvider(expectedAddresses: string[] = []): Promise<{ provider: EvmProvider; address: string }> {
  const expected = normalized(expectedAddresses);
  if (expected.size === 1) {
    const key = [...expected][0]!;
    const cached = evmProviderCache.get(key);
    if (cached?.root === window) {
      const match = (await authorizedAccounts(cached.provider)).find(address => address.toLowerCase() === key);
      if (match) return { provider: cached.provider, address: match };
      evmProviderCache.delete(key);
    }
  }
  const discovered = typeof window.addEventListener === 'function' ? await discoverEvmProviders(120) : [];
  const providers = unique<EvmProvider>([...discovered.map(item => item.provider), window.ethereum, window.okxwallet, window.rabby]);
  if (!providers.length) throw new Error('未检测到 MetaMask、OKX、Rabby 或其他 EVM 钱包');
  let firstAuthorized: { provider: EvmProvider; address: string } | undefined;
  for (const provider of providers) {
    const accounts = await authorizedAccounts(provider);
    const valid = accounts[0];
    if (valid && !firstAuthorized) firstAuthorized = { provider, address: valid };
    const match = accounts.find(address => expected.has(address.toLowerCase()));
    if (match) { evmProviderCache.set(match.toLowerCase(), { provider, root: window }); return { provider, address: match }; }
  }
  if (!expected.size && firstAuthorized) return firstAuthorized;
  const promptProvider = providers.length === 1 ? providers[0]! : window.ethereum;
  if (!promptProvider) throw new Error('存在多个 EVM 钱包，但没有已授权且匹配的账户；请先在钱包中心连接发送钱包');
  const response = await promptProvider.request({ method: 'eth_requestAccounts' });
  const accounts = Array.isArray(response) ? response.filter((value): value is string => typeof value === 'string') : [];
  const address = accounts.find(value => isAddress(value) && (!expected.size || expected.has(value.toLowerCase())));
  if (!address) throw new Error('当前 EVM 钱包账户与待执行发送地址不匹配；请切换账户或先在钱包中心连接');
  evmProviderCache.set(address.toLowerCase(), { provider: promptProvider, root: window });
  return { provider: promptProvider, address };
}

export function getSolanaProvider(expectedAddresses: string[] = []) {
  const candidates = unique<SolanaProvider>([window.okxwallet?.solana, window.phantom?.solana, window.backpack, window.xnft?.solana, window.solflare, window.solana]);
  const expected = new Set(expectedAddresses);
  const match = candidates.find(provider => provider.publicKey && expected.has(provider.publicKey.toString()));
  if (match) return match;
  const connected = candidates.find(provider => provider.publicKey);
  if (!expected.size) return connected ?? candidates[0];
  return candidates.length === 1 ? candidates[0] : undefined;
}

function getTronWallet(expectedAddresses: string[] = []) {
  const candidates = [
    window.okxwallet?.tronLink ? { extension: window.okxwallet.tronLink, tronWeb: window.okxwallet.tronLink.tronWeb, method: 'tron_requestAccounts' } : undefined,
    window.tron ? { extension: window.tron, tronWeb: window.tron.tronWeb, method: 'eth_requestAccounts' } : undefined,
    window.tronLink ? { extension: window.tronLink, tronWeb: window.tronLink.tronWeb, method: 'eth_requestAccounts' } : undefined,
    window.tronWeb ? { extension: undefined, tronWeb: window.tronWeb, method: '' } : undefined,
  ].filter((value, index, all): value is { extension: TronExtension | undefined; tronWeb: TronWeb; method: string } => Boolean(value?.tronWeb) && all.findIndex(item => item?.tronWeb === value?.tronWeb) === index);
  const expected = new Set(expectedAddresses);
  const match = candidates.find(item => item.tronWeb.defaultAddress?.base58 && expected.has(item.tronWeb.defaultAddress.base58));
  if (match) return match;
  if (!expected.size) return candidates.find(item => item.tronWeb.defaultAddress?.base58) ?? candidates[0];
  return candidates.length === 1 ? candidates[0] : undefined;
}

export async function getActiveSender(chain: TransferChain, expectedAddresses: string[] = []): Promise<string> {
  if (chain === 'EVM') {
    return (await resolveEvmProvider(expectedAddresses)).address;
  }
  if (chain === 'SOL') {
    const provider = getSolanaProvider(expectedAddresses);
    if (!provider) throw new Error('存在多个 Solana 钱包，但没有已连接且匹配的账户；请先在钱包中心连接发送钱包');
    const connected = provider.connect ? await provider.connect() : undefined;
    const address = connected?.publicKey?.toString() ?? provider.publicKey?.toString();
    if (!address) throw new Error('Solana 钱包未返回活动账户');
    if (expectedAddresses.length && !expectedAddresses.includes(address)) throw new Error(`当前 Solana 账户 ${address} 与待执行发送地址不匹配`);
    return address;
  }
  const selected = getTronWallet(expectedAddresses);
  if (!selected) throw new Error('存在多个 TRON 钱包，但没有已连接且匹配的账户；请先在钱包中心连接发送钱包');
  if (selected.extension && selected.method) {
    const connection = await selected.extension.request({ method: selected.method }) as { code?: number };
    if (connection?.code === 4001) throw new Error('用户拒绝连接 OKX Wallet');
    if (connection?.code && connection.code !== 200) throw new Error('TRON 钱包连接失败');
  }
  const address = selected.tronWeb.defaultAddress?.base58;
  if (!address) throw new Error('TRON 钱包未返回活动账户');
  if (expectedAddresses.length && !expectedAddresses.includes(address)) throw new Error(`当前 TRON 账户 ${address} 与待执行发送地址不匹配`);
  return address;
}

async function waitForEvmReceipt(provider: EvmProvider, hash: string): Promise<'submitted' | 'confirmed'> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === '0x0') throw new Error(`EVM 交易执行失败：${hash}`);
      return 'confirmed';
    }
    await sleep(1500);
  }
  return 'submitted';
}

async function executeEvm(task: TransferTask): Promise<ExecutionResult> {
  const { provider } = await resolveEvmProvider([task.from]);
  const chainId = String(await provider.request({ method: 'eth_chainId' }));
  assertExecutionPolicy([task], chainId);
  let data: string | undefined;
  let value = '0x0';
  if (task.token) data = new Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [task.to, parseUnits(task.amount, task.decimals!)]);
  else value = `0x${parseEther(task.amount).toString(16)}`;
  const hash = String(await provider.request({ method: 'eth_sendTransaction', params: [{ from: task.from, to: task.token ?? task.to, value, ...(data ? { data } : {}) }] }));
  return { hash, state: await waitForEvmReceipt(provider, hash) };
}

async function executeTron(task: TransferTask): Promise<ExecutionResult> {
  const selected = getTronWallet([task.from]);
  if (!selected) throw new Error('没有找到已连接且与发送地址匹配的 OKX Wallet 或 TronLink');
  if (selected.extension && selected.method) {
    const connection = await selected.extension.request({ method: selected.method }) as { code?: number };
    if (connection?.code === 4001) throw new Error('用户拒绝连接 OKX Wallet');
    if (connection?.code && connection.code !== 200) throw new Error('TRON 钱包连接失败');
  }
  const tronWeb = selected.tronWeb;
  if (tronWeb.defaultAddress?.base58 !== task.from) throw new Error('当前 TRON 账户与 CSV 发送钱包不一致');
  const host = String(tronWeb.fullNode?.host ?? '');
  assertExecutionPolicy([task], host);
  let hash: string;
  if (task.token) {
    const contract = await tronWeb.contract().at(task.token);
    const result = await contract.transfer(task.to, parseUnits(task.amount, task.decimals!).toString()).send();
    hash = typeof result === 'string' ? result : result.txid ?? result.txID ?? '';
    if (!hash) throw new Error('TRON 钱包未返回交易 ID');
  } else {
    const sun = parseUnits(task.amount, 6);
    if (sun > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TRX 数量超过钱包 Provider 的安全整数范围，未请求签名');
    const result = await tronWeb.trx.sendTransaction(task.to, Number(sun));
    if (!result.result) throw new Error('TRON 钱包拒绝交易');
    hash = result.txid;
  }
  if (!tronWeb.trx.getTransactionInfo) return { hash, state: 'submitted' };
  for (let attempt = 0; attempt < 20; attempt++) {
    const info = await tronWeb.trx.getTransactionInfo(hash).catch(() => null);
    if (info?.id) {
      if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`TRON 交易执行失败：${hash}`);
      return { hash, state: 'confirmed' };
    }
    await sleep(1500);
  }
  return { hash, state: 'submitted' };
}

async function latestSolanaBlockhash(connection: import('@solana/web3.js').Connection, network: string) {
  if (network !== 'mainnet-beta') return connection.getLatestBlockhash('confirmed');
  try { return (await api<{ data: { blockhash: string; lastValidBlockHeight: number } }>('/solana/latest-blockhash')).data; }
  catch { return connection.getLatestBlockhash('confirmed'); }
}

async function executeSolana(task: TransferTask): Promise<ExecutionResult> {
  const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } = await import('@solana/web3.js');
  const network = import.meta.env.VITE_SOLANA_NETWORK || 'devnet';
  assertExecutionPolicy([task], network);
  const connection = new Connection(import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
  await assertSolanaRpcNetwork(connection, network);
  const solana = getSolanaProvider([task.from]);
  if (!solana) throw new Error('没有找到已连接且与发送地址匹配的 OKX、Phantom、Backpack 或 Solflare 钱包');
  const connected = solana.connect ? await solana.connect() : undefined;
  const solanaAddress = connected?.publicKey?.toString() ?? solana.publicKey?.toString();
  if (!solanaAddress) throw new Error('Solana 钱包未返回活动账户');
  if (solanaAddress !== task.from) throw new Error(`当前 Solana 账户 ${solanaAddress} 与 CSV 发送钱包不一致`);
  const owner = new PublicKey(task.from);
  const recipient = new PublicKey(task.to);
  const transaction = new Transaction();
  if (task.token) {
    const mint = new PublicKey(task.token);
    const mintInfo = await connection.getAccountInfo(mint, 'confirmed');
    if (!mintInfo) throw new Error('找不到 SPL Token Mint');
    const tokenProgram = mintInfo.owner;
    const associatedProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const ata = (wallet: InstanceType<typeof PublicKey>) => PublicKey.findProgramAddressSync([wallet.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], associatedProgram)[0];
    const source = ata(owner);
    const destination = ata(recipient);
    const decimals = task.decimals!;
    const amount = parseUnits(task.amount, decimals);
    const amountBytes = new Uint8Array(8);
    new DataView(amountBytes.buffer).setBigUint64(0, amount, true);
    transaction.add(
      new TransactionInstruction({ programId: associatedProgram, keys: [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: tokenProgram, isSigner: false, isWritable: false }], data: Buffer.from([1]) }),
      new TransactionInstruction({ programId: tokenProgram, keys: [{ pubkey: source, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from([12, ...amountBytes, decimals]) }),
    );
  } else transaction.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: parseUnits(task.amount, 9) }));
  const latest = await latestSolanaBlockhash(connection, network);
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = owner;
  const { signature } = await solana.signAndSendTransaction(transaction);
  try {
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    if (confirmation.value.err) throw new Error(`Solana 交易执行失败：${signature}`);
    return { hash: signature, state: 'confirmed' };
  } catch (cause) {
    if (cause instanceof Error && /执行失败/.test(cause.message)) throw cause;
    return { hash: signature, state: 'submitted' };
  }
}

export async function executeTask(task: TransferTask, options: { batchConfirmed?: boolean } = {}): Promise<ExecutionResult> {
  if (!options.batchConfirmed && !window.confirm(`确认签名第 ${task.row - 1} 笔交易？\n${task.amount} → ${task.to}`)) throw new Error('用户取消签名');
  if (task.chain === 'EVM') return executeEvm(task);
  if (task.chain === 'TRON') return executeTron(task);
  return executeSolana(task);
}
