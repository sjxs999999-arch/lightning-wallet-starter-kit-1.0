import { BrowserProvider, ContractFactory, formatEther } from 'ethers';
import { Buffer } from 'buffer';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import artifact from './artifacts/LightningFixedSupplyToken.json';
import tronArtifact from './artifacts/LightningFixedSupplyToken.tron.json';
import { getSolanaProvider } from '../batch-transfer/executor';
import type { LaunchDraft } from './types';

type RequestProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type TronWeb = {
  defaultAddress?: { base58?: string };
  fullNode?: { host?: string };
  address?: { fromHex(value: string): string };
  transactionBuilder: { createSmartContract(options: Record<string, unknown>, issuerAddress: string): Promise<Record<string, unknown> & { txID?: string; contract_address?: string }> };
  trx: {
    sign(transaction: unknown): Promise<Record<string, unknown> & { txID?: string }>;
    sendRawTransaction(transaction: unknown): Promise<{ result?: boolean; txid?: string; code?: string; message?: string }>;
    getTransactionInfo(txId: string): Promise<{ id?: string; receipt?: { result?: string }; contract_address?: string }>;
  };
};

export interface DeploymentEstimate {
  chain: LaunchDraft['chain'];
  network: string;
  walletAddress: string;
  feeLabel: string;
  feeDetail: string;
  exact: boolean;
}

export interface DeploymentResult {
  chain: LaunchDraft['chain'];
  network: string;
  walletAddress: string;
  contractAddress: string;
  transactionHash: string;
  status: 'confirmed';
  explorerUrl: string;
}

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const MINT_SIZE = 82;
const SOLANA_DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const unitAmount = (draft: LaunchDraft) => {
  if (!/^\d+$/.test(draft.supply) || BigInt(draft.supply) < 1n) throw new Error('总供应量必须是正整数');
  const maximumDecimals = draft.chain === 'SOL' ? 9 : 18;
  if (!Number.isInteger(draft.decimals) || draft.decimals < 0 || draft.decimals > maximumDecimals) throw new Error(`Decimals 必须是 0-${maximumDecimals} 的整数`);
  return BigInt(draft.supply) * 10n ** BigInt(draft.decimals);
};
const evmProvider = () => {
  const root = window as typeof window & { okxwallet?: RequestProvider; rabby?: RequestProvider; ethereum?: RequestProvider };
  return root.okxwallet ?? root.rabby ?? root.ethereum;
};
const deployArguments = (draft: LaunchDraft) => [draft.name, draft.symbol, draft.decimals, unitAmount(draft)] as const;

async function requireSepolia() {
  const provider = evmProvider();
  if (!provider) throw new Error('未检测到 MetaMask、OKX Wallet 或 Rabby');
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts[0]) throw new Error('EVM 钱包未返回活动账户');
  let chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (chainId !== '0xaa36a7') {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
    chainId = String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  }
  if (chainId !== '0xaa36a7') throw new Error('钱包没有切换到 Sepolia，已停止部署');
  return { provider, address: accounts[0] };
}

async function prepareEvm(draft: LaunchDraft): Promise<DeploymentEstimate> {
  const active = await requireSepolia();
  const browserProvider = new BrowserProvider(active.provider);
  const signer = await browserProvider.getSigner();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const transaction = await factory.getDeployTransaction(...deployArguments(draft));
  const gas = await signer.estimateGas(transaction);
  const fees = await browserProvider.getFeeData();
  const wei = gas * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n);
  return { chain: 'EVM', network: 'Sepolia', walletAddress: active.address, feeLabel: `${formatEther(wei)} ETH`, feeDetail: `Gas 上限估算 ${gas.toString()}；实际费用由钱包确认页决定`, exact: false };
}

async function deployEvm(draft: LaunchDraft): Promise<DeploymentResult> {
  const active = await requireSepolia();
  const signer = await new BrowserProvider(active.provider).getSigner();
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...deployArguments(draft));
  const transaction = contract.deploymentTransaction();
  if (!transaction) throw new Error('钱包未返回 EVM 部署交易');
  const receipt = await transaction.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`Sepolia 合约部署失败：${transaction.hash}`);
  const address = await contract.getAddress();
  return { chain: 'EVM', network: 'Sepolia', walletAddress: active.address, contractAddress: address, transactionHash: transaction.hash, status: 'confirmed', explorerUrl: `https://sepolia.etherscan.io/address/${address}` };
}

const solanaConnection = () => new Connection(import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com', 'confirmed');
async function assertSolanaDevnet(connection: Connection) {
  if (await connection.getGenesisHash() !== SOLANA_DEVNET_GENESIS) throw new Error('Solana RPC 不是 Devnet，已停止部署');
}
async function requireSolana() {
  const provider = getSolanaProvider();
  if (!provider) throw new Error('未检测到 OKX、Phantom、Backpack 或 Solflare');
  const connected = provider.connect ? await provider.connect() : undefined;
  const address = connected?.publicKey?.toString() ?? provider.publicKey?.toString();
  if (!address) throw new Error('Solana 钱包未返回活动账户');
  return { provider, address, owner: new PublicKey(address) };
}

export function createFixedSupplySolanaInstructions(owner: PublicKey, mint: PublicKey, amount: bigint, decimals: number) {
  const ata = PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
  const initializeData = Buffer.concat([Buffer.from([20, decimals]), owner.toBuffer(), Buffer.from([0])]);
  const amountData = Buffer.alloc(9); amountData[0] = 7; amountData.writeBigUInt64LE(amount, 1);
  return { ata, instructions: [
    new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: mint, isSigner: false, isWritable: true }], data: initializeData }),
    new TransactionInstruction({ programId: ASSOCIATED_TOKEN_PROGRAM_ID, keys: [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }], data: Buffer.alloc(0) }),
    new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data: amountData }),
    new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data: Buffer.from([6, 0, 0]) }),
  ] };
}

async function buildSolanaMint(draft: LaunchDraft, owner: PublicKey, connection: Connection) {
  const amount = unitAmount(draft);
  if (amount > 18_446_744_073_709_551_615n) throw new Error('SPL Token 总供应量超过 u64 上限');
  const mint = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE, 'confirmed');
  const token = createFixedSupplySolanaInstructions(owner, mint.publicKey, amount, draft.decimals);
  const latest = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer: owner, recentBlockhash: latest.blockhash }).add(
    SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: mint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    ...token.instructions,
  );
  return { mint, rent, latest, transaction };
}

async function prepareSolana(draft: LaunchDraft): Promise<DeploymentEstimate> {
  const active = await requireSolana();
  const connection = solanaConnection();
  await assertSolanaDevnet(connection);
  const prepared = await buildSolanaMint(draft, active.owner, connection);
  try {
    const fee = (await connection.getFeeForMessage(prepared.transaction.compileMessage(), 'confirmed')).value ?? 0;
    const total = prepared.rent + fee;
    return { chain: 'SOL', network: 'Solana Devnet', walletAddress: active.address, feeLabel: `${(total / 1_000_000_000).toFixed(9)} SOL`, feeDetail: `包含 Mint 租金 ${prepared.rent} lamports 与当前交易费 ${fee} lamports`, exact: false };
  } finally { prepared.mint.secretKey.fill(0); }
}

async function deploySolana(draft: LaunchDraft): Promise<DeploymentResult> {
  const active = await requireSolana();
  const connection = solanaConnection();
  await assertSolanaDevnet(connection);
  const prepared = await buildSolanaMint(draft, active.owner, connection);
  const mintAddress = prepared.mint.publicKey.toBase58();
  try {
    prepared.transaction.partialSign(prepared.mint);
    const { signature } = await active.provider.signAndSendTransaction(prepared.transaction);
    const confirmation = await connection.confirmTransaction({ signature, ...prepared.latest }, 'confirmed');
    if (confirmation.value.err) throw new Error(`Solana Devnet Mint 创建失败：${signature}`);
    return { chain: 'SOL', network: 'Solana Devnet', walletAddress: active.address, contractAddress: mintAddress, transactionHash: signature, status: 'confirmed', explorerUrl: `https://explorer.solana.com/address/${mintAddress}?cluster=devnet` };
  } finally { prepared.mint.secretKey.fill(0); }
}

function getTronWeb(): TronWeb {
  const root = window as typeof window & { okxwallet?: { tronLink?: { tronWeb?: TronWeb } }; tronWeb?: TronWeb };
  const tronWeb = root.okxwallet?.tronLink?.tronWeb ?? root.tronWeb;
  if (!tronWeb) throw new Error('未检测到 OKX Wallet 或 TronLink');
  let hostname = '';
  try { hostname = new URL(String(tronWeb.fullNode?.host ?? '')).hostname.toLowerCase(); } catch { /* rejected below */ }
  if (!['nile.trongrid.io', 'api.nileex.io'].includes(hostname)) throw new Error('请先将 TRON 钱包切换到官方 Nile 测试网 RPC');
  if (!tronWeb.defaultAddress?.base58) throw new Error('TRON 钱包未返回活动账户');
  return tronWeb;
}

const TRON_FEE_LIMIT = 150_000_000;
async function prepareTron(): Promise<DeploymentEstimate> {
  const tronWeb = getTronWeb();
  return { chain: 'TRON', network: 'TRON Nile', walletAddress: tronWeb.defaultAddress!.base58!, feeLabel: '最高 150 TRX', feeDetail: '这是 feeLimit 安全上限，不是固定扣费；实际资源消耗以钱包确认页和链上回执为准', exact: false };
}

async function deployTron(draft: LaunchDraft): Promise<DeploymentResult> {
  const tronWeb = getTronWeb();
  const issuer = tronWeb.defaultAddress!.base58!;
  const unsigned = await tronWeb.transactionBuilder.createSmartContract({
    abi: tronArtifact.abi,
    bytecode: tronArtifact.bytecode,
    name: `${draft.symbol}_LightningFixedSupplyToken`,
    feeLimit: TRON_FEE_LIMIT,
    callValue: 0,
    userFeePercentage: 100,
    originEnergyLimit: 10_000_000,
    parameters: [draft.name, draft.symbol, draft.decimals, unitAmount(draft).toString()],
  }, issuer);
  const signed = await tronWeb.trx.sign(unsigned);
  const broadcast = await tronWeb.trx.sendRawTransaction(signed);
  if (!broadcast.result) throw new Error(broadcast.message || broadcast.code || 'TRON 钱包未广播部署交易');
  const txId = String(broadcast.txid ?? signed.txID ?? unsigned.txID ?? '');
  if (!txId) throw new Error('TRON 钱包未返回部署交易 ID');
  let receipt: Awaited<ReturnType<TronWeb['trx']['getTransactionInfo']>> | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    receipt = await tronWeb.trx.getTransactionInfo(txId).catch(() => null);
    if (receipt?.id) break;
    await sleep(1500);
  }
  if (!receipt?.id) throw new Error(`TRON Nile 确认超时：${txId}`);
  if (receipt.receipt?.result && receipt.receipt.result !== 'SUCCESS') throw new Error(`TRON Nile 合约部署失败：${txId}`);
  const hexAddress = String(receipt.contract_address ?? unsigned.contract_address ?? '');
  const address = hexAddress && tronWeb.address?.fromHex ? tronWeb.address.fromHex(hexAddress) : hexAddress;
  if (!address) throw new Error(`交易已确认，但未返回 TRON 合约地址：${txId}`);
  return { chain: 'TRON', network: 'TRON Nile', walletAddress: issuer, contractAddress: address, transactionHash: txId, status: 'confirmed', explorerUrl: `https://nile.tronscan.org/#/contract/${address}` };
}

export async function prepareLaunchDeployment(draft: LaunchDraft): Promise<DeploymentEstimate> {
  if (draft.dryRun) throw new Error('Dry Run 已开启，不会连接钱包或构造部署交易');
  if (draft.chain === 'EVM') return prepareEvm(draft);
  if (draft.chain === 'SOL') return prepareSolana(draft);
  return prepareTron();
}

export async function deployLaunchToken(draft: LaunchDraft): Promise<DeploymentResult> {
  if (draft.dryRun) throw new Error('Dry Run 已开启，拒绝广播');
  if (draft.chain === 'EVM') return deployEvm(draft);
  if (draft.chain === 'SOL') return deploySolana(draft);
  return deployTron(draft);
}
