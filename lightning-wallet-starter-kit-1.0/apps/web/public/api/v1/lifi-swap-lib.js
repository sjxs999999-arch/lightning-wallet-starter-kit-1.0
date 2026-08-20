const SUPPORTED_EVM_CHAIN_IDS = new Set([1, 56, 137, 8453, 42161]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : null;
const sameAddress = (left, right) => typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
const positiveInteger = value => typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n ? value : null;
const hexData = value => typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value) && value.length <= 200_002 ? value : null;
const hexQuantity = value => {
  if (typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]+|\d+)$/.test(value)) return null;
  try { return `0x${BigInt(value).toString(16)}`; } catch { return null; }
};
const tokenMatches = (token, requested) => requested.startsWith('0x')
  ? sameAddress(token.address, requested)
  : typeof token.symbol === 'string' && token.symbol.toUpperCase() === requested.toUpperCase();
const labels = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && /^[A-Za-z0-9 ._:/-]{1,80}$/.test(item)).filter((item, index, values) => values.indexOf(item) === index).slice(0, 12) : [];
const usdTotal = value => Array.isArray(value) ? value.reduce((total, item) => {
  const amount = Number(record(item).amountUSD);
  return total + (Number.isFinite(amount) && amount > 0 ? amount : 0);
}, 0) : 0;
const usdString = value => value > 0 ? value.toFixed(4) : undefined;

export function normalizeLiFiEvmQuote(input, payload, now = Date.now()) {
  if (input?.chain !== 'EVM' || !SUPPORTED_EVM_CHAIN_IDS.has(input.chainId) || !address(input.taker)) throw new Error('LIFI_EVM_INPUT_INVALID');
  const raw = record(payload), action = record(raw.action), estimate = record(raw.estimate), transaction = record(raw.transactionRequest), fromToken = record(action.fromToken), toToken = record(action.toToken);
  const amountIn = positiveInteger(estimate.fromAmount), amountOut = positiveInteger(estimate.toAmount), minReceived = positiveInteger(estimate.toAmountMin);
  const to = address(transaction.to), data = hexData(transaction.data), value = hexQuantity(transaction.value ?? '0'), gas = hexQuantity(transaction.gasLimit ?? transaction.gas), gasPrice = hexQuantity(transaction.gasPrice);
  if (Number(action.fromChainId) !== input.chainId || Number(action.toChainId) !== input.chainId || Number(transaction.chainId ?? action.fromChainId) !== input.chainId || !sameAddress(action.fromAddress, input.taker) || !sameAddress(action.toAddress, input.taker) || transaction.from !== undefined && !sameAddress(transaction.from, input.taker) || action.fromAmount !== input.sellAmount || amountIn !== input.sellAmount || !tokenMatches(fromToken, input.sellToken) || !tokenMatches(toToken, input.buyToken) || !amountOut || !minReceived || BigInt(minReceived) > BigInt(amountOut) || !to || !data || !value) throw new Error('LIFI_EVM_ROUTE_MISMATCH');
  const fromUsd = Number(estimate.fromAmountUSD), toUsd = Number(estimate.toAmountUSD), impact = Math.max(0, (1 - toUsd / fromUsd) * 100);
  if (!Number.isFinite(fromUsd) || fromUsd <= 0 || !Number.isFinite(toUsd) || toUsd < 0 || !Number.isFinite(impact) || impact > 100) throw new Error('LIFI_EVM_IMPACT_INVALID');
  const tool = typeof raw.tool === 'string' && /^[A-Za-z0-9 ._:/-]{1,80}$/.test(raw.tool) ? raw.tool : 'lifi', rawName = record(raw.toolDetails).name;
  const toolName = typeof rawName === 'string' && /^[A-Za-z0-9 ._:/-]{1,60}$/.test(rawName) ? rawName : tool;
  const allowanceTarget = estimate.approvalAddress === undefined ? undefined : address(estimate.approvalAddress) ?? undefined;
  if (estimate.approvalAddress !== undefined && !allowanceTarget) throw new Error('LIFI_EVM_APPROVAL_INVALID');
  return { provider: `LI.FI / ${toolName}`, amountIn, amountOut, minReceived, priceImpactPct: impact, route: labels([tool, ...(Array.isArray(raw.includedSteps) ? raw.includedSteps.map(step => record(step).tool) : [])]), allowanceTarget, transaction: { to, data, value, ...(gas ? { gas } : {}), ...(gasPrice ? { gasPrice } : {}) }, feeUsd: usdString(usdTotal(estimate.feeCosts)), gasCostUsd: usdString(usdTotal(estimate.gasCosts)), expiresAt: new Date(now + 55_000).toISOString(), raw: { source: 'LI.FI', quoteId: typeof raw.id === 'string' ? raw.id.slice(0, 120) : undefined, tool, chainId: input.chainId, sameChain: true } };
}

export async function fetchLiFiEvmCandidate(input, fetchImpl = fetch, env = process.env) {
  const params = new URLSearchParams({ fromChain: String(input.chainId), toChain: String(input.chainId), fromToken: input.sellToken, toToken: input.buyToken, fromAmount: input.sellAmount, fromAddress: input.taker, toAddress: input.taker, slippage: String(input.slippageBps / 10_000), order: 'CHEAPEST', integrator: 'lightning-wallet' });
  const response = await fetchImpl(`https://li.quest/v1/quote?${params}`, { headers: { accept: 'application/json', ...(env.LIFI_API_KEY ? { 'x-lifi-api-key': env.LIFI_API_KEY } : {}) }, signal: AbortSignal.timeout(12_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message ?? `LIFI_HTTP_${response.status}`);
  return normalizeLiFiEvmQuote(input, body);
}

export function normalizeZeroXQuote(input, payload) {
  if (input?.chain !== 'EVM' || !SUPPORTED_EVM_CHAIN_IDS.has(input.chainId) || !address(input.taker)) throw new Error('ZEROX_EVM_INPUT_INVALID');
  const raw = record(payload), transaction = record(raw.transaction), route = record(raw.route), issues = record(raw.issues), allowance = record(issues.allowance).spender ?? raw.allowanceTarget;
  const amountIn = positiveInteger(raw.sellAmount), amountOut = positiveInteger(raw.buyAmount), minReceived = positiveInteger(raw.minBuyAmount ?? raw.buyAmount), to = address(transaction.to), data = hexData(transaction.data), value = hexQuantity(transaction.value ?? '0'), gas = hexQuantity(transaction.gas), gasPrice = hexQuantity(transaction.gasPrice), allowanceTarget = allowance === undefined ? undefined : address(allowance) ?? undefined, impact = Number(raw.estimatedPriceImpact) * 100;
  if (amountIn !== input.sellAmount || !amountOut || !minReceived || BigInt(minReceived) > BigInt(amountOut) || !to || !data || !value || transaction.from !== undefined && !sameAddress(transaction.from, input.taker) || transaction.chainId !== undefined && Number(transaction.chainId) !== input.chainId || !Number.isFinite(impact) || impact < 0 || impact > 100 || allowance !== undefined && !allowanceTarget) throw new Error('ZEROX_EVM_ROUTE_MISMATCH');
  return { provider: '0x', amountIn, amountOut, minReceived, priceImpactPct: impact, route: labels(Array.isArray(route.fills) ? route.fills.map(fill => record(fill).source) : []), allowanceTarget, transaction: { to, data, value, ...(gas ? { gas } : {}), ...(gasPrice ? { gasPrice } : {}) }, raw: { source: '0x', chainId: input.chainId } };
}
