import { Interface, JsonRpcProvider, Transaction, formatEther, formatUnits, isAddress, parseUnits } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { assertExecutionPolicy, assertSolanaRpcNetwork } from '../batch-transfer/execution-policy';
import { buildSolanaBatchTransactions } from '../batch-transfer/solana-batch';
import { validateAddress } from '../batch-transfer/validation';
import type { TransferTask } from '../batch-transfer/types';
import type { LocalSignedPayload, LocalTransferDraft, LocalTransferPlan } from './local-transfer-types';

const EVM_RPC = () => import.meta.env.VITE_LOCAL_EVM_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const SOLANA_RPC = () => import.meta.env.VITE_LOCAL_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const TRON_RPC = () => import.meta.env.VITE_LOCAL_TRON_RPC_URL || 'https://nile.trongrid.io';
const MAX_TRON_TOKEN_FEE = 100_000_000;
const PLAN_TTL_MS = 90_000;

function localTronNetwork(rpc: string) {
  let hostname = '';
  try { hostname = new URL(rpc).hostname.toLowerCase(); } catch { throw new Error('TRON 测试网 RPC URL 无效'); }
  if (hostname === 'nile.trongrid.io' || hostname === 'api.nileex.io') return 'TRON Nile';
  if (hostname === 'api.shasta.trongrid.io') return 'TRON Shasta';
  throw new Error('本地钱包签名只允许 TRON Nile 或 Shasta 官方 RPC');
}

function transferTask(draft: LocalTransferDraft): TransferTask {
  return {
    id: draft.walletId,
    row: 2,
    chain: draft.chain,
    from: draft.from,
    to: draft.to,
    amount: draft.amount,
    token: draft.asset.address,
    decimals: draft.asset.address ? draft.asset.decimals : undefined,
    assetKind: draft.asset.address ? 'token' : 'native',
    status: 'pending',
    attempts: 0,
    estimatedFee: '0',
  };
}

function validateDraft(draft: LocalTransferDraft) {
  if (!validateAddress(draft.chain, draft.from) || !validateAddress(draft.chain, draft.to)) throw new Error('发送或接收地址无效');
  if (draft.chain === 'EVM' && draft.asset.address && !isAddress(draft.asset.address)) throw new Error('ERC-20 合约地址无效');
  if (draft.chain !== 'EVM' && draft.asset.address && !validateAddress(draft.chain, draft.asset.address)) throw new Error('Token 合约或 Mint 地址无效');
  if (!Number.isInteger(draft.asset.decimals) || draft.asset.decimals < 0 || draft.asset.decimals > 30) throw new Error('Token decimals 必须为 0–30');
  const amount = parseUnits(draft.amount.trim(), draft.asset.decimals);
  if (amount <= 0n) throw new Error('转账金额必须大于 0');
  return amount;
}

function commonPlan(draft: LocalTransferDraft, network: string, feeLabel: string, signingPayload: LocalTransferPlan['signingPayload']): LocalTransferPlan {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PLAN_TTL_MS).toISOString(),
    network,
    draft,
    feeLabel,
    risk: ['仅测试网', '签名前核对接收地址与金额', '广播后链上交易不可撤销'],
    signingPayload,
  };
}

async function planEvm(draft: LocalTransferDraft) {
  const amount = validateDraft(draft);
  const provider = new JsonRpcProvider(EVM_RPC(), undefined, { staticNetwork: false });
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  assertExecutionPolicy([transferTask(draft)], `0x${chainId.toString(16)}`);
  if (chainId !== 11155111) throw new Error(`EVM RPC 不是 Sepolia（返回 Chain ID ${chainId}），已停止规划`);
  const data = draft.asset.address
    ? new Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [draft.to, amount])
    : undefined;
  const transaction = { from: draft.from, to: draft.asset.address ?? draft.to, value: draft.asset.address ? 0n : amount, ...(data ? { data } : {}) };
  const [nonce, gasLimit, fees] = await Promise.all([
    provider.getTransactionCount(draft.from, 'pending'),
    provider.estimateGas(transaction),
    provider.getFeeData(),
  ]);
  const maxFee = fees.maxFeePerGas ?? fees.gasPrice;
  if (!maxFee) throw new Error('Sepolia RPC 未返回 Gas 价格');
  const signingTransaction: Record<string, string | number> = {
    chainId,
    nonce,
    gasLimit: gasLimit.toString(),
    to: transaction.to,
    value: transaction.value.toString(),
    ...(data ? { data } : {}),
    ...(fees.maxFeePerGas && fees.maxPriorityFeePerGas
      ? { type: 2, maxFeePerGas: fees.maxFeePerGas.toString(), maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString() }
      : { type: 0, gasPrice: maxFee.toString() }),
  };
  return commonPlan(draft, 'Sepolia', `上限 ${formatEther(gasLimit * maxFee)} Sepolia ETH`, { chain: 'EVM', transaction: signingTransaction });
}

function toBase64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}

async function planSolana(draft: LocalTransferDraft) {
  validateDraft(draft);
  const network = 'devnet';
  assertExecutionPolicy([transferTask(draft)], network);
  if (network !== 'devnet') throw new Error('本地钱包签名当前只允许 Solana Devnet');
  const connection = new Connection(SOLANA_RPC(), 'confirmed');
  await assertSolanaRpcNetwork(connection, 'devnet');
  const owner = new PublicKey(draft.from);
  const mintPrograms = new Map<string, PublicKey>();
  if (draft.asset.address) {
    const mint = new PublicKey(draft.asset.address);
    const info = await connection.getAccountInfo(mint, 'confirmed');
    if (!info) throw new Error('Devnet 找不到该 SPL Token Mint');
    mintPrograms.set(draft.asset.address, info.owner);
  }
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = buildSolanaBatchTransactions([transferTask(draft)], owner, latest.blockhash, mintPrograms)[0]!;
  const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
  if (fee.value === null) throw new Error('Solana RPC 未返回手续费估算');
  const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    ...commonPlan(draft, 'Solana Devnet', `${formatUnits(fee.value, 9)} SOL`, { chain: 'SOL', transaction: toBase64(serialized) }),
    confirmation: latest,
  };
}

function latestEnergyPrice(value: string) {
  const latest = value.split(',').at(-1)?.split(':').at(-1);
  const parsed = Number(latest);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 420;
}

async function planTron(draft: LocalTransferDraft) {
  const amount = validateDraft(draft);
  const rpc = TRON_RPC();
  const network = localTronNetwork(rpc);
  assertExecutionPolicy([transferTask(draft)], rpc);
  const { TronWeb } = await import('tronweb');
  const tronWeb = new TronWeb({ fullHost: rpc });
  let transaction: Record<string, unknown>;
  let feeLabel = '预计带宽费用由 Nile 账户资源决定';
  if (draft.asset.address) {
    const parameters = [{ type: 'address', value: draft.to }, { type: 'uint256', value: amount.toString() }];
    const result = await tronWeb.transactionBuilder.triggerSmartContract(
      draft.asset.address,
      'transfer(address,uint256)',
      { callValue: 0, feeLimit: MAX_TRON_TOKEN_FEE },
      parameters,
      draft.from,
    );
    if (!result.result?.result || !result.transaction) throw new Error(result.result?.message ?? result.Error ?? 'Nile 无法构建 TRC-20 交易');
    transaction = result.transaction as unknown as Record<string, unknown>;
    try {
      const [energy, prices] = await Promise.all([
        tronWeb.transactionBuilder.estimateEnergy(draft.asset.address, 'transfer(address,uint256)', { callValue: 0 }, parameters, draft.from),
        tronWeb.trx.getEnergyPrices(),
      ]);
      feeLabel = `预计最多 ${formatUnits(BigInt(energy.energy_required) * BigInt(latestEnergyPrice(prices)), 6)} TRX（feeLimit 100 TRX）`;
    } catch { feeLabel = 'feeLimit 上限 100 TRX；实际按 Nile 资源消耗'; }
  } else {
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TRX 金额超过安全整数范围');
    transaction = await tronWeb.transactionBuilder.sendTrx(draft.to, Number(amount), draft.from) as unknown as Record<string, unknown>;
  }
  return commonPlan(draft, network, feeLabel, { chain: 'TRON', transaction });
}

export async function planLocalTransfer(draft: LocalTransferDraft) {
  if (draft.chain === 'EVM') return planEvm(draft);
  if (draft.chain === 'SOL') return planSolana(draft);
  return planTron(draft);
}

function assertFresh(plan: LocalTransferPlan, signed: LocalSignedPayload) {
  if (Date.now() > Date.parse(plan.expiresAt)) throw new Error('交易规划已过期，请重新估算；已签名数据未广播');
  if (signed.chain !== plan.draft.chain) throw new Error('签名结果链类型不匹配，未广播');
}

async function broadcastEvm(plan: LocalTransferPlan, signed: Extract<LocalSignedPayload, { chain: 'EVM' }>) {
  const provider = new JsonRpcProvider(EVM_RPC(), undefined, { staticNetwork: false });
  const network = await provider.getNetwork();
  if (network.chainId !== 11155111n) throw new Error('EVM RPC 已离开 Sepolia，未广播');
  const parsed = Transaction.from(signed.signedTransaction);
  if (parsed.from?.toLowerCase() !== plan.draft.from.toLowerCase() || Number(parsed.chainId) !== 11155111) throw new Error('签名交易与规划不匹配，未广播');
  const response = await provider.broadcastTransaction(signed.signedTransaction);
  try {
    const receipt = await Promise.race([response.wait(1), new Promise<null>(resolve => window.setTimeout(() => resolve(null), 45_000))]);
    if (receipt?.status === 0) throw new Error(`Sepolia 交易执行失败：${response.hash}`);
    return { hash: response.hash, state: receipt ? 'confirmed' as const : 'submitted' as const };
  } catch (cause) {
    if (cause instanceof Error && /执行失败/.test(cause.message)) throw cause;
    return { hash: response.hash, state: 'submitted' as const };
  }
}

async function broadcastSolana(plan: LocalTransferPlan, signed: Extract<LocalSignedPayload, { chain: 'SOL' }>) {
  const connection = new Connection(SOLANA_RPC(), 'confirmed');
  await assertSolanaRpcNetwork(connection, 'devnet');
  const transaction = (await import('@solana/web3.js')).Transaction.from(new Uint8Array(signed.signedTransaction));
  if (transaction.feePayer?.toBase58() !== plan.draft.from || !transaction.verifySignatures()) throw new Error('Solana 签名与规划不匹配，未广播');
  const signature = await connection.sendRawTransaction(new Uint8Array(signed.signedTransaction), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 });
  const confirmation = plan.confirmation;
  if (!confirmation) return { hash: signature, state: 'submitted' as const };
  try {
    const result = await Promise.race([
      connection.confirmTransaction({ signature, ...confirmation }, 'confirmed'),
      new Promise<null>(resolve => window.setTimeout(() => resolve(null), 45_000)),
    ]);
    if (result?.value.err) throw new Error(`Solana Devnet 交易执行失败：${signature}`);
    return { hash: signature, state: result ? 'confirmed' as const : 'submitted' as const };
  } catch (cause) {
    if (cause instanceof Error && /执行失败/.test(cause.message)) throw cause;
    return { hash: signature, state: 'submitted' as const };
  }
}

async function broadcastTron(plan: LocalTransferPlan, signed: Extract<LocalSignedPayload, { chain: 'TRON' }>) {
  const rpc = TRON_RPC();
  localTronNetwork(rpc);
  assertExecutionPolicy([transferTask(plan.draft)], rpc);
  const { TronWeb } = await import('tronweb');
  const tronWeb = new TronWeb({ fullHost: rpc });
  const result = await tronWeb.trx.sendRawTransaction(signed.signedTransaction as never);
  if (!result.result) throw new Error(String(result.message ?? result.code ?? 'TRON Nile 广播失败'));
  const transaction = signed.signedTransaction as { txID?: string };
  const hash = String(result.txid ?? transaction.txID ?? '');
  if (!hash) throw new Error('TRON Nile 未返回交易 ID');
  for (let attempt = 0; attempt < 20; attempt++) {
    const info = await tronWeb.trx.getTransactionInfo(hash).catch(() => null);
    if (info?.id) {
      if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`TRON Nile 交易执行失败：${hash}`);
      return { hash, state: 'confirmed' as const };
    }
    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }
  return { hash, state: 'submitted' as const };
}

export async function broadcastLocalTransfer(plan: LocalTransferPlan, signed: LocalSignedPayload) {
  assertFresh(plan, signed);
  if (signed.chain === 'EVM') return broadcastEvm(plan, signed);
  if (signed.chain === 'SOL') return broadcastSolana(plan, signed);
  return broadcastTron(plan, signed);
}
