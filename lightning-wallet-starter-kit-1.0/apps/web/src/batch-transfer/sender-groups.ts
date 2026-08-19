import type { TransferChain, TransferTask } from './types';

function normalizedSender(chain: TransferChain, address: string): string {
  return chain === 'EVM' ? address.toLowerCase() : address;
}

export function senderCount(tasks: TransferTask[]): number {
  return new Set(tasks.map(task => normalizedSender(task.chain, task.from))).size;
}

export function tasksForActiveSender(tasks: TransferTask[], activeAddress: string): TransferTask[] {
  if (!tasks.length) return [];
  const chain = tasks[0]!.chain;
  const active = normalizedSender(chain, activeAddress);
  return tasks.filter(task => task.chain === chain && normalizedSender(chain, task.from) === active);
}

export function pendingSenderCount(tasks: TransferTask[]): number {
  return senderCount(tasks.filter(task => task.status === 'pending' || task.status === 'failed'));
}
