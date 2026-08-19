import type { CollectionJob } from './persistence';

const KEY = 'lightning-client-collection-history-v1';
const MAX_ITEMS = 50;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;

function isCollectionJob(item: unknown): item is CollectionJob {
  if (!isRecord(item) || !isText(item.id) || !item.id.startsWith('local-') || item.kind !== 'asset-collection') return false;
  if (!['validated', 'paused', 'completed', 'partial', 'failed'].includes(String(item.status))) return false;
  if (!isText(item.created_at) || !isText(item.updated_at) || !isRecord(item.payload) || !isRecord(item.result)) return false;
  const payload = item.payload;
  const result = item.result;
  return isText(payload.chain) && typeof payload.dryRun === 'boolean' && isText(payload.destination)
    && isCount(payload.count) && isCount(payload.nativeCount) && isCount(payload.tokenCount)
    && typeof result.dryRun === 'boolean' && result.serverSigning === false && result.serverBroadcast === false
    && isCount(result.confirmed) && isCount(result.failed) && isCount(result.pending)
    && (result.skipped === undefined || isCount(result.skipped));
}

function safeJobs(value: unknown): CollectionJob[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isCollectionJob).slice(0, MAX_ITEMS);
}

export function loadLocalCollectionHistory(storage: Pick<Storage, 'getItem'> = localStorage): CollectionJob[] {
  try { return safeJobs(JSON.parse(storage.getItem(KEY) ?? '[]')); }
  catch { return []; }
}

export function saveLocalCollectionJob(job: CollectionJob, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): CollectionJob[] {
  const jobs = [job, ...loadLocalCollectionHistory(storage).filter(item => item.id !== job.id)].slice(0, MAX_ITEMS);
  storage.setItem(KEY, JSON.stringify(jobs));
  return jobs;
}
