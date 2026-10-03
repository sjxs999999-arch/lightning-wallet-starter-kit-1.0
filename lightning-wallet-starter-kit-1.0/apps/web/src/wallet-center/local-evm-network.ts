import { Transaction } from 'ethers';
import { PORTFOLIO_NETWORKS, type PortfolioNetworkId } from './portfolio-networks';
import { assertExecutionPolicy, executionPolicyConfig } from '../batch-transfer/execution-policy';
import type { TransferTask } from '../batch-transfer/types';
import type { LocalTransferPlan } from './local-transfer-types';

export function localEvmNetwork(id: PortfolioNetworkId = 'sepolia') {
  const network = PORTFOLIO_NETWORKS.find(item => item.id === id && item.chain === 'EVM');
  if (!network?.evmChainId || !network.rpcUrls[0]) throw new Error('请选择受支持的 EVM 转账网络');
  return network;
}

export function assertEvmPlanAndSignature(plan: LocalTransferPlan, signed: Transaction) {
  if (plan.signingPayload.chain !== 'EVM' || plan.draft.chain !== 'EVM') throw new Error('EVM 交易规划类型不匹配，未广播');
  const expected = plan.signingPayload.transaction;
  const network = localEvmNetwork(plan.draft.networkId);
  const equalAddress = (left: string | null | undefined, right: string | number | undefined) => typeof right === 'string' && left?.toLowerCase() === right.toLowerCase();
  if (!equalAddress(signed.from, plan.draft.from)
    || signed.chainId !== BigInt(network.evmChainId!)
    || signed.chainId !== BigInt(expected.chainId!)
    || !equalAddress(signed.to, expected.to)
    || signed.value !== BigInt(expected.value!)
    || signed.data.toLowerCase() !== String(expected.data ?? '0x').toLowerCase()
    || signed.nonce !== Number(expected.nonce)
    || signed.gasLimit !== BigInt(expected.gasLimit!)
    || signed.type !== Number(expected.type)) throw new Error('签名交易与确认的网络、地址、金额或费用不匹配，未广播');
  for (const field of ['gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const) {
    const actual = signed[field];
    if (expected[field] === undefined ? actual !== null : actual !== BigInt(expected[field]!)) throw new Error('签名交易手续费与规划不匹配，未广播');
  }
  if ((signed.accessList?.length ?? 0) !== 0 || (signed.authorizationList?.length ?? 0) !== 0) throw new Error('签名交易包含未确认的附加授权，未广播');
}

export function localEvmExplorer(network: string) {
  const explorers: Record<string, string> = {
    'Sepolia': 'https://sepolia.etherscan.io',
    'Ethereum Sepolia': 'https://sepolia.etherscan.io',
    'Ethereum Mainnet': 'https://etherscan.io',
    'BNB Smart Chain': 'https://bscscan.com',
    'Polygon': 'https://polygonscan.com',
    'Base': 'https://basescan.org',
    'Arbitrum One': 'https://arbiscan.io',
  };
  return explorers[network];
}

// Single local-wallet EVM transfers have an explicit rollout flag. Other modules
// retain the global execution policy and their own acceptance gates.
export function localEvmMainnetEnabled() {
  return import.meta.env.VITE_LOCAL_EVM_MAINNET_ENABLED === 'true' || executionPolicyConfig().mainnetEnabled;
}

export function assertLocalEvmExecutionPolicy(task: TransferTask, network: string) {
  if (task.chain !== 'EVM') throw new Error('本地主网发送仅适用于 EVM');
  assertExecutionPolicy([task], network, { ...executionPolicyConfig(), mainnetEnabled: localEvmMainnetEnabled() });
}
