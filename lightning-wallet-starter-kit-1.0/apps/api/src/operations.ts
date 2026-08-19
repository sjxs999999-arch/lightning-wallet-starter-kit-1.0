import { z } from 'zod';
import type { Queryable } from './projects.js';

export const operationHistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }).strict();
const safeText = (value: unknown, max = 160) => typeof value === 'string' ? value.slice(0, max) : '';
const safeCount = (value: unknown) => Number.isInteger(Number(value)) && Number(value) >= 0 ? String(Number(value)) : '0';
const safeReference = (value: unknown, fallback: string) => typeof value === 'string' && /^[A-Za-z0-9:_-]{8,128}$/.test(value) ? value : fallback;

export function publicOperationActivity(row: Record<string, unknown>) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
  const result = row.result && typeof row.result === 'object' ? row.result as Record<string, unknown> : {};
  const id = safeText(row.id, 80);
  const kind = safeText(row.kind, 40);
  const base = { id, at: safeText(row.updated_at ?? row.created_at, 40), status: safeText(row.status, 40), reference: safeReference(result.txHash, id), amount: '' };
  if (kind === 'batch-transfer') return { ...base, module: '批量转账', network: safeText(payload.chain, 20), operation: `${safeText(payload.mode, 30)} · ${safeCount(payload.count)} 笔`, amount: safeText(payload.totalAmount, 100) };
  if (kind === 'asset-collection') return { ...base, module: '资产归集', network: safeText(payload.chain, 20), operation: `归集 ${safeCount(payload.count)} 项资产` };
  if (kind === 'swap') return { ...base, module: '闪电兑换', network: safeText(payload.chain, 20), operation: safeText(payload.provider, 80), amount: `${safeText(payload.amountIn, 100)} → ${safeText(payload.amountOut, 100)}` };
  if (kind === 'flash-loan') return { ...base, module: '闪电贷款', network: safeText(payload.network, 20), operation: `${safeText(payload.protocol, 40) || 'FlashForge'} · ${safeText(payload.asset, 40) || '—'}`, amount: safeText(payload.amount, 100) };
  if (kind === 'gas-estimate') return { ...base, module: 'GasFree', network: safeText(payload.network, 20) || 'Sepolia', operation: 'Gas 估算', amount: safeText(result.estimatedCostWei, 100) };
  if (kind === 'gas-sponsor') return { ...base, module: 'GasFree', network: 'Sepolia', operation: 'Sponsor 策略', amount: safeText(payload.estimatedCostWei, 100) };
  if (kind === 'launchpad-plan') return { ...base, module: 'Token Studio', network: safeText(payload.network, 30), operation: `${safeText(payload.chain, 20)} · ${safeText(payload.symbol, 20)}` };
  return null;
}

export async function listOperationActivity(db: Queryable, input: unknown) {
  const { limit } = operationHistoryQuerySchema.parse(input);
  const rows = await db.query("SELECT id,kind,status,payload,result,created_at,updated_at FROM operation_jobs WHERE kind = ANY($1::text[]) ORDER BY created_at DESC LIMIT $2", [['batch-transfer','asset-collection','swap','flash-loan','gas-estimate','gas-sponsor','launchpad-plan'], limit]);
  return rows.rows.map(publicOperationActivity).filter(Boolean);
}
