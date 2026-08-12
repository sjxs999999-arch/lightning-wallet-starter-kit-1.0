import bs58 from 'bs58';
import { z } from 'zod';

const SOLANA_CHAIN_ID = 1_151_111_081_099_710;
const CHAIN_IDS = [1, 10, 137, 8453, 42161, SOLANA_CHAIN_ID] as const;
const publicIdentifier = z.string().min(2).max(128).regex(/^(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9]{1,11})$/);
const evmAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
const solanaAddress = (value: string) => {
  try { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && bs58.decode(value).length === 32; }
  catch { return false; }
};

export const bridgeQuoteSchema = z.object({
  fromChainId: z.number().int().refine(value => CHAIN_IDS.includes(value as typeof CHAIN_IDS[number])),
  toChainId: z.number().int().refine(value => CHAIN_IDS.includes(value as typeof CHAIN_IDS[number])),
  fromToken: publicIdentifier,
  toToken: publicIdentifier,
  fromAmount: z.string().regex(/^\d{1,100}$/).refine(value => BigInt(value) > 0n),
  fromAddress: z.string().min(32).max(64),
  toAddress: z.string().min(32).max(64),
  slippageBps: z.number().int().min(1).max(300),
  order: z.enum(['CHEAPEST', 'FASTEST']),
}).strict().superRefine((input, context) => {
  if (input.fromChainId === input.toChainId) context.addIssue({ code: 'custom', path: ['toChainId'], message: 'Source and destination must differ' });
  if (!(input.fromChainId === SOLANA_CHAIN_ID ? solanaAddress(input.fromAddress) : evmAddress(input.fromAddress))) context.addIssue({ code: 'custom', path: ['fromAddress'], message: 'Source address family does not match chain' });
  if (!(input.toChainId === SOLANA_CHAIN_ID ? solanaAddress(input.toAddress) : evmAddress(input.toAddress))) context.addIssue({ code: 'custom', path: ['toAddress'], message: 'Destination address family does not match chain' });
});

type BridgeInput = z.infer<typeof bridgeQuoteSchema>;
type LiFiCost = { amountUSD?: string };
type LiFiQuote = {
  id?: string;
  tool?: string;
  toolDetails?: { name?: string };
  action?: { fromToken?: { address?: string } };
  estimate?: { fromAmount?: string; toAmount?: string; toAmountMin?: string; executionDuration?: number; approvalAddress?: string; feeCosts?: LiFiCost[]; gasCosts?: LiFiCost[]; fromAmountUSD?: string; toAmountUSD?: string };
  transactionRequest?: { to?: string; data?: string; value?: string; gas?: string; gasLimit?: string };
  includedSteps?: { tool?: string }[];
};
type PublicBridgeRoute = ReturnType<typeof normalizeLiFi> | { id: string; provider: string; providerLabel: string; kind: 'official'; fromAmount: string; steps: string[]; officialUrl: string; warnings: string[] };

const officialBridges = [
  { chainId: 42161, provider: 'arbitrum-official', providerLabel: 'Arbitrum 官方桥', officialUrl: 'https://portal.arbitrum.io/bridge', warnings: ['费用、到账时间与提现等待期以官方桥连接钱包后的实时结果为准'] },
  { chainId: 10, provider: 'optimism-official', providerLabel: 'Optimism 官方桥', officialUrl: 'https://app.optimism.io/bridge', warnings: ['提回 Ethereum 可能包含标准桥挑战等待期，请在官方桥复核'] },
  { chainId: 8453, provider: 'base-official', providerLabel: 'Base 官方桥', officialUrl: 'https://bridge.base.org', warnings: ['提回 Ethereum 可能包含标准桥挑战等待期，请在官方桥复核'] },
  { chainId: 137, provider: 'polygon-official', providerLabel: 'Polygon Portal', officialUrl: 'https://portal.polygon.technology/bridge', warnings: ['提现方向可能需要额外 claim；费用与时间由官方入口确认'] },
] as const;
const bridgeTools = [{ key: '', label: 'LI.FI 最优路线' }, { key: 'across', label: 'Across' }, { key: 'stargateV2', label: 'Stargate' }, { key: 'mayanWH', label: 'Wormhole / Mayan' }] as const;

const sumUsd = (costs: LiFiCost[] | undefined) => costs?.reduce((sum, item) => sum + (Number(item.amountUSD) || 0), 0) ?? 0;
const hexQuantity = (value: string | undefined) => {
  if (!value || !/^(?:0x[0-9a-f]+|\d+)$/i.test(value)) return undefined;
  return `0x${BigInt(value).toString(16)}`;
};

function normalizeLiFi(raw: LiFiQuote, input: BridgeInput, fallbackLabel: string) {
  const estimate = raw.estimate ?? {}, provider = raw.tool ?? 'lifi', included = raw.includedSteps ?? [];
  const steps = [provider, ...included.map(item => item.tool)].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const feeUsd = sumUsd(estimate.feeCosts), gasCostUsd = sumUsd(estimate.gasCosts), fromUsd = Number(estimate.fromAmountUSD), toUsd = Number(estimate.toAmountUSD);
  const priceImpactPct = Number.isFinite(fromUsd) && fromUsd > 0 && Number.isFinite(toUsd) ? Math.max(0, (1 - toUsd / fromUsd) * 100) : undefined;
  const request = raw.transactionRequest;
  let transaction: { family: 'EVM' | 'SOL'; chainId: number; to?: string; data?: string; value?: string; gasLimit?: string; serialized?: string; simulated?: boolean; unitsConsumed?: number } | undefined;
  if (input.fromChainId === SOLANA_CHAIN_ID && typeof request?.data === 'string' && request.data.length >= 20 && request.data.length <= 250_000) transaction = { family: 'SOL', chainId: input.fromChainId, serialized: request.data };
  else if (input.fromChainId !== SOLANA_CHAIN_ID && request?.to && evmAddress(request.to) && typeof request.data === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(request.data) && request.data.length <= 200_002) transaction = { family: 'EVM', chainId: input.fromChainId, to: request.to, data: request.data, value: hexQuantity(request.value) ?? '0x0', gasLimit: hexQuantity(request.gasLimit ?? request.gas) };
  const fromTokenAddress = raw.action?.fromToken?.address;
  return {
    id: `${provider}:${raw.id ?? crypto.randomUUID()}`,
    provider,
    providerLabel: raw.toolDetails?.name?.trim() || fallbackLabel,
    kind: 'aggregator' as const,
    fromAmount: estimate.fromAmount ?? input.fromAmount,
    toAmount: estimate.toAmount,
    toAmountMin: estimate.toAmountMin,
    feeUsd: feeUsd > 0 ? feeUsd.toFixed(4) : undefined,
    gasCostUsd: gasCostUsd > 0 ? gasCostUsd.toFixed(4) : undefined,
    durationSeconds: Number(estimate.executionDuration) > 0 ? Number(estimate.executionDuration) : undefined,
    priceImpactPct,
    steps,
    approvalAddress: estimate.approvalAddress && evmAddress(estimate.approvalAddress) ? estimate.approvalAddress : undefined,
    fromTokenAddress: fromTokenAddress && (evmAddress(fromTokenAddress) || solanaAddress(fromTokenAddress)) ? fromTokenAddress : undefined,
    transaction,
    warnings: ['聚合报价为限时结果；签名前必须重新核对钱包中的链、收款地址、金额与授权额度'],
    expiresAt: new Date(Date.now() + 55_000).toISOString(),
  };
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({})) as LiFiQuote & { message?: string; result?: { value?: { err?: unknown; unitsConsumed?: unknown } } };
    if (!response.ok) throw new Error(body.message ?? `LI.FI HTTP ${response.status}`);
    return body;
  } finally { clearTimeout(timer); }
}

async function quote(input: BridgeInput, tool: typeof bridgeTools[number]) {
  const params = new URLSearchParams({ fromChain: String(input.fromChainId), toChain: String(input.toChainId), fromToken: input.fromToken, toToken: input.toToken, fromAmount: input.fromAmount, fromAddress: input.fromAddress, toAddress: input.toAddress, slippage: String(input.slippageBps / 10_000), order: input.order, integrator: 'lightning-wallet' });
  if (tool.key) params.set('allowBridges', tool.key);
  const headers = { accept: 'application/json', ...(process.env.LIFI_API_KEY ? { 'x-lifi-api-key': process.env.LIFI_API_KEY } : {}) };
  const route = normalizeLiFi(await fetchJson(`https://li.quest/v1/quote?${params}`, { headers }), input, tool.label);
  if (route.transaction?.family === 'SOL') {
    const simulation = await fetchJson(process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: [route.transaction.serialized, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }] }) }, 12_000);
    const value = simulation.result?.value;
    if (!value || value.err) throw new Error('BRIDGE_SIMULATION_FAILED');
    route.transaction.simulated = true;
    route.transaction.unitsConsumed = Number(value.unitsConsumed) || undefined;
  }
  return route;
}

export async function fetchBridgeRoutes(raw: unknown) {
  const input = bridgeQuoteSchema.parse(raw);
  const tools = bridgeTools.filter(item => item.key !== 'mayanWH' || input.fromChainId === SOLANA_CHAIN_ID || input.toChainId === SOLANA_CHAIN_ID);
  const settled = await Promise.allSettled(tools.map(item => quote(input, item)));
  const routes: PublicBridgeRoute[] = settled.filter((item): item is PromiseFulfilledResult<ReturnType<typeof normalizeLiFi>> => item.status === 'fulfilled').map(item => item.value);
  const deduped = routes.filter((route, index, values) => values.findIndex(other => other.provider === route.provider && 'toAmount' in other && 'toAmount' in route && other.toAmount === route.toAmount && 'transaction' in other && 'transaction' in route && other.transaction?.data === route.transaction?.data && other.transaction?.serialized === route.transaction?.serialized) === index);
  const otherChain = input.fromChainId === 1 ? input.toChainId : input.toChainId === 1 ? input.fromChainId : 0;
  const official = officialBridges.find(item => item.chainId === otherChain);
  if (official) deduped.push({ id: `official:${official.provider}:${input.fromChainId}:${input.toChainId}`, provider: official.provider, providerLabel: official.providerLabel, kind: 'official', fromAmount: input.fromAmount, steps: [official.provider], officialUrl: official.officialUrl, warnings: [...official.warnings] });
  deduped.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'aggregator' ? -1 : 1;
    if (input.order === 'FASTEST') return ('durationSeconds' in left ? left.durationSeconds ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER) - ('durationSeconds' in right ? right.durationSeconds ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
    const cost = (value: PublicBridgeRoute) => ('feeUsd' in value ? Number(value.feeUsd ?? 0) + Number(value.gasCostUsd ?? 0) : Number.MAX_SAFE_INTEGER);
    return cost(left) - cost(right);
  });
  if (!deduped.length) throw new Error('BRIDGE_QUOTES_UNAVAILABLE');
  return deduped.slice(0, 8);
}
