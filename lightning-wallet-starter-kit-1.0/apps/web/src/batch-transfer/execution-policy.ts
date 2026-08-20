import type { TransferTask } from './types';

const EVM_MAINNETS = new Set(['0x1', '0x38', '0x89', '0x2105', '0xa4b1']);
const EVM_TESTNETS = new Set(['0xaa36a7']);
const TRON_MAINNET_HOSTS = new Set(['api.trongrid.io']);
const TRON_TESTNET_HOSTS = new Set(['nile.trongrid.io', 'api.nileex.io', 'api.shasta.trongrid.io']);
const SOLANA_GENESIS: Record<string, string> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

export type ExecutionPolicyConfig = {
  mainnetEnabled: boolean;
  maxBatchCount: number;
};

export function executionPolicyConfig(): ExecutionPolicyConfig {
  const configured = Number(import.meta.env.VITE_MAINNET_MAX_BATCH_COUNT ?? 1000);
  return {
    mainnetEnabled: import.meta.env.VITE_MAINNET_EXECUTION_ENABLED === 'true',
    maxBatchCount: Number.isInteger(configured) && configured > 0 ? Math.min(configured, 1000) : 1000,
  };
}

export function isMainnet(chain: TransferTask['chain'], network: string): boolean {
  const value = network.trim().toLowerCase();
  if (chain === 'EVM') return EVM_MAINNETS.has(value);
  if (chain === 'SOL') return value === 'mainnet-beta';
  return TRON_MAINNET_HOSTS.has(tronHostname(value));
}

function tronHostname(network: string): string {
  try { return new URL(network.includes('://') ? network : `https://${network}`).hostname.toLowerCase(); }
  catch { return ''; }
}

export function assertSupportedNetwork(chain: TransferTask['chain'], network: string): void {
  const value = network.trim().toLowerCase();
  if (chain === 'EVM' && !EVM_MAINNETS.has(value) && !EVM_TESTNETS.has(value)) throw new Error(`当前 EVM 网络 ${network} 未启用`);
  if (chain === 'SOL' && !['mainnet-beta', 'devnet', 'testnet'].includes(value)) throw new Error(`当前 Solana 网络 ${network} 未启用`);
  if (chain === 'TRON' && !TRON_MAINNET_HOSTS.has(tronHostname(value)) && !TRON_TESTNET_HOSTS.has(tronHostname(value))) throw new Error('当前 TRON RPC 不是受支持的官方网络，已停止签名');
}

export async function assertSolanaRpcNetwork(connection: { getGenesisHash(): Promise<string> }, network: string): Promise<void> {
  const expected = SOLANA_GENESIS[network.trim().toLowerCase()];
  if (!expected) throw new Error(`当前 Solana 网络 ${network} 未启用`);
  const actual = await connection.getGenesisHash();
  if (actual !== expected) throw new Error(`Solana RPC Genesis 与 ${network} 不匹配，已停止签名`);
}

export function assertExecutionPolicy(tasks: TransferTask[], network: string, config = executionPolicyConfig()): void {
  if (!tasks.length) throw new Error('没有可执行交易');
  if (tasks.length > config.maxBatchCount) throw new Error(`批量任务超过当前上限：${config.maxBatchCount}`);
  const chain = tasks[0]!.chain;
  assertSupportedNetwork(chain, network);
  if (tasks.some(task => task.chain !== chain)) throw new Error('一个批次不能混合多条链');
  const sender = tasks[0]!.from.toLowerCase();
  if (tasks.some(task => task.from.toLowerCase() !== sender)) throw new Error('当前批量签名仅支持同一发送账户；多对多请按发送账户拆分');
  const identifiers = new Set<string>();
  for (const task of tasks) {
    if (task.token && task.decimals === undefined) throw new Error(`第 ${task.row} 行 Token 必须明确填写 decimals`);
    const identifier = `${task.chain}|${task.from}|${task.to}|${task.token ?? 'native'}|${task.amount}`.toLowerCase();
    if (identifiers.has(identifier)) throw new Error(`第 ${task.row} 行存在重复交易，已停止签名`);
    identifiers.add(identifier);
  }
  if (isMainnet(chain, network) && !config.mainnetEnabled) throw new Error('主网真实执行尚未由部署环境启用；Dry Run 和测试网不受影响');
}

export const supportedEvmMainnets = [...EVM_MAINNETS];
