import type { FlashLoanAuditJob, FlashLoanHistoryItem } from './types';

const KEY = 'lightning-client-flash-loan-history-v1';
const MAX_ITEMS = 50;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function isFlashLoanJob(value: unknown): value is FlashLoanAuditJob {
  if (!isRecord(value) || !isText(value.id) || !value.id.startsWith('local-') || value.kind !== 'flash-loan') return false;
  if (!isText(value.status) || !isText(value.created_at) || !isText(value.updated_at) || !isRecord(value.payload) || !isRecord(value.result)) return false;
  return value.payload.network === 'sepolia' && value.payload.dryRun === true
    && isText(value.payload.clientRecordId) && isText(value.payload.externalCreatedAt)
    && ['dry-run', 'failed', 'rejected'].includes(String(value.result.status))
    && value.result.transactionHash === null && value.result.broadcast === false
    && value.result.serverSigning === false && value.result.serverBroadcast === false;
}

export function flashLoanLocalJob(item: FlashLoanHistoryItem): FlashLoanAuditJob {
  const now = new Date().toISOString();
  return {
    id: `local-${item.id}`,
    kind: 'flash-loan',
    status: item.status === 'failed' ? 'failed' : 'completed',
    payload: {
      clientRecordId: item.id,
      externalCreatedAt: item.createdAt,
      network: 'sepolia',
      ...(item.walletAddress ? { walletAddress: item.walletAddress } : {}),
      ...(item.protocol ? { protocol: item.protocol } : {}),
      ...(item.asset ? { asset: item.asset } : {}),
      ...(item.amount ? { amount: item.amount } : {}),
      dryRun: true,
    },
    result: { status: item.status, transactionHash: null, broadcast: false, serverSigning: false, serverBroadcast: false },
    created_at: item.createdAt,
    updated_at: now,
  };
}

export function loadLocalFlashLoanHistory(storage: Pick<Storage, 'getItem'> = localStorage): FlashLoanAuditJob[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isFlashLoanJob).slice(0, MAX_ITEMS) : [];
  } catch { return []; }
}

export function saveLocalFlashLoanJob(job: FlashLoanAuditJob, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): FlashLoanAuditJob[] {
  const jobs = [job, ...loadLocalFlashLoanHistory(storage).filter(item => item.id !== job.id)].slice(0, MAX_ITEMS);
  storage.setItem(KEY, JSON.stringify(jobs));
  return jobs;
}
