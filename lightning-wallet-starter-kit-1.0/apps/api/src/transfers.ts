import { z } from 'zod';
import { operationId } from './adapters.js';

const publicIdentifier = z.string().trim().min(20).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const positiveAmount = z.string().regex(/^\d+(?:\.\d{1,30})?$/).refine(value => Number(value) > 0);
const taskSchema = z.object({
  id: z.string().regex(/^0x[0-9a-f]{64}$/i),
  row: z.number().int().min(2).max(1001),
  from: publicIdentifier,
  to: publicIdentifier,
  amount: positiveAmount,
  assetKind: z.enum(['native', 'token']),
  token: publicIdentifier.optional(),
  decimals: z.number().int().min(0).max(30).optional(),
  estimatedFee: positiveAmount,
}).strict().superRefine((task, context) => {
  if (task.assetKind === 'token' && !task.token) context.addIssue({ code: 'custom', path: ['token'], message: 'Token address is required' });
  if (task.assetKind === 'native' && task.token) context.addIssue({ code: 'custom', path: ['token'], message: 'Native transfer cannot include a token address' });
});

export const transferPlanSchema = z.object({
  idempotencyKey: z.string().uuid(),
  chain: z.enum(['EVM', 'SOL', 'TRON']),
  mode: z.enum(['one-to-many', 'many-to-one', 'many-to-many']),
  dryRun: z.boolean(),
  totalAmount: positiveAmount,
  totalEstimatedFee: positiveAmount,
  tasks: z.array(taskSchema).min(1).max(1000),
}).strict();

const outcomeSchema = z.object({
  id: z.string().regex(/^0x[0-9a-f]{64}$/i),
  status: z.enum(['pending', 'confirmed', 'failed', 'skipped']),
  txHash: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/).optional(),
  errorCode: z.enum(['USER_REJECTED', 'VALIDATION_ERROR', 'PROVIDER_ERROR', 'BROADCAST_ERROR', 'UNKNOWN_ERROR']).optional(),
}).strict().superRefine((outcome, context) => {
  if (outcome.status === 'confirmed' && !outcome.txHash) context.addIssue({ code: 'custom', path: ['txHash'], message: 'Confirmed outcome requires a transaction reference' });
  if (outcome.status === 'failed' && !outcome.errorCode) context.addIssue({ code: 'custom', path: ['errorCode'], message: 'Failed outcome requires an error code' });
});

export const transferResultSchema = z.object({ outcomes: z.array(outcomeSchema).min(1).max(1000) }).strict();
export const transferJobIdSchema = z.string().uuid();
export const transferHistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export interface TransferStore { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

export async function createTransferJob(db: TransferStore, input: unknown) {
  const value = transferPlanSchema.parse(input);
  const id = operationId();
  const summary = {
    chain: value.chain,
    mode: value.mode,
    dryRun: value.dryRun,
    count: value.tasks.length,
    totalAmount: value.totalAmount,
    totalEstimatedFee: value.totalEstimatedFee,
  };
  const payload = { ...summary, tasks: value.tasks };
  const result = { dryRun: value.dryRun, serverSigning: false, serverBroadcast: false, confirmed: 0, failed: 0, pending: value.tasks.length, outcomes: [] };
  const rows = await db.query("INSERT INTO operation_jobs(id,kind,status,idempotency_key,payload,result) VALUES($1,'batch-transfer','validated',$2,$3,$4) ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=operation_jobs.updated_at RETURNING id,kind,status,created_at,updated_at", [id, value.idempotencyKey, payload, result]);
  return { ...rows.rows[0], payload: summary, result };
}

export async function updateTransferJob(db: TransferStore, id: string, input: unknown) {
  transferJobIdSchema.parse(id);
  const value = transferResultSchema.parse(input);
  const existing = await db.query("SELECT payload FROM operation_jobs WHERE id=$1 AND kind='batch-transfer'", [id]);
  const payload = existing.rows[0]?.payload as { chain?: unknown; mode?: unknown; count?: unknown; dryRun?: unknown; totalAmount?: unknown; totalEstimatedFee?: unknown } | undefined;
  if (!payload || Number(payload.count) !== value.outcomes.length) return null;
  const confirmed = value.outcomes.filter(item => item.status === 'confirmed').length;
  const failed = value.outcomes.filter(item => item.status === 'failed').length;
  const pending = value.outcomes.filter(item => item.status === 'pending').length;
  const skipped = value.outcomes.filter(item => item.status === 'skipped').length;
  const status = pending > 0 ? 'paused' : failed === 0 ? 'completed' : confirmed > 0 ? 'partial' : 'failed';
  const result = { dryRun: payload.dryRun === true, serverSigning: false, serverBroadcast: false, broadcastByWallet: payload.dryRun !== true && confirmed > 0, confirmed, failed, pending, skipped, outcomes: value.outcomes };
  const rows = await db.query("UPDATE operation_jobs SET status=$2,result=$3,updated_at=now() WHERE id=$1 AND kind='batch-transfer' RETURNING id,kind,status,created_at,updated_at", [id, status, result]);
  const summary = { chain: payload.chain, mode: payload.mode, dryRun: payload.dryRun, count: payload.count, totalAmount: payload.totalAmount, totalEstimatedFee: payload.totalEstimatedFee };
  return rows.rows[0] ? { ...rows.rows[0], payload: summary, result } : null;
}

export async function listTransferJobs(db: TransferStore, input: unknown) {
  const { limit } = transferHistoryQuerySchema.parse(input);
  const rows = await db.query("SELECT id,kind,status,jsonb_build_object('chain',payload->'chain','mode',payload->'mode','dryRun',payload->'dryRun','count',payload->'count','totalAmount',payload->'totalAmount','totalEstimatedFee',payload->'totalEstimatedFee') AS payload,jsonb_build_object('dryRun',result->'dryRun','serverSigning',false,'serverBroadcast',false,'broadcastByWallet',result->'broadcastByWallet','confirmed',result->'confirmed','failed',result->'failed','pending',result->'pending','skipped',result->'skipped') AS result,created_at,updated_at FROM operation_jobs WHERE kind='batch-transfer' ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.rows;
}
