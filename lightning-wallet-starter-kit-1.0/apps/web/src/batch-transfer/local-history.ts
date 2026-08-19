import type { TransferJob } from './persistence';

const KEY = 'lightning-client-transfer-history-v1';
const MAX_ITEMS = 50;

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;

function isTransferJob(item: unknown): item is TransferJob {
  if (!isRecord(item) || !isText(item.id) || !item.id.startsWith('local-') || item.kind !== 'batch-transfer') return false;
  if (!['validated', 'paused', 'completed', 'partial', 'failed'].includes(String(item.status))) return false;
  if (!isText(item.created_at) || !isText(item.updated_at) || !isRecord(item.payload) || !isRecord(item.result)) return false;
  const payload = item.payload;
  const result = item.result;
  return isText(payload.chain) && isText(payload.mode) && typeof payload.dryRun === 'boolean'
    && isCount(payload.count) && typeof payload.totalAmount === 'string' && typeof payload.totalEstimatedFee === 'string'
    && typeof result.dryRun === 'boolean' && result.serverSigning === false && result.serverBroadcast === false
    && isCount(result.confirmed) && isCount(result.failed) && isCount(result.pending)
    && (result.skipped === undefined || isCount(result.skipped));
}

function safeJobs(value: unknown): TransferJob[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isTransferJob).slice(0, MAX_ITEMS);
}

export function loadLocalTransferHistory(storage: Pick<Storage, 'getItem'> = localStorage): TransferJob[] {
  try { return safeJobs(JSON.parse(storage.getItem(KEY) ?? '[]')); }
  catch { return []; }
}

export function saveLocalTransferJob(job: TransferJob, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): TransferJob[] {
  const jobs = [job, ...loadLocalTransferHistory(storage).filter(item => item.id !== job.id)].slice(0, MAX_ITEMS);
  storage.setItem(KEY, JSON.stringify(jobs));
  return jobs;
}
