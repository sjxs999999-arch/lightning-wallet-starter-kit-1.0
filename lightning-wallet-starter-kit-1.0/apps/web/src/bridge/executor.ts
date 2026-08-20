import { Buffer } from 'buffer';
import { Interface, isAddress } from 'ethers';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { getSolanaProvider, resolveEvmProvider } from '../batch-transfer/executor';
import { assertSolanaRpcNetwork } from '../batch-transfer/execution-policy';
import type { BridgeQuoteRequest, BridgeRoute } from './types';

type EvmProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type SolanaProvider = {
  publicKey?: { toString(): string };
  connect?(): Promise<{ publicKey?: { toString(): string } }>;
  signAndSendTransaction(transaction: VersionedTransaction): Promise<{ signature: string }>;
};

type ExecuteOptions = {
  evmProvider?: EvmProvider;
  solanaProvider?: SolanaProvider;
  confirm?: (message: string) => boolean;
  now?: () => number;
  solanaConnection?: Pick<Connection, 'getGenesisHash' | 'confirmTransaction'>;
};

export type BridgeExecution = { kind: 'approval' | 'bridge'; reference: string };

const erc20 = new Interface(['function allowance(address owner,address spender) view returns (uint256)', 'function approve(address spender,uint256 amount) returns (bool)']);
const nativeToken = (address?: string) => !address || /^0x(?:e{40}|0{40})$/i.test(address);

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export function assertBridgeExecutionEnabled() {
  if (import.meta.env.VITE_MAINNET_EXECUTION_ENABLED !== 'true' || import.meta.env.VITE_ENABLE_MAINNET_BRIDGE !== 'true') throw new Error('主网跨链未通过双重生产开关；仅允许报价与模拟');
}

function requireFresh(route: BridgeRoute, now: () => number) {
  if (!route.expiresAt || !Number.isFinite(Date.parse(route.expiresAt)) || Date.parse(route.expiresAt) <= now() + 5_000) throw new Error('跨链报价已过期，请重新获取并模拟');
}

async function waitEvmReceipt(provider: EvmProvider, reference: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [reference] }) as { status?: string } | null;
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error(`跨链交易失败或回执状态不可验证：${reference}`);
      return;
    }
    await sleep(1500);
  }
  throw new Error(`跨链交易已提交但确认超时，请使用交易编号核验：${reference}`);
}

async function executeEvm(request: BridgeQuoteRequest, route: BridgeRoute, provider: EvmProvider, confirm: (message: string) => boolean): Promise<BridgeExecution> {
  const transaction = route.transaction;
  if (!transaction || transaction.family !== 'EVM' || transaction.chainId !== request.fromChainId || !isAddress(transaction.to) || !/^0x(?:[0-9a-f]{2})*$/i.test(transaction.data ?? '')) throw new Error('跨链交易载荷不完整或网络不匹配');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const account = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : '';
  if (!isAddress(account) || account.toLowerCase() !== request.fromAddress.toLowerCase()) throw new Error('当前钱包与报价发送钱包不一致，请切换账户后重试');
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${request.fromChainId.toString(16)}` }] });
  const actualChainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (actualChainId !== `0x${request.fromChainId.toString(16)}`) throw new Error('钱包没有切换到报价来源网络，已停止签名');
  const revalidatedAccounts = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(revalidatedAccounts) || !revalidatedAccounts.some(value => typeof value === 'string' && value.toLowerCase() === request.fromAddress.toLowerCase())) throw new Error('切换网络后活动账户与报价发送钱包不一致，已停止签名');

  if (route.approvalAddress && !nativeToken(route.fromTokenAddress)) {
    if (!isAddress(route.approvalAddress) || !isAddress(route.fromTokenAddress)) throw new Error('报价缺少可核验的 Token 授权地址，已阻止签名');
    const allowanceData = erc20.encodeFunctionData('allowance', [request.fromAddress, route.approvalAddress]);
    const allowanceRaw = await provider.request({ method: 'eth_call', params: [{ from: request.fromAddress, to: route.fromTokenAddress, data: allowanceData }, 'latest'] });
    let allowance = 0n;
    try { allowance = erc20.decodeFunctionResult('allowance', String(allowanceRaw))[0] as bigint; }
    catch { throw new Error('无法核验现有 Token 授权额度，已阻止签名'); }
    if (allowance < BigInt(request.fromAmount)) {
      if (!confirm(`需要精确授权本次额度 ${request.fromAmount}\nToken：${route.fromTokenAddress}\n授权对象：${route.approvalAddress}\n不会请求无限授权。是否打开钱包确认？`)) throw new Error('用户取消精确授权');
      const data = erc20.encodeFunctionData('approve', [route.approvalAddress, request.fromAmount]);
      const approval = { from: request.fromAddress, to: route.fromTokenAddress, data, value: '0x0' };
      await provider.request({ method: 'eth_estimateGas', params: [approval] });
      const reference = await provider.request({ method: 'eth_sendTransaction', params: [approval] });
      if (typeof reference !== 'string') throw new Error('钱包未返回授权交易编号');
      await waitEvmReceipt(provider, reference);
      return { kind: 'approval', reference };
    }
  }

  const value = transaction.value ?? '0x0';
  const call = { from: request.fromAddress, to: transaction.to, data: transaction.data, value };
  const gas = await provider.request({ method: 'eth_estimateGas', params: [call] });
  if (!confirm(`模拟已通过。\n路线：${route.providerLabel}\n最低到账：${route.toAmountMin ?? '提供方未返回'}\n即将由当前钱包签署跨链交易，是否继续？`)) throw new Error('用户取消跨链签名');
  const reference = await provider.request({ method: 'eth_sendTransaction', params: [{ ...call, gas: typeof gas === 'string' ? gas : transaction.gasLimit }] });
  if (typeof reference !== 'string') throw new Error('钱包未返回跨链交易编号');
  await waitEvmReceipt(provider, reference);
  return { kind: 'bridge', reference };
}

async function executeSolana(request: BridgeQuoteRequest, route: BridgeRoute, provider: SolanaProvider, connection: Pick<Connection, 'getGenesisHash' | 'confirmTransaction'>, confirm: (message: string) => boolean): Promise<BridgeExecution> {
  const transaction = route.transaction;
  if (!transaction || transaction.family !== 'SOL' || transaction.chainId !== request.fromChainId || !transaction.serialized || !transaction.simulated) throw new Error('Solana 交易未完成服务端模拟，已阻止盲签');
  await assertSolanaRpcNetwork(connection, 'mainnet-beta');
  const connected = provider.publicKey?.toString() ? undefined : await provider.connect?.();
  const account = connected?.publicKey?.toString() ?? provider.publicKey?.toString() ?? '';
  if (account !== request.fromAddress) throw new Error('当前 Phantom 账户与报价发送钱包不一致，请切换账户后重试');
  let decoded: VersionedTransaction;
  try { decoded = VersionedTransaction.deserialize(Buffer.from(transaction.serialized, 'base64')); }
  catch { throw new Error('Solana 交易载荷无法解析，已阻止签名'); }
  if (!confirm(`模拟已通过${transaction.unitsConsumed ? `（${transaction.unitsConsumed.toLocaleString()} CU）` : ''}。\n路线：${route.providerLabel}\n最低到账：${route.toAmountMin ?? '提供方未返回'}\n是否使用当前 Phantom 账户签名？`)) throw new Error('用户取消跨链签名');
  const result = await provider.signAndSendTransaction(decoded);
  if (!result?.signature) throw new Error('钱包未返回 Solana 交易签名');
  const confirmation = await connection.confirmTransaction(result.signature, 'confirmed');
  if (confirmation.value.err) throw new Error(`Solana 跨链交易执行失败：${result.signature}`);
  return { kind: 'bridge', reference: result.signature };
}

export async function executeBridgeRoute(request: BridgeQuoteRequest, route: BridgeRoute, options: ExecuteOptions = {}): Promise<BridgeExecution> {
  requireFresh(route, options.now ?? Date.now);
  assertBridgeExecutionEnabled();
  const confirm = options.confirm ?? window.confirm;
  if (route.transaction?.family === 'EVM') {
    const provider = options.evmProvider ?? (await resolveEvmProvider([request.fromAddress])).provider;
    if (!provider) throw new Error('未检测到 EVM 钱包');
    return executeEvm(request, route, provider, confirm);
  }
  const provider = options.solanaProvider ?? getSolanaProvider([request.fromAddress]);
  if (!provider) throw new Error('未检测到 Phantom 钱包');
  const connection = options.solanaConnection ?? new Connection(import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  return executeSolana(request, route, provider, connection, confirm);
}
