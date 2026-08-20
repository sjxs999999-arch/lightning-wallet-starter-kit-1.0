export type SwapChain = 'EVM' | 'SOL' | 'TRON';

export interface SwapQuoteInput {
  chain: SwapChain;
  chainId?: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  taker: string;
  slippageBps: number;
}

export interface SwapCandidate {
  provider: string;
  amountIn: string;
  amountOut: string;
  minReceived: string;
  priceImpactPct: number;
  route: string[];
  allowanceTarget?: string;
  transaction?: unknown;
  feeUsd?: string;
  gasCostUsd?: string;
  expiresAt?: string;
  raw: unknown;
}

export interface SwapProviderAvailability {
  chain: SwapChain;
  available: boolean;
  provider: string;
  reason?: string;
}

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const SUNSWAP_ROUTER_API = 'https://rot.endjgfsv.link';
const LIFI_API = 'https://li.quest/v1';
const SUPPORTED_EVM_CHAIN_IDS = new Set([1, 56, 137, 8453, 42161]);
const SUNSWAP_POOL_VERSIONS = new Set(['v1', 'v2', 'v3', 'v4', 'usdd202pool', '2pool', '2pooltusdusdt', 'old3pool', 'oldusdcpool', 'usdc2pooltusdusdt', 'usdj2pooltusdusdt', 'usdd2pooltusdusdt', 'usdt20psm', 'htxsun', 'wtrx']);
const TRON_ZERO_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

export function swapProviderAvailability(env: NodeJS.ProcessEnv = process.env): SwapProviderAvailability[] {
  return [
    { chain: 'EVM', available: true, provider: env.ZEROX_API_KEY ? 'LI.FI + 0x' : 'LI.FI' },
    { chain: 'SOL', available: true, provider: 'Jupiter' },
    { chain: 'TRON', available: true, provider: 'SUN.io Smart Router' },
  ];
}

const number = (value: unknown) => Number(value ?? 0);
const record = (value: unknown): JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const positiveInteger = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n ? value : null;
const safeLabels = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && /^[A-Za-z0-9 ._:/-]{1,80}$/.test(item)).slice(0, 12)
  : [];
const safeDecimal = (value: unknown) => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) && value.length <= 100 ? value : null;
const tronAddress = (value: unknown) => typeof value === 'string' && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value) ? value : null;
const evmAddress = (value: unknown) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : null;
const hexData = (value: unknown) => typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value) && value.length <= 200_002 ? value : null;
const hexQuantity = (value: unknown) => {
  if (typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]+|\d+)$/.test(value)) return null;
  try { return `0x${BigInt(value).toString(16)}`; }
  catch { return null; }
};
const sameAddress = (left: unknown, right: string) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
const tokenMatches = (token: JsonRecord, requested: string) => requested.startsWith('0x')
  ? sameAddress(token.address, requested)
  : typeof token.symbol === 'string' && token.symbol.toUpperCase() === requested.toUpperCase();
const usdTotal = (value: unknown) => Array.isArray(value) ? value.reduce((total, item) => {
  const amount = Number(record(item).amountUSD);
  return total + (Number.isFinite(amount) && amount > 0 ? amount : 0);
}, 0) : 0;
const usdString = (value: number) => value > 0 ? value.toFixed(4) : undefined;

function executableSunRoute(item: JsonRecord) {
  if (!Array.isArray(item.tokens) || !Array.isArray(item.symbols) || !Array.isArray(item.poolFees) || !Array.isArray(item.poolVersions) || !Array.isArray(item.poolKeys) || !Array.isArray(item.stepAmountsOut)) return null;
  const tokens = item.tokens.map(tronAddress);
  const symbols = item.symbols.map(value => typeof value === 'string' && /^[A-Za-z0-9 ._-]{1,32}$/.test(value) ? value : null);
  const poolFees = item.poolFees.map(value => typeof value === 'string' && /^\d{1,8}$/.test(value) ? value : null);
  const poolVersions = item.poolVersions.map(value => typeof value === 'string' && SUNSWAP_POOL_VERSIONS.has(value) ? value : null);
  const poolKeys = item.poolKeys.map((value, index) => {
    if (poolVersions[index] !== 'v4') return value === null ? null : undefined;
    const key = record(value);
    if (Object.keys(key).some(name => !['token0', 'token1', 'hooks', 'fee', 'parameters'].includes(name))) return undefined;
    const token0 = tronAddress(key.token0), token1 = tronAddress(key.token1), hooks = tronAddress(key.hooks);
    const feeValue = typeof key.fee === 'number' && Number.isSafeInteger(key.fee) && key.fee >= 0 ? key.fee : null;
    const parameters = typeof key.parameters === 'string' && /^0x[0-9a-fA-F]{64}$/.test(key.parameters) ? key.parameters : null;
    const hop = new Set([tokens[index], tokens[index + 1]]);
    if (!token0 || !token1 || hooks !== TRON_ZERO_ADDRESS || feeValue === null || !parameters || !hop.has(token0) || !hop.has(token1) || token0 === token1 || String(feeValue) !== poolFees[index]) return undefined;
    return { token0, token1, hooks, fee: feeValue, parameters };
  });
  const stepAmountsOut = item.stepAmountsOut.map(safeDecimal);
  if ([...tokens, ...symbols, ...poolFees, ...poolVersions, ...stepAmountsOut].some(value => value === null) || poolKeys.some(value => value === undefined)) return null;
  if (poolVersions.length < 1 || poolVersions.length > 11 || tokens.length !== poolVersions.length + 1 || poolFees.length !== tokens.length || poolKeys.length !== poolVersions.length || stepAmountsOut.length !== poolVersions.length) return null;
  const amountIn = safeDecimal(item.amountIn), amountOut = safeDecimal(item.amountOut), amountOutMinimum = safeDecimal(item.amountOutMinimum), inUsd = safeDecimal(item.inUsd), outUsd = safeDecimal(item.outUsd), impact = safeDecimal(item.impact), fee = safeDecimal(item.fee);
  const amountInRaw = positiveInteger(item.amountInRaw), amountOutRaw = positiveInteger(item.amountOutRaw), amountOutMinimumRaw = typeof item.amountOutMinimumRaw === 'string' && /^\d+$/.test(item.amountOutMinimumRaw) ? item.amountOutMinimumRaw : null;
  if (!amountIn || !amountOut || !amountOutMinimum || !inUsd || !outUsd || !impact || !fee || !amountInRaw || !amountOutRaw || amountOutMinimumRaw === null) return null;
  return { amountIn, amountInRaw, amountOut, amountOutRaw, amountOutMinimum, amountOutMinimumRaw, inUsd, outUsd, impact, fee, containsUnverifiedHook: false, tokens: tokens as string[], symbols: symbols as string[], poolFees: poolFees as string[], poolVersions: poolVersions as string[], poolKeys, stepAmountsOut: stepAmountsOut as string[] };
}

async function read(response: Response) {
  const body = await response.json() as JsonRecord;
  if (!response.ok) throw new Error(String(body.reason ?? body.message ?? `Aggregator HTTP ${response.status}`));
  return body;
}

function slippageFloor(amountOut: string, slippageBps: number) {
  return (BigInt(amountOut) * BigInt(10_000 - slippageBps) / 10_000n).toString();
}

export function normalizeSunSwapRoutes(input: SwapQuoteInput, payload: unknown): SwapCandidate[] {
  const body = record(payload);
  if (body.code !== 0) throw new Error(`SUN.io Smart Router error: ${String(body.message ?? 'unknown')}`);
  if (!Array.isArray(body.data)) throw new Error('SUN.io Smart Router returned no route list');

  return body.data.flatMap(value => {
    const item = record(value);
    const amountIn = positiveInteger(item.amountInRaw);
    const amountOut = positiveInteger(item.amountOutRaw);
    const sunRoute = executableSunRoute(item);
    const tokens = sunRoute?.tokens ?? [];
    const symbols = sunRoute?.symbols ?? [];
    const poolVersions = sunRoute?.poolVersions ?? [];
    const impact = Math.abs(number(item.impact));

    if (
      amountIn !== input.sellAmount
      || !amountOut
      || !sunRoute
      || !Number.isFinite(impact)
      || impact > 100
      || item.containsUnverifiedHook === true
      || tokens[0] !== input.sellToken
      || tokens.at(-1) !== input.buyToken
    ) return [];

    return [{
      provider: 'SUN.io Smart Router',
      amountIn,
      amountOut,
      minReceived: slippageFloor(amountOut, input.slippageBps),
      priceImpactPct: impact,
      route: symbols.length ? symbols : tokens,
      raw: { source: 'SUN.io Smart Router', network: 'mainnet', poolVersions, verifiedHooksOnly: true, sunRoute },
    }];
  });
}

export async function fetchSunSwapCandidates(input: SwapQuoteInput, fetchImpl: FetchLike = fetch) {
  const query = new URLSearchParams({
    fromToken: input.sellToken,
    toToken: input.buyToken,
    amountIn: input.sellAmount,
    typeList: '',
    maxCost: '3',
    includeUnverifiedV4Hook: 'false',
  });
  const response = await fetchImpl(`${SUNSWAP_ROUTER_API}/swap/routerUniversal?${query}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  const candidates = normalizeSunSwapRoutes(input, await read(response));
  if (!candidates.length) throw new Error('SUN.io Smart Router returned no verified route');
  return candidates;
}

export function normalizeLiFiEvmQuote(input: SwapQuoteInput, payload: unknown, now = Date.now()): SwapCandidate {
  if (input.chain !== 'EVM' || !input.chainId || !SUPPORTED_EVM_CHAIN_IDS.has(input.chainId) || !evmAddress(input.taker)) throw new Error('LI.FI EVM request is invalid');
  const raw = record(payload), action = record(raw.action), estimate = record(raw.estimate), transaction = record(raw.transactionRequest);
  const fromToken = record(action.fromToken), toToken = record(action.toToken);
  const amountIn = positiveInteger(estimate.fromAmount), amountOut = positiveInteger(estimate.toAmount), minReceived = positiveInteger(estimate.toAmountMin);
  const to = evmAddress(transaction.to), data = hexData(transaction.data), value = hexQuantity(transaction.value ?? '0'), gas = hexQuantity(transaction.gasLimit ?? transaction.gas), gasPrice = hexQuantity(transaction.gasPrice);
  const responseChainId = Number(transaction.chainId ?? action.fromChainId), toChainId = Number(action.toChainId);
  if (
    Number(action.fromChainId) !== input.chainId
    || toChainId !== input.chainId
    || responseChainId !== input.chainId
    || !sameAddress(action.fromAddress, input.taker)
    || !sameAddress(action.toAddress, input.taker)
    || (transaction.from !== undefined && !sameAddress(transaction.from, input.taker))
    || action.fromAmount !== input.sellAmount
    || amountIn !== input.sellAmount
    || !tokenMatches(fromToken, input.sellToken)
    || !tokenMatches(toToken, input.buyToken)
    || !amountOut
    || !minReceived
    || BigInt(minReceived) > BigInt(amountOut)
    || !to
    || !data
    || !value
  ) throw new Error('LI.FI returned a mismatched or non-executable route');

  const fromUsd = Number(estimate.fromAmountUSD), toUsd = Number(estimate.toAmountUSD);
  if (!Number.isFinite(fromUsd) || fromUsd <= 0 || !Number.isFinite(toUsd) || toUsd < 0) throw new Error('LI.FI route is missing price-impact data');
  const priceImpactPct = Math.max(0, (1 - toUsd / fromUsd) * 100);
  if (!Number.isFinite(priceImpactPct) || priceImpactPct > 100) throw new Error('LI.FI price impact is invalid');

  const tool = typeof raw.tool === 'string' && /^[A-Za-z0-9 ._:/-]{1,80}$/.test(raw.tool) ? raw.tool : 'lifi';
  const toolName = typeof record(raw.toolDetails).name === 'string' && /^[A-Za-z0-9 ._:/-]{1,60}$/.test(String(record(raw.toolDetails).name)) ? String(record(raw.toolDetails).name) : tool;
  const route = safeLabels([tool, ...(Array.isArray(raw.includedSteps) ? raw.includedSteps.map(step => record(step).tool) : [])]).filter((item, index, values) => values.indexOf(item) === index);
  const allowanceTarget = estimate.approvalAddress === undefined ? undefined : evmAddress(estimate.approvalAddress) ?? undefined;
  if (estimate.approvalAddress !== undefined && !allowanceTarget) throw new Error('LI.FI approval target is invalid');

  return {
    provider: `LI.FI / ${toolName}`,
    amountIn,
    amountOut,
    minReceived,
    priceImpactPct,
    route,
    allowanceTarget,
    transaction: { to, data, value, ...(gas ? { gas } : {}), ...(gasPrice ? { gasPrice } : {}) },
    feeUsd: usdString(usdTotal(estimate.feeCosts)),
    gasCostUsd: usdString(usdTotal(estimate.gasCosts)),
    expiresAt: new Date(now + 55_000).toISOString(),
    raw: { source: 'LI.FI', quoteId: typeof raw.id === 'string' ? raw.id.slice(0, 120) : undefined, tool, chainId: input.chainId, sameChain: true },
  };
}

export async function fetchLiFiEvmCandidate(input: SwapQuoteInput, fetchImpl: FetchLike = fetch) {
  if (input.chain !== 'EVM' || !input.chainId || !SUPPORTED_EVM_CHAIN_IDS.has(input.chainId)) throw new Error('Unsupported LI.FI EVM chain');
  const query = new URLSearchParams({
    fromChain: String(input.chainId), toChain: String(input.chainId), fromToken: input.sellToken, toToken: input.buyToken,
    fromAmount: input.sellAmount, fromAddress: input.taker, toAddress: input.taker,
    slippage: String(input.slippageBps / 10_000), order: 'CHEAPEST', integrator: 'lightning-wallet',
  });
  const response = await fetchImpl(`${LIFI_API}/quote?${query}`, {
    headers: { accept: 'application/json', ...(process.env.LIFI_API_KEY ? { 'x-lifi-api-key': process.env.LIFI_API_KEY } : {}) },
    signal: AbortSignal.timeout(12_000),
  });
  return normalizeLiFiEvmQuote(input, await read(response));
}

async function fetchZeroXCandidate(input: SwapQuoteInput): Promise<SwapCandidate> {
  const key = process.env.ZEROX_API_KEY;
  if (!key) throw new Error('ZEROX_API_KEY is not configured');
  const query = new URLSearchParams({ chainId: String(input.chainId ?? 1), sellToken: input.sellToken, buyToken: input.buyToken, sellAmount: input.sellAmount, taker: input.taker, slippageBps: String(input.slippageBps) });
  const raw = await read(await fetch(`https://api.0x.org/swap/allowance-holder/quote?${query}`, { headers: { '0x-api-key': key, '0x-version': 'v2' }, signal: AbortSignal.timeout(12_000) }));
  const route = record(raw.route), amountIn = positiveInteger(raw.sellAmount), amountOut = positiveInteger(raw.buyAmount), minReceived = positiveInteger(raw.minBuyAmount ?? raw.buyAmount);
  const tx = record(raw.transaction), to = evmAddress(tx.to), data = hexData(tx.data), value = hexQuantity(tx.value ?? '0'), gas = hexQuantity(tx.gas), gasPrice = hexQuantity(tx.gasPrice);
  const allowance = record(record(raw.issues).allowance).spender ?? raw.allowanceTarget;
  const allowanceTarget = allowance === undefined ? undefined : evmAddress(allowance) ?? undefined;
  const impact = Number(raw.estimatedPriceImpact) * 100;
  if (amountIn !== input.sellAmount || !amountOut || !minReceived || BigInt(minReceived) > BigInt(amountOut) || !to || !data || !value || !Number.isFinite(impact) || impact < 0 || impact > 100 || (allowance !== undefined && !allowanceTarget)) throw new Error('0x returned a mismatched or non-executable route');
  return {
    provider: '0x', amountIn, amountOut, minReceived, priceImpactPct: impact,
    route: Array.isArray(route.fills) ? safeLabels(route.fills.map(fill => record(fill).source)) : [],
    allowanceTarget, transaction: { to, data, value, ...(gas ? { gas } : {}), ...(gasPrice ? { gasPrice } : {}) }, raw: { source: '0x', chainId: input.chainId },
  };
}

export function normalizeExternalEvmCandidate(input: SwapQuoteInput, value: unknown, endpoint: string): SwapCandidate {
  if (new URL(endpoint).protocol !== 'https:') throw new Error('External EVM provider must use HTTPS');
  const item = record(value), provider = typeof item.provider === 'string' && /^[A-Za-z0-9 ._:/-]{1,80}$/.test(item.provider) ? item.provider : new URL(endpoint).hostname;
  const amountIn = positiveInteger(item.amountIn), amountOut = positiveInteger(item.amountOut), minReceived = positiveInteger(item.minReceived ?? item.amountOut), impact = number(item.priceImpactPct);
  const rawTransaction = record(item.transaction), to = evmAddress(rawTransaction.to), data = hexData(rawTransaction.data), txValue = hexQuantity(rawTransaction.value ?? '0'), gas = hexQuantity(rawTransaction.gas), gasPrice = hexQuantity(rawTransaction.gasPrice);
  const allowanceTarget = item.allowanceTarget === undefined ? undefined : evmAddress(item.allowanceTarget) ?? undefined;
  if (input.chain !== 'EVM' || amountIn !== input.sellAmount || !amountOut || !minReceived || BigInt(minReceived) > BigInt(amountOut) || !Number.isFinite(impact) || impact < 0 || impact > 100 || !to || !data || !txValue || (rawTransaction.from !== undefined && !sameAddress(rawTransaction.from, input.taker)) || (rawTransaction.chainId !== undefined && Number(rawTransaction.chainId) !== input.chainId) || (item.allowanceTarget !== undefined && !allowanceTarget)) throw new Error('External EVM provider returned an invalid route');
  return { provider, amountIn, amountOut, minReceived, priceImpactPct: impact, route: safeLabels(item.route), allowanceTarget, transaction: { to, data, value: txValue, ...(gas ? { gas } : {}), ...(gasPrice ? { gasPrice } : {}) }, raw: { source: new URL(endpoint).hostname, chainId: input.chainId } };
}

export async function fetchSwapCandidates(input: SwapQuoteInput) {
  const candidates: SwapCandidate[] = [];
  if (input.chain === 'EVM') {
    const settled = await Promise.allSettled([fetchLiFiEvmCandidate(input), ...(process.env.ZEROX_API_KEY ? [fetchZeroXCandidate(input)] : [])]);
    candidates.push(...settled.filter((item): item is PromiseFulfilledResult<SwapCandidate> => item.status === 'fulfilled').map(item => item.value));
  } else if (input.chain === 'SOL') {
    const query = new URLSearchParams({ inputMint: input.sellToken, outputMint: input.buyToken, amount: input.sellAmount, slippageBps: String(input.slippageBps), restrictIntermediateTokens: 'true' });
    const raw = await read(await fetch(`https://lite-api.jup.ag/swap/v1/quote?${query}`));
    candidates.push({
      provider: 'Jupiter', amountIn: String(raw.inAmount), amountOut: String(raw.outAmount), minReceived: String(raw.otherAmountThreshold),
      priceImpactPct: number(raw.priceImpactPct) * 100,
      route: Array.isArray(raw.routePlan) ? raw.routePlan.map(step => record(record(step).swapInfo).label).filter((label): label is string => typeof label === 'string') : [],
      raw,
    });
  } else {
    candidates.push(...await fetchSunSwapCandidates(input));
  }

  const extra = input.chain === 'EVM' ? (process.env.SWAP_PROVIDER_URLS ?? '').split(',').map(value => value.trim()).filter(Boolean) : [];
  for (const endpoint of extra) {
    try {
      if (new URL(endpoint).protocol !== 'https:') continue;
      const raw = await read(await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(12_000) }));
      const values = Array.isArray(raw.candidates) ? raw.candidates : [raw];
      for (const value of values) {
        try { candidates.push(normalizeExternalEvmCandidate(input, value, endpoint)); }
        catch { continue; }
      }
    } catch { continue; }
  }
  if (!candidates.length) throw new Error('没有可用聚合报价');
  return candidates.sort((left, right) => BigInt(right.amountOut) === BigInt(left.amountOut) ? 0 : BigInt(right.amountOut) > BigInt(left.amountOut) ? 1 : -1);
}
