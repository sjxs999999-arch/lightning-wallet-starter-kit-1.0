import { randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { isAddress } from 'ethers';

const SOLANA_CHAIN_ID = 1_151_111_081_099_710;
const CHAIN_IDS = new Set([1, 10, 137, 8453, 42161, SOLANA_CHAIN_ID]);
const RAW_AMOUNT = /^\d{1,100}$/;
const TOKEN = /^(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z][A-Za-z0-9]{1,11})$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BRIDGE_TOOLS = [
  { key: '', label: 'LI.FI 最优路线' },
  { key: 'across', label: 'Across' },
  { key: 'stargateV2', label: 'Stargate' },
  { key: 'mayanWH', label: 'Wormhole / Mayan' },
];
const OFFICIAL_BRIDGES = [
  { chainId: 42161, provider: 'arbitrum-official', providerLabel: 'Arbitrum 官方桥', officialUrl: 'https://portal.arbitrum.io/bridge', warnings: ['费用、到账时间与提现等待期以官方桥连接钱包后的实时结果为准'] },
  { chainId: 10, provider: 'optimism-official', providerLabel: 'Optimism 官方桥', officialUrl: 'https://app.optimism.io/bridge', warnings: ['提回 Ethereum 可能包含标准桥挑战等待期，请在官方桥复核'] },
  { chainId: 8453, provider: 'base-official', providerLabel: 'Base 官方桥', officialUrl: 'https://bridge.base.org', warnings: ['提回 Ethereum 可能包含标准桥挑战等待期，请在官方桥复核'] },
  { chainId: 137, provider: 'polygon-official', providerLabel: 'Polygon Portal', officialUrl: 'https://portal.polygon.technology/bridge', warnings: ['提现方向可能需要额外 claim；费用与时间由官方入口确认'] },
];

const json = async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : `UPSTREAM_HTTP_${response.status}`);
  return body;
};

const fetchJson = async (url, init = {}, timeoutMs = 9_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await json(await fetch(url, { ...init, signal: controller.signal })); }
  finally { clearTimeout(timer); }
};

const solanaAddress = (value) => {
  if (typeof value !== 'string' || !BASE58.test(value)) return false;
  try { return bs58.decode(value).length === 32; }
  catch { return false; }
};

const addressForChain = (chainId, value) => chainId === SOLANA_CHAIN_ID ? solanaAddress(value) : isAddress(value);
const tokenForChain = (chainId, value) => typeof value === 'string' && TOKEN.test(value) && (chainId !== SOLANA_CHAIN_ID || value.length <= 11 || solanaAddress(value));

export function parseBridgeRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = ['fromChainId', 'toChainId', 'fromToken', 'toToken', 'fromAmount', 'fromAddress', 'toAddress', 'slippageBps', 'order'];
  if (!Object.keys(input).every((key) => allowed.includes(key)) || !CHAIN_IDS.has(input.fromChainId) || !CHAIN_IDS.has(input.toChainId) || input.fromChainId === input.toChainId || !tokenForChain(input.fromChainId, input.fromToken) || !tokenForChain(input.toChainId, input.toToken) || typeof input.fromAmount !== 'string' || !RAW_AMOUNT.test(input.fromAmount) || BigInt(input.fromAmount) <= 0n || !addressForChain(input.fromChainId, input.fromAddress) || !addressForChain(input.toChainId, input.toAddress) || !Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 300 || !['CHEAPEST', 'FASTEST'].includes(input.order)) return null;
  return { fromChainId: input.fromChainId, toChainId: input.toChainId, fromToken: input.fromToken, toToken: input.toToken, fromAmount: input.fromAmount, fromAddress: input.fromAddress, toAddress: input.toAddress, slippageBps: input.slippageBps, order: input.order };
}

const usd = (costs) => Array.isArray(costs) ? costs.reduce((sum, item) => sum + (Number(item?.amountUSD) || 0), 0) : 0;
const hexQuantity = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value);
  if (/^0x[0-9a-f]+$/i.test(text)) return `0x${BigInt(text).toString(16)}`;
  if (/^\d+$/.test(text)) return `0x${BigInt(text).toString(16)}`;
  return undefined;
};

function normalizeLiFiQuote(raw, input, requestedLabel) {
  const estimate = raw?.estimate ?? {};
  const tool = typeof raw?.tool === 'string' ? raw.tool : 'lifi';
  const included = Array.isArray(raw?.includedSteps) ? raw.includedSteps : [];
  const steps = [tool, ...included.map((step) => step?.tool)].filter((value, index, list) => typeof value === 'string' && value && list.indexOf(value) === index);
  const feeUsd = usd(estimate.feeCosts), gasCostUsd = usd(estimate.gasCosts);
  const fromUsd = Number(estimate.fromAmountUSD), toUsd = Number(estimate.toAmountUSD);
  const priceImpactPct = Number.isFinite(fromUsd) && fromUsd > 0 && Number.isFinite(toUsd) ? Math.max(0, (1 - toUsd / fromUsd) * 100) : undefined;
  const transactionRequest = raw?.transactionRequest;
  const fromTokenAddress = isAddress(raw?.action?.fromToken?.address) || solanaAddress(raw?.action?.fromToken?.address) ? raw.action.fromToken.address : undefined;
  let transaction;
  if (input.fromChainId === SOLANA_CHAIN_ID && typeof transactionRequest?.data === 'string' && transactionRequest.data.length > 20 && transactionRequest.data.length < 250_000) {
    transaction = { family: 'SOL', chainId: input.fromChainId, serialized: transactionRequest.data };
  } else if (input.fromChainId !== SOLANA_CHAIN_ID && isAddress(transactionRequest?.to) && typeof transactionRequest?.data === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(transactionRequest.data) && transactionRequest.data.length <= 200_002) {
    transaction = { family: 'EVM', chainId: input.fromChainId, to: transactionRequest.to, data: transactionRequest.data, value: hexQuantity(transactionRequest.value) ?? '0x0', gasLimit: hexQuantity(transactionRequest.gasLimit ?? transactionRequest.gas) };
  }
  const approvalAddress = isAddress(estimate.approvalAddress) ? estimate.approvalAddress : undefined;
  const providerLabel = typeof raw?.toolDetails?.name === 'string' && raw.toolDetails.name.trim() ? raw.toolDetails.name.trim() : requestedLabel;
  return {
    id: `${tool}:${typeof raw?.id === 'string' ? raw.id : randomUUID()}`,
    provider: tool,
    providerLabel,
    kind: 'aggregator',
    fromAmount: String(estimate.fromAmount ?? input.fromAmount),
    toAmount: typeof estimate.toAmount === 'string' ? estimate.toAmount : undefined,
    toAmountMin: typeof estimate.toAmountMin === 'string' ? estimate.toAmountMin : undefined,
    feeUsd: feeUsd > 0 ? feeUsd.toFixed(4) : undefined,
    gasCostUsd: gasCostUsd > 0 ? gasCostUsd.toFixed(4) : undefined,
    durationSeconds: Number.isFinite(Number(estimate.executionDuration)) && Number(estimate.executionDuration) > 0 ? Number(estimate.executionDuration) : undefined,
    priceImpactPct,
    steps,
    approvalAddress,
    fromTokenAddress,
    transaction,
    expiresAt: new Date(Date.now() + 55_000).toISOString(),
    warnings: ['聚合报价为限时结果；签名前必须重新核对钱包中的链、收款地址、金额与授权额度'],
  };
}

async function lifiQuote(input, tool) {
  const params = new URLSearchParams({
    fromChain: String(input.fromChainId), toChain: String(input.toChainId), fromToken: input.fromToken, toToken: input.toToken,
    fromAmount: input.fromAmount, fromAddress: input.fromAddress, toAddress: input.toAddress,
    slippage: String(input.slippageBps / 10_000), order: input.order, integrator: 'lightning-wallet',
  });
  if (tool.key) params.set('allowBridges', tool.key);
  const headers = { accept: 'application/json', ...(process.env.LIFI_API_KEY ? { 'x-lifi-api-key': process.env.LIFI_API_KEY } : {}) };
  const route = normalizeLiFiQuote(await fetchJson(`https://li.quest/v1/quote?${params}`, { headers }), input, tool.label);
  if (route.transaction?.family === 'SOL') {
    const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
    const simulationBody = await fetchJson(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: [route.transaction.serialized, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }] }) }, 12_000);
    const simulation = simulationBody?.result?.value;
    if (!simulation || simulation.err) throw new Error('BRIDGE_SIMULATION_FAILED');
    route.transaction.simulated = true;
    route.transaction.unitsConsumed = Number(simulation.unitsConsumed) || undefined;
  }
  return route;
}

export async function fetchBridgeQuotes(input) {
  const tools = BRIDGE_TOOLS.filter((tool) => tool.key !== 'mayanWH' || input.fromChainId === SOLANA_CHAIN_ID || input.toChainId === SOLANA_CHAIN_ID);
  const settled = await Promise.allSettled(tools.map((tool) => lifiQuote(input, tool)));
  const routes = settled.filter((item) => item.status === 'fulfilled').map((item) => item.value);
  const deduped = routes.filter((route, index, list) => list.findIndex((other) => other.provider === route.provider && other.toAmount === route.toAmount && other.transaction?.data === route.transaction?.data && other.transaction?.serialized === route.transaction?.serialized) === index);
  const otherChain = input.fromChainId === 1 ? input.toChainId : input.toChainId === 1 ? input.fromChainId : 0;
  const official = OFFICIAL_BRIDGES.find((item) => item.chainId === otherChain);
  if (official) deduped.push({ id: `official:${official.provider}:${input.fromChainId}:${input.toChainId}`, provider: official.provider, providerLabel: official.providerLabel, kind: 'official', fromAmount: input.fromAmount, steps: [official.provider], officialUrl: official.officialUrl, warnings: [...official.warnings] });
  deduped.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'aggregator' ? -1 : 1;
    if (input.order === 'FASTEST') return (left.durationSeconds ?? Number.MAX_SAFE_INTEGER) - (right.durationSeconds ?? Number.MAX_SAFE_INTEGER);
    return (Number(left.feeUsd ?? 0) + Number(left.gasCostUsd ?? 0)) - (Number(right.feeUsd ?? 0) + Number(right.gasCostUsd ?? 0));
  });
  if (!deduped.length) throw new Error('BRIDGE_QUOTES_UNAVAILABLE');
  return deduped.slice(0, 8);
}

const statusOf = (value) => value && typeof value === 'object' && 'status' in value ? value.status : undefined;
const flag = (value) => String(value ?? '') === '1';
const finding = (label, status, detail) => ({ label, status, detail });

function evmFindings(token) {
  const cannotSell = flag(token.cannot_sell_all), honeypot = flag(token.is_honeypot), blacklist = flag(token.is_blacklisted), open = flag(token.is_open_source), mintable = flag(token.is_mintable), proxy = flag(token.is_proxy);
  const buyTax = Number(token.buy_tax ?? 0), sellTax = Number(token.sell_tax ?? 0);
  return [
    finding('卖出 / 貔貅风险', honeypot || cannotSell ? 'danger' : 'safe', honeypot ? '检测到 Honeypot 信号' : cannotSell ? '可能无法全部卖出' : '未检测到限制信号'),
    finding('黑名单能力', blacklist ? 'danger' : 'safe', blacklist ? '合约包含黑名单信号' : '未检测到'),
    finding('合约源码', open ? 'safe' : 'warn', open ? '已开源' : '未确认开源'),
    finding('额外铸币权限', mintable ? 'warn' : 'safe', mintable ? '仍可增发' : '未检测到增发权限'),
    finding('代理升级', proxy ? 'warn' : 'safe', proxy ? '可升级代理' : '未检测到代理'),
    finding('买 / 卖税', buyTax > 0.1 || sellTax > 0.1 ? 'danger' : buyTax > 0.03 || sellTax > 0.03 ? 'warn' : 'safe', `${(buyTax * 100).toFixed(2)}% / ${(sellTax * 100).toFixed(2)}%`),
  ];
}

function solanaFindings(token) {
  const mintable = Boolean(statusOf(token.mintable) ?? token.mint_authority), closable = Boolean(statusOf(token.closable)), freezable = Boolean(statusOf(token.freezable) ?? token.freeze_authority), locked = flag(token.is_locked);
  return [
    finding('铸币权限', mintable ? 'warn' : 'safe', mintable ? 'Mint 权限仍存在' : '未检测到 Mint 权限'),
    finding('冻结权限', freezable ? 'warn' : 'safe', freezable ? 'Token 可冻结' : '未检测到冻结权限'),
    finding('关闭权限', closable ? 'warn' : 'safe', closable ? '账户可关闭' : '未检测到'),
    finding('流动性锁定', locked ? 'safe' : 'unknown', locked ? '检测到锁定信息' : '未确认'),
    finding('交易限制', 'unknown', '需结合实时模拟与交易池深度'),
  ];
}

export function parseRiskRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).every((key) => ['chain', 'address'].includes(key)) || !['1', '10', '137', '8453', '42161', 'solana'].includes(input.chain) || typeof input.address !== 'string') return null;
  const address = input.address.trim();
  if (input.chain === 'solana' ? !solanaAddress(address) : !isAddress(address)) return null;
  return { chain: input.chain, address };
}

export async function scanTokenRisk(input) {
  const url = input.chain === 'solana' ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(input.address)}` : `https://api.gopluslabs.io/api/v1/token_security/${input.chain}?contract_addresses=${encodeURIComponent(input.address)}`;
  const headers = { accept: 'application/json', ...(process.env.GOPLUS_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.GOPLUS_ACCESS_TOKEN}` } : {}) };
  const body = await fetchJson(url, { headers });
  if (body?.code !== 1) throw new Error(typeof body?.message === 'string' ? body.message : 'TOKEN_RISK_UNAVAILABLE');
  const token = body?.result?.[input.address] ?? body?.result?.[input.address.toLowerCase()] ?? Object.values(body?.result ?? {})[0];
  if (!token || typeof token !== 'object') throw new Error('TOKEN_RISK_NOT_FOUND');
  const findings = input.chain === 'solana' ? solanaFindings(token) : evmFindings(token);
  const danger = findings.filter((item) => item.status === 'danger').length, warn = findings.filter((item) => item.status === 'warn').length, unknown = findings.filter((item) => item.status === 'unknown').length;
  return { score: Math.max(0, 100 - danger * 35 - warn * 12 - unknown * 5), level: danger ? 'high' : warn >= 2 ? 'medium' : unknown >= findings.length / 2 ? 'unknown' : 'low', tokenName: typeof token.token_name === 'string' ? token.token_name : '', tokenSymbol: typeof token.token_symbol === 'string' ? token.token_symbol : '', findings, sources: ['GoPlus Security', '公开链上数据'], scannedAt: new Date().toISOString() };
}

const objectRecord = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const shortPublicText = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;
const publicAmount = (value) => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? value.slice(0, 100) : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : undefined;

export function parseLpRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).every((key) => ['protocol', 'owner'].includes(key)) || input.protocol !== 'raydium' || !solanaAddress(input.owner)) return null;
  return { protocol: 'raydium', owner: input.owner };
}

function raydiumPositionRows(value) {
  const root = objectRecord(value), data = root?.data ?? root?.result ?? value;
  if (Array.isArray(data)) return data.filter((item) => objectRecord(item)).slice(0, 100);
  const container = objectRecord(data);
  if (!container) return [];
  for (const key of ['positions', 'items', 'rows', 'stakePositions', 'farms']) {
    if (Array.isArray(container[key])) return container[key].filter((item) => objectRecord(item)).slice(0, 100);
  }
  return [];
}

export function normalizeRaydiumPositions(owner, value) {
  const positions = raydiumPositionRows(value).map((item, index) => {
    const id = shortPublicText(item.poolId ?? item.pool ?? item.ammId ?? item.farmId ?? item.id, `position-${index + 1}`);
    const label = shortPublicText(item.poolName ?? item.name ?? item.symbol ?? item.lpSymbol, id);
    const kind = shortPublicText(item.type ?? item.kind ?? item.version ?? item.program, 'Raydium LP / Stake');
    const rewards = item.pendingRewards ?? item.rewards ?? item.rewardInfos;
    const pendingRewardCount = Array.isArray(rewards) ? Math.min(rewards.length, 20) : objectRecord(rewards) ? Math.min(Object.keys(rewards).length, 20) : 0;
    const stakedAmount = publicAmount(item.stakedAmount ?? item.deposited ?? item.amount ?? item.lpAmount);
    return { id, label, kind, ...(stakedAmount ? { stakedAmount } : {}), pendingRewardCount };
  });
  return { protocol: 'raydium', owner, positions, count: positions.length, rewardEntries: positions.reduce((total, item) => total + item.pendingRewardCount, 0), cached: true, source: 'Raydium Owner API', fetchedAt: new Date().toISOString() };
}

export async function fetchPublicLpPositions(input) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(`https://owner-v1.raydium.io/position/stake/${encodeURIComponent(input.owner)}`, { headers: { accept: 'application/json' }, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404 || objectRecord(body)?.success === false) return normalizeRaydiumPositions(input.owner, []);
    if (!response.ok) throw new Error(`RAYDIUM_OWNER_HTTP_${response.status}`);
    return normalizeRaydiumPositions(input.owner, body);
  } finally { clearTimeout(timer); }
}

export function parseSolanaSwapRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = ['sellToken', 'buyToken', 'sellAmount', 'taker', 'slippageBps', 'priority'];
  if (!Object.keys(input).every((key) => allowed.includes(key)) || !solanaAddress(input.sellToken) || !solanaAddress(input.buyToken) || input.sellToken === input.buyToken || typeof input.sellAmount !== 'string' || !RAW_AMOUNT.test(input.sellAmount) || BigInt(input.sellAmount) <= 0n || !solanaAddress(input.taker) || !Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 300 || !['low', 'auto', 'high'].includes(input.priority)) return null;
  return { sellToken: input.sellToken, buyToken: input.buyToken, sellAmount: input.sellAmount, taker: input.taker, slippageBps: input.slippageBps, priority: input.priority };
}

const priorityConfig = (priority) => priority === 'low' ? { priorityLevelWithMaxLamports: { maxLamports: 100_000, global: false, priorityLevel: 'medium' } } : priority === 'high' ? { priorityLevelWithMaxLamports: { maxLamports: 5_000_000, global: false, priorityLevel: 'veryHigh' } } : { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, global: false, priorityLevel: 'high' } };

export async function prepareSolanaSwap(input) {
  const params = new URLSearchParams({ inputMint: input.sellToken, outputMint: input.buyToken, amount: input.sellAmount, slippageBps: String(input.slippageBps), restrictIntermediateTokens: 'true' });
  const quote = await fetchJson(`https://lite-api.jup.ag/swap/v1/quote?${params}`, { headers: { accept: 'application/json' } });
  const priceImpactPct = Number(quote?.priceImpactPct ?? 0) * 100;
  if (!Number.isFinite(priceImpactPct) || priceImpactPct < 0 || priceImpactPct > 3) throw new Error('PRICE_IMPACT_BLOCKED');
  const route = Array.isArray(quote?.routePlan) ? quote.routePlan.map((item) => item?.swapInfo?.label).filter((value) => typeof value === 'string').slice(0, 12) : [];
  const swap = await fetchJson('https://lite-api.jup.ag/swap/v1/swap', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ quoteResponse: quote, userPublicKey: input.taker, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: priorityConfig(input.priority) }) });
  if (typeof swap?.swapTransaction !== 'string' || swap.swapTransaction.length < 20 || swap.swapTransaction.length > 250_000) throw new Error('INVALID_SWAP_TRANSACTION');
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  const simulationBody = await fetchJson(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: [swap.swapTransaction, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }] }) }, 12_000);
  const simulation = simulationBody?.result?.value;
  if (!simulation || simulation.err) throw new Error('SWAP_SIMULATION_FAILED');
  return { serializedTransaction: swap.swapTransaction, lastValidBlockHeight: Number(swap.lastValidBlockHeight) || undefined, prioritizationFeeLamports: Number(swap.prioritizationFeeLamports) || undefined, simulation: { ok: true, unitsConsumed: Number(simulation.unitsConsumed) || undefined }, quote: { provider: 'Jupiter', amountIn: String(quote.inAmount), amountOut: String(quote.outAmount), minReceived: String(quote.otherAmountThreshold), priceImpactPct, route } };
}

export async function handleProRequest({ req, res, route, method, bodyOf, send }) {
  if (method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (route === 'bridge/quotes') {
    const input = parseBridgeRequest(bodyOf(req));
    if (!input) return send(res, 400, { error: 'INVALID_BRIDGE_QUOTE_REQUEST' });
    return send(res, 200, { data: await fetchBridgeQuotes(input) });
  }
  if (route === 'risk/token') {
    const input = parseRiskRequest(bodyOf(req));
    if (!input) return send(res, 400, { error: 'INVALID_TOKEN_RISK_REQUEST' });
    return send(res, 200, { data: await scanTokenRisk(input) });
  }
  if (route === 'swap/solana-transaction') {
    const input = parseSolanaSwapRequest(bodyOf(req));
    if (!input) return send(res, 400, { error: 'INVALID_SOLANA_SWAP_REQUEST' });
    return send(res, 200, { data: await prepareSolanaSwap(input) });
  }
  if (route === 'lp/positions') {
    const input = parseLpRequest(bodyOf(req));
    if (!input) return send(res, 400, { error: 'INVALID_LP_POSITION_REQUEST' });
    return send(res, 200, { data: await fetchPublicLpPositions(input) });
  }
  return send(res, 404, { error: 'NOT_FOUND' });
}
