import type { TransferTask } from '../batch-transfer/types';
import type { CollectorTask } from './types';

export function collectorTransferTask(task: CollectorTask, row: number): TransferTask {
  return {
    id: task.id,
    row,
    chain: task.chain,
    assetKind: task.asset,
    from: task.address,
    to: task.destination,
    amount: task.collectAmount,
    status: 'running',
    attempts: task.attempts,
    estimatedFee: task.estimatedFee,
    ...(task.token ? { token: task.token } : {}),
    ...(task.decimals !== undefined ? { decimals: task.decimals } : {}),
  };
}
