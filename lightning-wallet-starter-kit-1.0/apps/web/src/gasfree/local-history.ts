import type { GasAuditJob } from './types';

const KEY = 'lightning-client-gasfree-history-v1';
const MAX_ITEMS = 50;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isGasJob(value: unknown): value is GasAuditJob {
  if (!isRecord(value) || !isText(value.id) || !value.id.startsWith('local-')) return false;
  if (!['gas-estimate', 'gas-sponsor', 'gas-topup'].includes(String(value.kind)) || !isText(value.status)) return false;
  if (!isText(value.created_at) || !isText(value.updated_at) || !isRecord(value.payload) || !isRecord(value.result)) return false;
  return value.result.serverSigning === false && value.result.serverBroadcast === false;
}

export function loadLocalGasHistory(storage: Pick<Storage, 'getItem'> = localStorage): GasAuditJob[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isGasJob).slice(0, MAX_ITEMS) : [];
  } catch { return []; }
}

export function saveLocalGasJob(job: GasAuditJob, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): GasAuditJob[] {
  const jobs = [job, ...loadLocalGasHistory(storage).filter(item => item.id !== job.id)].slice(0, MAX_ITEMS);
  storage.setItem(KEY, JSON.stringify(jobs));
  return jobs;
}
