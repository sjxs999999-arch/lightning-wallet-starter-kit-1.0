import bs58 from 'bs58';
import { z } from 'zod';

const solanaAddress = z.string().trim().refine((value) => {
  try { return bs58.decode(value).length === 32; }
  catch { return false; }
}, 'Invalid Solana public key');

export const lpPositionInputSchema = z.object({
  protocol: z.literal('raydium'),
  owner: solanaAddress,
}).strict();

type UnknownRecord = Record<string, unknown>;
export type PublicLpPosition = {
  id: string;
  label: string;
  kind: string;
  stakedAmount?: string;
  pendingRewardCount: number;
};

const record = (value: unknown): UnknownRecord | null => value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
const shortText = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;
const publicAmount = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? value.slice(0, 100) : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : undefined;

function positionRows(value: unknown): UnknownRecord[] {
  const root = record(value);
  const data = root?.data ?? root?.result ?? value;
  if (Array.isArray(data)) return data.map(record).filter((item): item is UnknownRecord => Boolean(item)).slice(0, 100);
  const container = record(data);
  if (!container) return [];
  for (const key of ['positions', 'items', 'rows', 'stakePositions', 'farms']) {
    const candidate = container[key];
    if (Array.isArray(candidate)) return candidate.map(record).filter((item): item is UnknownRecord => Boolean(item)).slice(0, 100);
  }
  return [];
}

export function normalizeRaydiumPositions(owner: string, value: unknown) {
  const positions: PublicLpPosition[] = positionRows(value).map((item, index) => {
    const id = shortText(item.poolId ?? item.pool ?? item.ammId ?? item.farmId ?? item.id, `position-${index + 1}`);
    const label = shortText(item.poolName ?? item.name ?? item.symbol ?? item.lpSymbol, id);
    const kind = shortText(item.type ?? item.kind ?? item.version ?? item.program, 'Raydium LP / Stake');
    const rewards = item.pendingRewards ?? item.rewards ?? item.rewardInfos;
    const pendingRewardCount = Array.isArray(rewards) ? Math.min(rewards.length, 20) : record(rewards) ? Math.min(Object.keys(rewards as UnknownRecord).length, 20) : 0;
    const stakedAmount = publicAmount(item.stakedAmount ?? item.deposited ?? item.amount ?? item.lpAmount);
    return { id, label, kind, ...(stakedAmount ? { stakedAmount } : {}), pendingRewardCount };
  });
  return {
    protocol: 'raydium' as const,
    owner,
    positions,
    count: positions.length,
    rewardEntries: positions.reduce((total, item) => total + item.pendingRewardCount, 0),
    cached: true,
    source: 'Raydium Owner API',
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchPublicLpPositions(input: unknown) {
  const parsed = lpPositionInputSchema.parse(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(`https://owner-v1.raydium.io/position/stake/${encodeURIComponent(parsed.owner)}`, { headers: { accept: 'application/json' }, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404 || record(body)?.success === false) return normalizeRaydiumPositions(parsed.owner, []);
    if (!response.ok) throw new Error(`RAYDIUM_OWNER_HTTP_${response.status}`);
    return normalizeRaydiumPositions(parsed.owner, body);
  } finally { clearTimeout(timeout); }
}
