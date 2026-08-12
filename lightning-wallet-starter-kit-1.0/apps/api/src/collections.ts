import { z } from 'zod';
import { operationId } from './adapters.js';
import { transferResultSchema } from './transfers.js';
import type { TransferStore } from './transfers.js';

const publicIdentifier = z.string().trim().min(20).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const nonNegativeAmount = z.string().regex(/^\d+(?:\.\d{1,30})?$/).refine(value => Number.isFinite(Number(value)) && Number(value) >= 0);
const positiveAmount = nonNegativeAmount.refine(value => Number(value) > 0);

const collectionTaskSchema = z.object({
  id: z.string().regex(/^0x[0-9a-f]{64}$/i),
  address: publicIdentifier,
  destination: publicIdentifier,
  amount: positiveAmount,
  assetKind: z.enum(['native', 'token']),
  symbol: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9._-]+$/),
  token: publicIdentifier.optional(),
  decimals: z.number().int().min(0).max(30).optional(),
  estimatedFee: nonNegativeAmount,
}).strict().superRefine((task, context) => {
  if (task.assetKind === 'token' && !task.token) context.addIssue({ code: 'custom', path: ['token'], message: 'Token address is required' });
  if (task.assetKind === 'native' && task.token) context.addIssue({ code: 'custom', path: ['token'], message: 'Native collection cannot include a token address' });
});

export const collectionPlanSchema = z.object({
  idempotencyKey: z.string().uuid(),
  chain: z.enum(['EVM', 'SOL', 'TRON']),
  dryRun: z.boolean(),
  destination: publicIdentifier,
  tasks: z.array(collectionTaskSchema).min(1).max(1000),
}).strict().superRefine((plan, context) => {
  plan.tasks.forEach((task, index) => {
    if (task.destination !== plan.destination) context.addIssue({ code: 'custom', path: ['tasks', index, 'destination'], message: 'Task destination does not match the plan' });
  });
});

export const collectionJobIdSchema = z.string().uuid();
export const collectionHistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

function summaryOf(value: z.infer<typeof collectionPlanSchema>) {
  return {
    chain: value.chain,
    dryRun: value.dryRun,
    destination: value.destination,
    count: value.tasks.length,
    nativeCount: value.tasks.filter(task => task.assetKind === 'native').length,
    tokenCount: value.tasks.filter(task => task.assetKind === 'token').length,
  };
}

export async function createCollectionJob(db: TransferStore, input: unknown) {
  const value = collectionPlanSchema.parse(input);
  const id = operationId();
  const summary = summaryOf(value);
  const payload = { ...summary, tasks: value.tasks };
  const result = { dryRun: value.dryRun, serverSigning: false, serverBroadcast: false, confirmed: 0, failed: 0, pending: value.tasks.length, outcomes: [] };
  const rows = await db.query("INSERT INTO operation_jobs(id,kind,status,idempotency_key,payload,result) VALUES($1,'asset-collection','validated',$2,$3,$4) ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=operation_jobs.updated_at RETURNING id,kind,status,created_at,updated_at", [id, value.idempotencyKey, payload, result]);
  return { ...rows.rows[0], payload: summary, result };
}

export async function updateCollectionJob(db: TransferStore, id: string, input: unknown) {
  collectionJobIdSchema.parse(id);
  const value = transferResultSchema.parse(input);
  const existing = await db.query("SELECT payload FROM operation_jobs WHERE id=$1 AND kind='asset-collection'", [id]);
  const payload = existing.rows[0]?.payload as { chain?: unknown; dryRun?: unknown; destination?: unknown; count?: unknown; nativeCount?: unknown; tokenCount?: unknown } | undefined;
  if (!payload || Number(payload.count) !== value.outcomes.length) return null;
  const confirmed = value.outcomes.filter(item => item.status === 'confirmed').length;
  const failed = value.outcomes.filter(item => item.status === 'failed').length;
  const pending = value.outcomes.filter(item => item.status === 'pending').length;
  const skipped = value.outcomes.filter(item => item.status === 'skipped').length;
  const status = pending > 0 ? 'paused' : failed === 0 ? 'completed' : confirmed > 0 ? 'partial' : 'failed';
  const result = { dryRun: payload.dryRun === true, serverSigning: false, serverBroadcast: false, broadcastByWallet: payload.dryRun !== true && confirmed > 0, confirmed, failed, pending, skipped, outcomes: value.outcomes };
  const rows = await db.query("UPDATE operation_jobs SET status=$2,result=$3,updated_at=now() WHERE id=$1 AND kind='asset-collection' RETURNING id,kind,status,created_at,updated_at", [id, status, result]);
  const summary = { chain: payload.chain, dryRun: payload.dryRun, destination: payload.destination, count: payload.count, nativeCount: payload.nativeCount, tokenCount: payload.tokenCount };
  return rows.rows[0] ? { ...rows.rows[0], payload: summary, result } : null;
}

export async function listCollectionJobs(db: TransferStore, input: unknown) {
  const { limit } = collectionHistoryQuerySchema.parse(input);
  const rows = await db.query("SELECT id,kind,status,jsonb_build_object('chain',payload->'chain','dryRun',payload->'dryRun','destination',payload->'destination','count',payload->'count','nativeCount',payload->'nativeCount','tokenCount',payload->'tokenCount') AS payload,jsonb_build_object('dryRun',result->'dryRun','serverSigning',false,'serverBroadcast',false,'broadcastByWallet',result->'broadcastByWallet','confirmed',result->'confirmed','failed',result->'failed','pending',result->'pending','skipped',result->'skipped') AS result,created_at,updated_at FROM operation_jobs WHERE kind='asset-collection' ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.rows;
}
