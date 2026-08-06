import type { TransferTask } from './batch-transfer/types';

const EVM_SENDER = '0x42bae181b2fbd5cc8f04762770942c719dd4d30a';
const EVM_RECIPIENT = '0x1311897252bd6d7e5705443d9e7c32ee22e73067';
const SOL_SENDER = '7qDtJXnNGWpccPmdVwMUKYuAGGE7uDiXgtVSYxw3eeDL';
const SOL_RECIPIENT = '7kDsBgHa7EfY54bFmQgfhuz2RN7u91UNHkw6dvttaimq';
const TRON_SENDER = 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA';
const TRON_RECIPIENT = 'TQxgyuuj43UrFhYtgkBGNTZtLY4iuvm7CL';
const SUPPORTED_EVM_MAINNETS = new Set(['0x1', '0x38', '0x89', '0x2105', '0xa4b1']);
const DAILY_EXECUTION_LIMIT = 10;

const limits = { EVM: 0.0001, SOL: 0.001, TRON: 1 } as const;

function sameEvm(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

export function assertMainnetCanaryTask(task: TransferTask, network: string) {
  if (task.token) throw new Error('主网灰度首轮仅允许原生币，Token 仍保持关闭');
  const amount = Number(task.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > limits[task.chain]) {
    throw new Error(`超过主网灰度单笔上限：${limits[task.chain]}`);
  }

  if (task.chain === 'EVM') {
    if (!SUPPORTED_EVM_MAINNETS.has(network.toLowerCase())) throw new Error('当前 EVM 主网不在灰度范围');
    if (!sameEvm(task.from, EVM_SENDER) || !sameEvm(task.to, EVM_RECIPIENT)) throw new Error('主网灰度仅允许已审批的 EVM 地址对');
  } else if (task.chain === 'SOL') {
    if (network !== 'mainnet-beta') throw new Error('Solana 主网灰度网络配置错误');
    if (task.from !== SOL_SENDER || task.to !== SOL_RECIPIENT) throw new Error('主网灰度仅允许已审批的 Solana 地址对');
  } else {
    if (!network.includes('api.trongrid.io')) throw new Error('TRON 主网灰度网络配置错误');
    if (task.from !== TRON_SENDER || task.to !== TRON_RECIPIENT) throw new Error('主网灰度仅允许已审批的 TRON 地址对');
  }
}

export function reserveMainnetCanaryExecution(storage: Pick<Storage, 'getItem'|'setItem'> = localStorage, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const key = 'lightning-mainnet-canary-v1';
  let state: { day: string; count: number } = { day, count: 0 };
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '{}');
    if (parsed.day === day && Number.isInteger(parsed.count)) state = parsed;
  } catch {
    // A corrupt local counter fails closed by resetting to the current execution.
  }
  if (state.count >= DAILY_EXECUTION_LIMIT) throw new Error('已达到主网灰度每日 10 笔上限');
  storage.setItem(key, JSON.stringify({ day, count: state.count + 1 }));
}

export const mainnetCanaryLimits = limits;
