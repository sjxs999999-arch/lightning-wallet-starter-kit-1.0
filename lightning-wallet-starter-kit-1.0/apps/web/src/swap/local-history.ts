import type { SwapJob } from './persistence';

const KEY = 'lightning-client-swap-history-v1';
const MAX_ITEMS = 50;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isSwapJob(item: unknown): item is SwapJob {
  if (!isRecord(item) || !isText(item.id) || !item.id.startsWith('local-') || item.kind !== 'swap') return false;
  if (!['validated', 'completed', 'failed'].includes(String(item.status))) return false;
  if (!isText(item.created_at) || !isText(item.updated_at) || !isRecord(item.payload) || !isRecord(item.result)) return false;
  const payload = item.payload;
  const result = item.result;
  return isText(payload.chain) && typeof payload.dryRun === 'boolean' && isText(payload.taker)
    && isText(payload.sellToken) && isText(payload.buyToken) && isText(payload.sellAmount)
    && typeof payload.slippageBps === 'number' && isText(payload.provider) && isText(payload.amountIn)
    && isText(payload.amountOut) && isText(payload.minReceived) && typeof payload.priceImpactPct === 'number'
    && Array.isArray(payload.route) && payload.route.every(isText)
    && ['validated', 'simulated', 'submitted', 'failed'].includes(String(result.status))
    && typeof result.dryRun === 'boolean' && result.serverSigning === false && result.serverBroadcast === false;
}

function safeJobs(value: unknown): SwapJob[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSwapJob).slice(0, MAX_ITEMS);
}

export function loadLocalSwapHistory(storage: Pick<Storage, 'getItem'> = localStorage): SwapJob[] {
  try { return safeJobs(JSON.parse(storage.getItem(KEY) ?? '[]')); }
  catch { return []; }
}

export function saveLocalSwapJob(job: SwapJob, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): SwapJob[] {
  const jobs = [job, ...loadLocalSwapHistory(storage).filter(item => item.id !== job.id)].slice(0, MAX_ITEMS);
  storage.setItem(KEY, JSON.stringify(jobs));
  return jobs;
}
