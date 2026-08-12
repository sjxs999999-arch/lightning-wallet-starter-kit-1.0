import type { TransferPlan, TransferTask } from './types';

export type TransferErrorCode = 'USER_REJECTED' | 'VALIDATION_ERROR' | 'PROVIDER_ERROR' | 'BROADCAST_ERROR' | 'UNKNOWN_ERROR';
export type TransferOutcome = { id: string; status: 'pending' | 'confirmed' | 'failed' | 'skipped'; txHash?: string; errorCode?: TransferErrorCode };
export type TransferJob = {
  id: string;
  kind: 'batch-transfer';
  status: 'validated' | 'paused' | 'completed' | 'partial' | 'failed';
  payload: { chain: string; mode: string; dryRun: boolean; count: number; totalAmount: string; totalEstimatedFee: string };
  result: { dryRun: boolean; serverSigning: false; serverBroadcast: false; broadcastByWallet?: boolean; confirmed: number; failed: number; pending: number; skipped?: number };
  created_at: string;
  updated_at: string;
};

export function transferPlanPayload(plan: TransferPlan, idempotencyKey: string) {
  return {
    idempotencyKey,
    chain: plan.chain,
    mode: plan.mode,
    dryRun: plan.dryRun,
    totalAmount: plan.totalAmount,
    totalEstimatedFee: plan.totalEstimatedFee,
    tasks: plan.tasks.map(task => ({
      id: task.id,
      row: task.row,
      from: task.from,
      to: task.to,
      amount: task.amount,
      assetKind: task.assetKind,
      ...(task.token ? { token: task.token } : {}),
      ...(task.decimals !== undefined ? { decimals: task.decimals } : {}),
      estimatedFee: task.estimatedFee,
    })),
  };
}

export function safeErrorCode(message?: string): TransferErrorCode {
  if (!message) return 'UNKNOWN_ERROR';
  if (/取消|拒绝|reject|denied|declined/i.test(message)) return 'USER_REJECTED';
  if (/地址|金额|账户|不一致|校验|invalid|mismatch/i.test(message)) return 'VALIDATION_ERROR';
  if (/广播|send|transaction|rpc/i.test(message)) return 'BROADCAST_ERROR';
  if (/钱包|provider|connect|network/i.test(message)) return 'PROVIDER_ERROR';
  return 'UNKNOWN_ERROR';
}

function safeReference(task: TransferTask) {
  const value = task.txHash?.trim();
  return value && /^[A-Za-z0-9:_-]{8,128}$/.test(value) ? value : `CLIENT-REF-${task.id.slice(2, 18)}`;
}

export function transferResultPayload(tasks: TransferTask[]) {
  const outcomes: TransferOutcome[] = tasks.map(task => {
    if (task.status === 'confirmed') return { id: task.id, status: 'confirmed', txHash: safeReference(task) };
    if (task.status === 'failed') return { id: task.id, status: 'failed', errorCode: safeErrorCode(task.error) };
    if (task.status === 'skipped') return { id: task.id, status: 'skipped' };
    return { id: task.id, status: 'pending' };
  });
  return { outcomes };
}
