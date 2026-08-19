import type { CollectorTask } from './types';

function normalized(task: CollectorTask, address: string): string {
  return task.chain === 'EVM' ? address.toLowerCase() : address;
}

export function collectorSenderCount(tasks: CollectorTask[]): number {
  return new Set(tasks.map(task => normalized(task, task.address))).size;
}

export function collectorTasksForActiveSender(tasks: CollectorTask[], activeAddress: string): CollectorTask[] {
  if (!tasks.length) return [];
  const active = normalized(tasks[0]!, activeAddress);
  return tasks.filter(task => task.chain === tasks[0]!.chain && normalized(task, task.address) === active);
}
