import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Queryable } from './projects.js';

const requestSchema = z.object({ network: z.literal('sepolia'), dryRun: z.literal(true) }).strict();
const userSchema = z.object({ sub: z.string().min(1), role: z.literal('operator') });

export const flashLoanHistorySchema = z.object({
  id: z.string().min(1).max(80).regex(/^[A-Za-z0-9:_-]+$/),
  createdAt: z.string().datetime(),
  network: z.literal('sepolia'),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  status: z.enum(['dry-run', 'failed', 'rejected']),
  transactionHash: z.preprocess(value => value === '' ? undefined : value, z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional()),
  protocol: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9 ._-]+$/).optional(),
  asset: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/).optional(),
  amount: z.string().regex(/^\d{1,78}(?:\.\d{1,30})?$/).optional(),
}).strict().refine(value => !value.transactionHash, { message: 'Dry Run history cannot contain a transaction hash', path: ['transactionHash'] });

export const flashLoanHistoryQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();

export function flashLoanSessionClaims(body: unknown, user: unknown) {
  const request = requestSchema.parse(body);
  const identity = userSchema.parse(user);
  return { sub: identity.sub, aud: 'flash-loan', scope: ['wallet:public', 'history:metadata'], network: request.network, dryRun: true as const };
}

export async function recordFlashLoanHistory(db: Queryable, input: unknown) {
  const value = flashLoanHistorySchema.parse(input);
  const id = randomUUID();
  const payload = { clientRecordId: value.id, externalCreatedAt: value.createdAt, network: 'sepolia', walletAddress: value.walletAddress, protocol: value.protocol, asset: value.asset, amount: value.amount, dryRun: true };
  const result = { status: value.status, transactionHash: null, broadcast: false, serverSigning: false, serverBroadcast: false };
  const rows = await db.query("INSERT INTO operation_jobs(id,kind,status,idempotency_key,payload,result) VALUES($1,'flash-loan',$2,$3,$4,$5) ON CONFLICT(idempotency_key) DO UPDATE SET updated_at=operation_jobs.updated_at RETURNING id,kind,status,created_at,updated_at", [id, value.status === 'failed' ? 'failed' : 'completed', `flash-loan:${value.id}`, payload, result]);
  const row = rows.rows[0] ?? {};
  return { ...row, id: String(row.id ?? id), payload, result };
}

export async function listFlashLoanHistory(db: Queryable, input: unknown) {
  const { limit } = flashLoanHistoryQuerySchema.parse(input);
  const rows = await db.query("SELECT id,kind,status,jsonb_build_object('clientRecordId',payload->'clientRecordId','externalCreatedAt',payload->'externalCreatedAt','network',payload->'network','walletAddress',payload->'walletAddress','protocol',payload->'protocol','asset',payload->'asset','amount',payload->'amount','dryRun',payload->'dryRun') AS payload,jsonb_build_object('status',result->'status','transactionHash',null,'broadcast',false,'serverSigning',false,'serverBroadcast',false) AS result,created_at,updated_at FROM operation_jobs WHERE kind='flash-loan' ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows.rows;
}
