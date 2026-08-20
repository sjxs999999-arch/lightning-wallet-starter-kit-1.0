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
const SUNSWAP_POOL_VERSIONS = new Set(['v1', 'v2', 'v3', 'v4', 'usdd202pool', '2pool', '2pooltusdusdt', 'old3pool', 'oldusdcpool', 'usdc2pooltusdusdt', 'usdj2pooltusdusdt', 'usdd2pooltusdusdt', 'usdt20psm', 'htxsun', 'wtrx']);
const TRON_ZERO_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

export function swapProviderAvailability(env: NodeJS.ProcessEnv = process.env): SwapProviderAvailability[] {
  return [
    { chain: 'EVM', available: Boolean(env.ZEROX_API_KEY), provider: '0x', ...(env.ZEROX_API_KEY ? {} : { reason: 'EVM 聚合报价服务尚未配置' }) },
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

export async function fetchSwapCandidates(input: SwapQuoteInput) {
  const candidates: SwapCandidate[] = [];
  if (input.chain === 'EVM') {
    const key = process.env.ZEROX_API_KEY;
    if (!key) throw new Error('ZEROX_API_KEY 未配置');
    const query = new URLSearchParams({ chainId: String(input.chainId ?? 1), sellToken: input.sellToken, buyToken: input.buyToken, sellAmount: input.sellAmount, taker: input.taker, slippageBps: String(input.slippageBps) });
    const raw = await read(await fetch(`https://api.0x.org/swap/allowance-holder/quote?${query}`, { headers: { '0x-api-key': key, '0x-version': 'v2' } }));
    const route = record(raw.route);
    candidates.push({
      provider: '0x', amountIn: String(raw.sellAmount), amountOut: String(raw.buyAmount), minReceived: String(raw.minBuyAmount ?? raw.buyAmount),
      priceImpactPct: number(raw.estimatedPriceImpact) * 100,
      route: Array.isArray(route.fills) ? route.fills.map(fill => record(fill).source).filter((source): source is string => typeof source === 'string') : [],
      allowanceTarget: String(record(raw.issues).allowance ? record(record(raw.issues).allowance).spender : raw.allowanceTarget ?? '') || undefined,
      transaction: raw.transaction,
      raw,
    });
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

  const extra = (process.env.SWAP_PROVIDER_URLS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  for (const endpoint of extra) {
    try {
      const raw = await read(await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));
      const values = Array.isArray(raw.candidates) ? raw.candidates : [raw];
      for (const value of values) {
        const item = record(value);
        candidates.push({
          provider: String(item.provider ?? new URL(endpoint).hostname), amountIn: String(item.amountIn ?? input.sellAmount), amountOut: String(item.amountOut), minReceived: String(item.minReceived ?? item.amountOut),
          priceImpactPct: number(item.priceImpactPct), route: safeLabels(item.route), allowanceTarget: typeof item.allowanceTarget === 'string' ? item.allowanceTarget : undefined, transaction: item.transaction, raw: item,
        });
      }
    } catch { continue; }
  }
  if (!candidates.length) throw new Error('没有可用聚合报价');
  return candidates.sort((left, right) => BigInt(right.amountOut) === BigInt(left.amountOut) ? 0 : BigInt(right.amountOut) > BigInt(left.amountOut) ? 1 : -1);
}
