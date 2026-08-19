import type { SwapJob } from './persistence';

const KEY = 'lightning-client-swap-history-v1';
const MAX_ITEMS = 50;

function safeJobs(value: unknown): SwapJob[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SwapJob => Boolean(item && typeof item === 'object' && String((item as SwapJob).id).startsWith('local-'))).slice(0, MAX_ITEMS);
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
