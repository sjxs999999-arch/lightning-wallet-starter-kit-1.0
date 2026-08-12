import { z } from 'zod';
import { operationId } from './adapters.js';
import type { TransferStore } from './transfers.js';

const publicIdentifier = z.string().trim().min(20).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const rawAmount = z.string().regex(/^\d{1,100}$/).refine(value => BigInt(value) > 0n);
const provider = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9 ._:/-]+$/);

export const swapQuoteInputSchema = z.object({
  chain: z.enum(['EVM', 'SOL', 'TRON']),
  chainId: z.number().int().positive().optional(),
  sellToken: publicIdentifier,
  buyToken: publicIdentifier,
  sellAmount: rawAmount,
  taker: publicIdentifier,
  slippageBps: z.number().int().min(1).max(500),
}).strict().superRefine((value, context) => {
  if (value.chain === 'EVM' && !value.chainId) context.addIssue({ code: 'custom', path: ['chainId'], message: 'EVM quote requires a chain ID' });
  if (value.chain !== 'EVM' && value.chainId) context.addIssue({ code: 'custom', path: ['chainId'], message: 'Only EVM quotes use a chain ID' });
  if (value.sellToken === value.buyToken) context.addIssue({ code: 'custom', path: ['buyToken'], message: 'Swap tokens must differ' });
});

export const swapPlanSchema = z.object({
  idempotencyKey: z.string().uuid(),
  chain: z.enum(['EVM', 'SOL', 'TRON']),
  dryRun: z.boolean(),
  taker: publicIdentifier,
  sellToken: publicIdentifier,
  buyToken: publicIdentifier,
  sellAmount: rawAmount,
  slippageBps: z.number().int().min(1).max(500),
  provider,
  amountIn: rawAmount,
  amountOut: rawAmount,
  minReceived: rawAmount,
  priceImpactPct: z.number().finite().min(0).max(5),
  route: z.array(provider).max(12),
}).strict();

export const swapResultSchema = z.object({
  status: z.enum(['simulated', 'submitted', 'failed']),
  txHash: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/).optional(),
  errorCode: z.enum(['USER_REJECTED', 'VALIDATION_ERROR', 'PROVIDER_ERROR', 'BROADCAST_ERROR', 'UNKNOWN_ERROR']).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'submitted' && !value.txHash) context.addIssue({ code: 'custom', path: ['txHash'], message: 'Submitted swap requires a public transaction reference' });
  if (value.status === 'failed' && !value.errorCode) context.addIssue({ code: 'custom', path: ['errorCode'], message: 'Failed swap requires a safe error code' });
  if (value.status === 'simulated' && (value.txHash || value.errorCode)) context.addIssue({ code: 'custom', path: ['status'], message: 'Simulation cannot include a transaction or error' });
});

export const swapJobIdSchema = z.string().uuid();
export const swapHistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

function summaryOf(value: z.infer<typeof swapPlanSchema>) {
  return { chain: value.chain, dryRun: value.dryRun, taker: value.taker, sellToken: value.sellToken, buyToken: value.buyToken, sellAmount: value.sellAmount, slippageBps: value.slippageBps, provider: value.provider, amountIn: value.amountIn, amountOut: value.amountOut, minReceived: value.minReceived, priceImpactPct: value.priceImpactPct, route: value.route };
}

export async function createSwapJob(db: TransferStore, input: unknown) {
  const value = swapPlanSchema.parse(input);
  const id = operationId();
  const payload = summaryOf(value);
  const result = { dryRun: value.dryRun, serverSigning: false, serverBroadcast: false, status: 'validated' };
  const rows = await db.query("INSERT INTO operation_jobs(id,kind,status,idempotency_key,payload,result) VALUES($1,'swap','validated',$2,$3,$4) ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=operation_jobs.updated_at RETURNING id,kind,status,created_at,updated_at", [id, value.idempotencyKey, payload, result]);
  return { ...rows.rows[0], payload, result };
}

export async function updateSwapJob(db: TransferStore, id: string, input: unknown) {
  swapJobIdSchema.parse(id);
  const value = swapResultSchema.parse(input);
  const existing = await db.query("SELECT payload FROM operation_jobs WHERE id=$1 AND kind='swap'", [id]);
  const payload = existing.rows[0]?.payload as { dryRun?: unknown } | undefined;
  if (!payload || (value.status === 'simulated' && payload.dryRun !== true) || (value.status === 'submitted' && payload.dryRun === true)) return null;
  const status = value.status === 'failed' ? 'failed' : 'completed';
  const result = { ...value, dryRun: payload.dryRun === true, serverSigning: false, serverBroadcast: false, broadcastByWallet: value.status === 'submitted' };
  const rows = await db.query("UPDATE operation_jobs SET status=$2,result=$3,updated_at=now() WHERE id=$1 AND kind='swap' RETURNING id,kind,status,created_at,updated_at", [id, status, result]);
  return rows.rows[0] ? { ...rows.rows[0], payload: existing.rows[0]!.payload, result } : null;
}

export async function listSwapJobs(db: TransferStore, input: unknown) {
  const { limit } = swapHistoryQuerySchema.parse(input);
  const rows = await db.query("SELECT id,kind,status,payload,jsonb_build_object('status',result->'status','dryRun',result->'dryRun','serverSigning',false,'serverBroadcast',false,'broadcastByWallet',result->'broadcastByWallet','txHash',result->'txHash','errorCode',result->'errorCode') AS result,created_at,updated_at FROM operation_jobs WHERE kind='swap' ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.rows;
}
