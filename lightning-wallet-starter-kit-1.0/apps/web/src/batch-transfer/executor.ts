import { Buffer } from 'buffer';
import { Interface, parseEther, parseUnits } from 'ethers';
import { api } from '../api';
import { assertExecutionPolicy } from './execution-policy';
import type { TransferTask } from './types';

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

declare global { interface Window { ethereum?: EvmProvider; okxwallet?: OkxWallet; tronWeb?: TronWeb; solana?: SolanaProvider } }

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
export function getSolanaProvider() { return window.okxwallet?.solana ?? window.solana; }

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
  const provider = window.okxwallet ?? window.ethereum;
  if (!provider) throw new Error('未检测到 OKX、MetaMask、Rabby 或其他 EVM 钱包');
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts.some(address => address.toLowerCase() === task.from.toLowerCase())) throw new Error('当前钱包账户与 CSV 发送钱包不一致');
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
  const tronLink = window.okxwallet?.tronLink;
  if (tronLink) {
    const connection = await tronLink.request({ method: 'tron_requestAccounts' }) as { code?: number };
    if (connection?.code === 4001) throw new Error('用户拒绝连接 OKX Wallet');
    if (connection?.code && connection.code !== 200) throw new Error('OKX Wallet TRON 连接失败');
  }
  const tronWeb = tronLink?.tronWeb ?? window.tronWeb;
  if (!tronWeb) throw new Error('未检测到 OKX Wallet 或 TronLink TRON Provider');
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
  const solana = getSolanaProvider();
  if (!solana) throw new Error('未检测到 OKX、Phantom、Backpack 或 Solflare 钱包');
  const connected = solana.connect ? await solana.connect() : undefined;
  const solanaAddress = connected?.publicKey?.toString() ?? solana.publicKey?.toString();
  if (!solanaAddress) throw new Error('Solana 钱包未返回活动账户');
  if (solanaAddress !== task.from) throw new Error(`当前 Solana 账户 ${solanaAddress} 与 CSV 发送钱包不一致`);
  const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } = await import('@solana/web3.js');
  const network = import.meta.env.VITE_SOLANA_NETWORK || 'devnet';
  assertExecutionPolicy([task], network);
  const connection = new Connection(import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
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
