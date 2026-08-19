import { loadLocalCollectionHistory } from '../asset-collector/local-history';
import { loadLocalTransferHistory } from '../batch-transfer/local-history';
import { loadLocalFlashLoanHistory } from '../flash-loan/local-history';
import { loadLocalGasHistory } from '../gasfree/local-history';
import { loadLocalSwapHistory } from '../swap/local-history';
import { loadProviderHistory } from '../wallet-providers/history';

export type ActivityItem = { id: string; at: string; module: string; network: string; operation: string; status: string; amount: string; reference: string };

export function loadLocalActivity(): ActivityItem[] {
  const provider = loadProviderHistory().map(row => ({ id: `provider-${row.id}`, at: row.at, module: '钱包连接', network: row.network, operation: `${row.wallet} · ${row.operation}`, status: row.status, amount: '', reference: row.hash ?? row.address }));
  const transfers = loadLocalTransferHistory().map(job => ({ id: job.id, at: job.updated_at, module: '批量转账', network: job.payload.chain, operation: `${job.payload.mode} · ${job.payload.count} 笔`, status: job.status, amount: job.payload.totalAmount, reference: job.id }));
  const collections = loadLocalCollectionHistory().map(job => ({ id: job.id, at: job.updated_at, module: '资产归集', network: job.payload.chain, operation: `归集 ${job.payload.count} 项资产`, status: job.status, amount: '', reference: job.id }));
  const swaps = loadLocalSwapHistory().map(job => ({ id: job.id, at: job.updated_at, module: '闪电兑换', network: job.payload.chain, operation: job.payload.provider, status: job.result.status, amount: `${job.payload.amountIn} → ${job.payload.amountOut}`, reference: job.result.txHash ?? job.id }));
  const flashLoans = loadLocalFlashLoanHistory().map(job => ({ id: job.id, at: job.updated_at, module: '闪电贷款', network: job.payload.network, operation: `${job.payload.protocol ?? 'FlashForge'} · ${job.payload.asset ?? '—'}`, status: job.result.status, amount: job.payload.amount ?? '', reference: job.id }));
  const gas = loadLocalGasHistory().map(job => ({ id: job.id, at: job.updated_at, module: 'GasFree', network: job.payload.network ?? 'Sepolia', operation: { 'gas-estimate': 'Gas 估算', 'gas-sponsor': 'Sponsor 策略', 'gas-topup': '补充 Gas' }[job.kind], status: job.status, amount: job.payload.topUpWei ?? job.payload.estimatedCostWei ?? '', reference: job.result.txHash ?? job.id }));
  return [...provider, ...transfers, ...collections, ...swaps, ...flashLoans, ...gas].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 500);
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function activityCsv(items: ActivityItem[]): string {
  return ['time,module,network,operation,status,amount,reference', ...items.map(item => [item.at, item.module, item.network, item.operation, item.status, item.amount, item.reference].map(csvCell).join(','))].join('\n');
}

export function downloadActivityCsv(items: ActivityItem[]) {
  const blob = new Blob([activityCsv(items)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `lightning-wallet-activity-${Date.now()}.csv`; link.click();
  URL.revokeObjectURL(url);
}
