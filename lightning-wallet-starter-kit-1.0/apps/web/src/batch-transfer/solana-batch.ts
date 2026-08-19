import { Buffer } from 'buffer';
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { parseUnits } from 'ethers';
import { api } from '../api';
import { assertExecutionPolicy } from './execution-policy';
import { getSolanaProvider } from './executor';
import type { TransferTask } from './types';

const ASSOCIATED = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
type SignedTransaction = { serialize(): Uint8Array };
type BatchProvider = ReturnType<typeof getSolanaProvider> & { signAllTransactions?(transactions: Transaction[]): Promise<SignedTransaction[]> };
export type SolanaBatchResult = { index: number; signature?: string; state: 'submitted' | 'confirmed' | 'failed'; error?: string };
export type SolanaBatchOptions = { waitUntilResumed?: () => Promise<void>; onBroadcast?: (result: SolanaBatchResult) => void };

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const ata = (wallet: PublicKey, mint: PublicKey, tokenProgram: PublicKey) => PublicKey.findProgramAddressSync([wallet.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ASSOCIATED)[0];

export function buildSolanaBatchTransactions(tasks: TransferTask[], owner: PublicKey, blockhash: string, mintPrograms: Map<string, PublicKey>): Transaction[] {
  return tasks.map(task => {
    const recipient = new PublicKey(task.to);
    const transaction = new Transaction({ feePayer: owner, recentBlockhash: blockhash });
    if (!task.token) return transaction.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: recipient, lamports: parseUnits(task.amount, 9) }));
    const mint = new PublicKey(task.token);
    const tokenProgram = mintPrograms.get(task.token);
    if (!tokenProgram) throw new Error(`Token Program 未加载：${task.token}`);
    const source = ata(owner, mint, tokenProgram);
    const destination = ata(recipient, mint, tokenProgram);
    const amount = parseUnits(task.amount, task.decimals!);
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, amount, true);
    return transaction.add(
      new TransactionInstruction({ programId: ASSOCIATED, keys: [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: tokenProgram, isSigner: false, isWritable: false }], data: Buffer.from([1]) }),
      new TransactionInstruction({ programId: tokenProgram, keys: [{ pubkey: source, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: destination, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from([12, ...bytes, task.decimals!]) }),
    );
  });
}

async function latestBlockhash(connection: Connection, network: string) {
  if (network !== 'mainnet-beta') return connection.getLatestBlockhash('confirmed');
  try { return (await api<{ data: { blockhash: string; lastValidBlockHeight: number } }>('/solana/latest-blockhash')).data; }
  catch { return connection.getLatestBlockhash('confirmed'); }
}

async function sendWithBackoff(connection: Connection, transaction: SignedTransaction): Promise<string> {
  let lastError = 'Solana RPC 广播失败';
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }); }
    catch (cause) {
      lastError = cause instanceof Error ? cause.message : lastError;
      if (!/429|too many|rate limit|fetch|timeout/i.test(lastError)) break;
      await sleep(300 * 2 ** attempt);
    }
  }
  throw new Error(lastError);
}

async function broadcastSigned(connection: Connection, signed: SignedTransaction[], options: SolanaBatchOptions): Promise<SolanaBatchResult[]> {
  const results = new Array<SolanaBatchResult>(signed.length);
  let cursor = 0;
  async function worker() {
    while (cursor < signed.length) {
      const index = cursor++;
      await options.waitUntilResumed?.();
      try { results[index] = { index, signature: await sendWithBackoff(connection, signed[index]!), state: 'submitted' }; }
      catch (cause) { results[index] = { index, state: 'failed', error: cause instanceof Error ? cause.message : '广播失败' }; }
      options.onBroadcast?.(results[index]!);
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, signed.length) }, () => worker()));
  return results;
}

async function confirmSubmitted(connection: Connection, results: SolanaBatchResult[]): Promise<void> {
  const submitted = results.filter(result => result.signature);
  for (let attempt = 0; attempt < 15 && submitted.some(result => result.state === 'submitted'); attempt++) {
    const pending = submitted.filter(result => result.state === 'submitted');
    for (let offset = 0; offset < pending.length; offset += 256) {
      const batch = pending.slice(offset, offset + 256);
      try {
        const statuses = await connection.getSignatureStatuses(batch.map(result => result.signature!), { searchTransactionHistory: false });
        statuses.value.forEach((status, index) => {
          if (!status) return;
          const result = batch[index]!;
          if (status.err) { result.state = 'failed'; result.error = '链上交易执行失败'; }
          else if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') result.state = 'confirmed';
        });
      } catch { /* keep submitted and retry without duplicating the broadcast */ }
    }
    if (submitted.some(result => result.state === 'submitted')) await sleep(1500);
  }
}

export async function executeSolanaBatch(tasks: TransferTask[], options: SolanaBatchOptions = {}): Promise<SolanaBatchResult[]> {
  const network = import.meta.env.VITE_SOLANA_NETWORK || 'devnet';
  assertExecutionPolicy(tasks, network);
  if (!tasks.every(task => task.chain === 'SOL')) throw new Error('Solana 批量签名不能混合其他链任务');
  const provider = getSolanaProvider() as BatchProvider;
  if (!provider?.signAllTransactions) throw new Error('当前 Solana 钱包不支持 signAllTransactions，请更新扩展或改用逐笔签名');
  const connected = provider.connect ? await provider.connect() : undefined;
  const address = connected?.publicKey?.toString() ?? provider.publicKey?.toString();
  if (address !== tasks[0]!.from) throw new Error(`当前 Solana 账户 ${address ?? '未知'} 与 CSV 发送钱包不一致`);
  const connection = new Connection(import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
  const latest = await latestBlockhash(connection, network);
  const owner = new PublicKey(tasks[0]!.from);
  const mintPrograms = new Map<string, PublicKey>();
  for (const mintAddress of new Set(tasks.flatMap(task => task.token ? [task.token] : []))) {
    const mint = new PublicKey(mintAddress);
    const info = await connection.getAccountInfo(mint, 'confirmed');
    if (!info) throw new Error(`找不到 SPL Token Mint：${mintAddress}`);
    mintPrograms.set(mintAddress, info.owner);
  }
  const transactions = buildSolanaBatchTransactions(tasks, owner, latest.blockhash, mintPrograms);
  const signed = await provider.signAllTransactions(transactions);
  if (signed.length !== transactions.length) throw new Error('钱包返回的签名交易数量不完整，未广播');
  const results = await broadcastSigned(connection, signed, options);
  await confirmSubmitted(connection, results);
  return results;
}
