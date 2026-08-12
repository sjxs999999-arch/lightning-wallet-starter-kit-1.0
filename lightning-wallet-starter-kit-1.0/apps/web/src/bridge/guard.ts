import { isAddress } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { BRIDGE_CHAINS, type BridgeQuoteRequest, type BridgeRoute } from './types';

const RAW_AMOUNT = /^\d{1,100}$/;
const TOKEN = /^(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9]{1,11})$/;

export function bridgeAddressValid(chainId: number, value: string) {
  const family = BRIDGE_CHAINS.find(chain => chain.id === chainId)?.family;
  if (family === 'EVM') return isAddress(value);
  if (family === 'SOL') {
    try { return new PublicKey(value).toBase58() === value; }
    catch { return false; }
  }
  return false;
}

export function validateBridgeRequest(input: BridgeQuoteRequest) {
  const from = BRIDGE_CHAINS.find(chain => chain.id === input.fromChainId);
  const to = BRIDGE_CHAINS.find(chain => chain.id === input.toChainId);
  if (!from || !to || from.id === to.id) throw new Error('请选择不同的来源链和目标链');
  if (!TOKEN.test(input.fromToken) || !TOKEN.test(input.toToken)) throw new Error('Token 符号或地址格式无效');
  if (!RAW_AMOUNT.test(input.fromAmount) || BigInt(input.fromAmount) <= 0n) throw new Error('请输入最小单位的正整数金额');
  if (!bridgeAddressValid(from.id, input.fromAddress) || !bridgeAddressValid(to.id, input.toAddress)) throw new Error('发送或接收地址与所选网络不匹配');
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 300) throw new Error('跨链滑点必须在 0.01%–3% 之间');
  return input;
}

export function routeRisk(route: BridgeRoute) {
  const warnings = [...route.warnings];
  if (route.priceImpactPct !== undefined && route.priceImpactPct > 1) warnings.push(`价格影响 ${route.priceImpactPct.toFixed(2)}%`);
  if (route.kind === 'official' && !route.transaction) warnings.push('费用与到账时间需在官方桥连接钱包后确认');
  if (!route.toAmountMin && route.kind === 'aggregator') warnings.push('路线未提供最低到账保护');
  return warnings;
}

export function formatDuration(seconds?: number) {
  if (!seconds || seconds < 1) return '待提供方确认';
  if (seconds < 60) return `约 ${seconds} 秒`;
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`;
  if (seconds < 172800) return `约 ${(seconds / 3600).toFixed(1)} 小时`;
  return `约 ${Math.ceil(seconds / 86400)} 天`;
}
