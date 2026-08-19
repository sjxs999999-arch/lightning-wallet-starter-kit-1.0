import { safeErrorCode } from '../batch-transfer/persistence';
import type { TransferOutcome } from '../batch-transfer/persistence';
import { isPositiveDecimal } from '../amount';
import type { CollectorTask } from './types';

export type CollectionJob = {
  id: string;
  kind: 'asset-collection';
  status: 'validated' | 'paused' | 'completed' | 'partial' | 'failed';
  payload: { chain: string; dryRun: boolean; destination: string; count: number; nativeCount: number; tokenCount: number };
  result: { dryRun: boolean; serverSigning: false; serverBroadcast: false; broadcastByWallet?: boolean; confirmed: number; failed: number; pending: number; skipped?: number };
  created_at: string;
  updated_at: string;
};

const collectable = (tasks: CollectorTask[]) => tasks.filter(task => isPositiveDecimal(task.collectAmount));

export function collectionPlanPayload(tasks: CollectorTask[], dryRun: boolean, idempotencyKey: string) {
  const eligible = collectable(tasks);
  if (!eligible.length) throw new Error('没有可归集任务');
  const destination = eligible[0]!.destination;
  return {
    idempotencyKey,
    chain: eligible[0]!.chain,
    dryRun,
    destination,
    tasks: eligible.map(task => ({
      id: task.id,
      address: task.address,
      destination: task.destination,
      amount: task.collectAmount,
      assetKind: task.asset,
      symbol: task.symbol,
      ...(task.token ? { token: task.token } : {}),
      ...(task.decimals !== undefined ? { decimals: task.decimals } : {}),
      estimatedFee: task.estimatedFee,
    })),
  };
}

function safeReference(task: CollectorTask) {
  const value = task.txHash?.trim();
  return value && /^[A-Za-z0-9:_-]{8,128}$/.test(value) ? value : `CLIENT-COLLECT-${task.id.slice(2, 18)}`;
}

export function collectionResultPayload(tasks: CollectorTask[]) {
  const outcomes: TransferOutcome[] = collectable(tasks).map(task => {
    if (task.executionStatus === 'confirmed') return { id: task.id, status: 'confirmed', txHash: safeReference(task) };
    if (task.executionStatus === 'failed') return { id: task.id, status: 'failed', errorCode: safeErrorCode(task.error) };
    if (task.executionStatus === 'skipped') return { id: task.id, status: 'skipped' };
    return { id: task.id, status: 'pending' };
  });
  return { outcomes };
}
