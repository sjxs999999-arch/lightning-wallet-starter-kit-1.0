import { Buffer } from 'buffer';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { getSolanaProvider, type SolanaProvider } from '../batch-transfer/executor';
import { assertSolanaRpcNetwork } from '../batch-transfer/execution-policy';

type TradeConnection = Pick<Connection, 'getGenesisHash' | 'confirmTransaction'>;

type ExecuteOptions = {
  provider?: SolanaProvider;
  connection?: TradeConnection;
  confirm?: (message: string) => boolean;
};

export type SolanaTradeExecution = { signature: string; state: 'submitted' | 'confirmed' };

export class SolanaTradeFailedError extends Error {
  constructor(message: string, readonly signature: string) {
    super(message);
    this.name = 'SolanaTradeFailedError';
  }
}

export function assertSolanaBatchTradeEnabled() {
  if (import.meta.env.VITE_MAINNET_EXECUTION_ENABLED !== 'true' || import.meta.env.VITE_ENABLE_MAINNET_SWAP !== 'true') {
    throw new Error('Solana 主网批量交易未通过双重生产开关；仅允许模拟');
  }
}

export async function executePreparedSolanaTrade(walletAddress: string, serializedTransaction: string, confirmationMessage: string, options: ExecuteOptions = {}): Promise<SolanaTradeExecution> {
  assertSolanaBatchTradeEnabled();
  const connection = options.connection ?? new Connection(import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  await assertSolanaRpcNetwork(connection, 'mainnet-beta');

  const provider = options.provider ?? getSolanaProvider([walletAddress]);
  if (!provider) throw new Error('没有找到已连接且与该行地址匹配的 OKX、Phantom、Backpack 或 Solflare 钱包');
  const connected = provider.publicKey?.toString() ? undefined : await provider.connect?.();
  const active = connected?.publicKey?.toString() ?? provider.publicKey?.toString() ?? '';
  if (active !== walletAddress) throw new Error(`当前钱包为 ${active ? `${active.slice(0, 8)}…${active.slice(-6)}` : '未连接'}，请切换到该行地址再执行`);

  let transaction: VersionedTransaction;
  try { transaction = VersionedTransaction.deserialize(Buffer.from(serializedTransaction, 'base64')); }
  catch { throw new Error('交易载荷无法解析，已阻止签名'); }
  if (transaction.message.staticAccountKeys[0]?.toString() !== walletAddress) throw new Error('交易付款人与当前钱包不一致，已阻止签名');

  if (!(options.confirm ?? window.confirm)(confirmationMessage)) throw new Error('用户取消签名');
  const signature = (await provider.signAndSendTransaction(transaction)).signature;
  if (!signature) throw new Error('钱包未返回交易签名');
  try {
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    if (confirmation.value.err) throw new SolanaTradeFailedError(`Solana 批量交易链上执行失败：${signature}`, signature);
    return { signature, state: 'confirmed' };
  } catch (cause) {
    if (cause instanceof SolanaTradeFailedError) throw cause;
    return { signature, state: 'submitted' };
  }
}
