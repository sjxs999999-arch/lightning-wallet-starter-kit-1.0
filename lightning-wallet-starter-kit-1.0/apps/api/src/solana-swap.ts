import bs58 from 'bs58';
import { z } from 'zod';

const solanaAddress = z.string().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/).refine(value => {
  try { return bs58.decode(value).length === 32; }
  catch { return false; }
});
const rawAmount = z.string().regex(/^\d{1,100}$/).refine(value => BigInt(value) > 0n);

export const solanaSwapTransactionSchema = z.object({
  sellToken: solanaAddress,
  buyToken: solanaAddress,
  sellAmount: rawAmount,
  taker: solanaAddress,
  slippageBps: z.number().int().min(1).max(300),
  priority: z.enum(['low', 'auto', 'high']),
}).strict().refine(value => value.sellToken !== value.buyToken, { path: ['buyToken'], message: 'Swap mints must differ' });

type PreparedInput = z.infer<typeof solanaSwapTransactionSchema>;

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `UPSTREAM_HTTP_${response.status}`);
  return body;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await responseJson(await fetch(url, { ...init, signal: controller.signal })); }
  finally { clearTimeout(timer); }
}

const priorityConfig = (priority: PreparedInput['priority']) => priority === 'low'
  ? { priorityLevelWithMaxLamports: { maxLamports: 100_000, global: false, priorityLevel: 'medium' } }
  : priority === 'high'
    ? { priorityLevelWithMaxLamports: { maxLamports: 5_000_000, global: false, priorityLevel: 'veryHigh' } }
    : { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, global: false, priorityLevel: 'high' } };

async function simulate(serialized: string, rpcUrls: string[]) {
  let lastError = 'SWAP_SIMULATION_FAILED';
  for (const rpcUrl of rpcUrls) {
    try {
      const body = await fetchJson(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: [serialized, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }] }) });
      const value = (body.result as { value?: { err?: unknown; unitsConsumed?: unknown } } | undefined)?.value;
      if (!value || value.err) throw new Error('SWAP_SIMULATION_FAILED');
      return { ok: true as const, unitsConsumed: Number(value.unitsConsumed) || undefined };
    } catch (error) { lastError = error instanceof Error ? error.message : lastError; }
  }
  throw new Error(lastError);
}

export async function prepareSolanaSwap(raw: unknown, rpcUrls: string[]) {
  const input = solanaSwapTransactionSchema.parse(raw);
  const params = new URLSearchParams({ inputMint: input.sellToken, outputMint: input.buyToken, amount: input.sellAmount, slippageBps: String(input.slippageBps), restrictIntermediateTokens: 'true' });
  const quote = await fetchJson(`https://lite-api.jup.ag/swap/v1/quote?${params}`);
  const priceImpactPct = Number(quote.priceImpactPct ?? 0) * 100;
  if (!Number.isFinite(priceImpactPct) || priceImpactPct < 0 || priceImpactPct > 3) throw new Error('PRICE_IMPACT_BLOCKED');
  const route = Array.isArray(quote.routePlan) ? quote.routePlan.map(item => (item as { swapInfo?: { label?: unknown } })?.swapInfo?.label).filter((value): value is string => typeof value === 'string').slice(0, 12) : [];
  const swap = await fetchJson('https://lite-api.jup.ag/swap/v1/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteResponse: quote, userPublicKey: input.taker, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: priorityConfig(input.priority) }) });
  const serializedTransaction = typeof swap.swapTransaction === 'string' ? swap.swapTransaction : '';
  if (serializedTransaction.length < 20 || serializedTransaction.length > 250_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(serializedTransaction)) throw new Error('INVALID_SWAP_TRANSACTION');
  const simulation = await simulate(serializedTransaction, rpcUrls);
  return {
    serializedTransaction,
    lastValidBlockHeight: Number(swap.lastValidBlockHeight) || undefined,
    prioritizationFeeLamports: Number(swap.prioritizationFeeLamports) || undefined,
    simulation,
    quote: { provider: 'Jupiter', amountIn: String(quote.inAmount), amountOut: String(quote.outAmount), minReceived: String(quote.otherAmountThreshold), priceImpactPct, route },
  };
}
