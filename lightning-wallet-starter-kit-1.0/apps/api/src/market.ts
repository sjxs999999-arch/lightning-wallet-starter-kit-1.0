import { z } from 'zod';
import { config } from './config.js';

export const marketChain = z.enum(['EVM', 'SOL', 'TRON']);
export type MarketChain = z.infer<typeof marketChain>;

const chainMap: Record<MarketChain, string> = { EVM: 'ethereum', SOL: 'solana', TRON: 'tron' };
const geckoMap: Record<MarketChain, string> = { EVM: 'eth', SOL: 'solana', TRON: 'tron' };

async function getJson(url: string, timeout = 7_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'LightningWallet/1.0' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function normalizePair(pair: any, chain: MarketChain) {
  return {
    chain,
    address: String(pair?.baseToken?.address ?? ''),
    name: String(pair?.baseToken?.name ?? 'Unknown token'),
    symbol: String(pair?.baseToken?.symbol ?? '—'),
    quoteSymbol: String(pair?.quoteToken?.symbol ?? '—'),
    pairAddress: String(pair?.pairAddress ?? ''),
    dexId: String(pair?.dexId ?? ''),
    url: String(pair?.url ?? ''),
    priceUsd: number(pair?.priceUsd),
    marketCap: number(pair?.marketCap),
    fdv: number(pair?.fdv),
    liquidityUsd: number(pair?.liquidity?.usd),
    volume24h: number(pair?.volume?.h24),
    priceChange24h: number(pair?.priceChange?.h24),
    buys24h: number(pair?.txns?.h24?.buys),
    sells24h: number(pair?.txns?.h24?.sells),
    updatedAt: new Date().toISOString(),
    readOnly: true as const,
  };
}

export function normalizeHistory(payload: any) {
  return (payload?.data?.attributes?.ohlcv_list ?? [])
    .map((row: unknown[]) => ({ time: Number(row[0]), open: number(row[1]), high: number(row[2]), low: number(row[3]), close: number(row[4]), volume: number(row[5]) }))
    .filter((row: { time: number; close: number | null }) => Number.isFinite(row.time) && row.time > 0 && row.close !== null)
    .sort((left: { time: number }, right: { time: number }) => left.time - right.time);
}

export function normalizeTrades(payload: any, tokenAddress: string) {
  const evmToken = tokenAddress.startsWith('0x');
  const matchesToken = (value: unknown) => evmToken
    ? String(value ?? '').toLowerCase() === tokenAddress.toLowerCase()
    : String(value ?? '') === tokenAddress;
  return (payload?.data ?? []).slice(0, 100).map((item: any) => {
    const side = String(item?.attributes?.kind ?? 'unknown');
    const price = matchesToken(item?.attributes?.from_token_address)
      ? item?.attributes?.price_from_in_usd
      : matchesToken(item?.attributes?.to_token_address)
        ? item?.attributes?.price_to_in_usd
        : side === 'buy' ? item?.attributes?.price_to_in_usd : item?.attributes?.price_from_in_usd;
    return {
      id: String(item?.id ?? ''),
      side,
      priceUsd: number(price),
      volumeUsd: number(item?.attributes?.volume_in_usd),
      txHash: String(item?.attributes?.tx_hash ?? ''),
      time: String(item?.attributes?.block_timestamp ?? ''),
    };
  }).filter((item: { id: string }) => item.id.length > 0);
}

export async function searchMarket(query: string, chain?: MarketChain) {
  const payload: any = await getJson(`${config.MARKET_DEXSCREENER_URL}/latest/dex/search?q=${encodeURIComponent(query)}`);
  return (payload.pairs ?? [])
    .filter((pair: any) => !chain || pair.chainId === chainMap[chain])
    .slice(0, 20)
    .map((pair: any) => normalizePair(pair, chain ?? (pair.chainId === 'solana' ? 'SOL' : pair.chainId === 'tron' ? 'TRON' : 'EVM')));
}

export async function tokenMarket(chain: MarketChain, address: string) {
  const payload: any = await getJson(`${config.MARKET_DEXSCREENER_URL}/tokens/v1/${chainMap[chain]}/${encodeURIComponent(address)}`);
  const pairs = Array.isArray(payload) ? payload : payload.pairs ?? [];
  if (!pairs.length) return null;
  const best = [...pairs].sort((left: any, right: any) => (Number(right?.liquidity?.usd) || 0) - (Number(left?.liquidity?.usd) || 0))[0];
  return normalizePair(best, chain);
}

export async function marketHistory(chain: MarketChain, pool: string, token: string) {
  return normalizeHistory(await getJson(`${config.MARKET_GECKOTERMINAL_URL}/networks/${geckoMap[chain]}/pools/${encodeURIComponent(pool)}/ohlcv/hour?aggregate=1&limit=100&currency=usd&token=${encodeURIComponent(token)}`));
}

export async function marketTrades(chain: MarketChain, pool: string, token: string) {
  return normalizeTrades(await getJson(`${config.MARKET_GECKOTERMINAL_URL}/networks/${geckoMap[chain]}/pools/${encodeURIComponent(pool)}/trades?token=${encodeURIComponent(token)}`), token);
}

export async function holderData(chain: MarketChain, address: string) {
  if (!config.MARKET_HOLDER_PROVIDER_URL) return { status: 'unavailable' as const, holderCount: null, topHolders: [] };
  const payload: any = await getJson(`${config.MARKET_HOLDER_PROVIDER_URL}?chain=${chain}&address=${encodeURIComponent(address)}`);
  return {
    status: 'available' as const,
    holderCount: number(payload.holderCount),
    topHolders: Array.isArray(payload.topHolders)
      ? payload.topHolders.slice(0, 20).map((holder: any) => ({ address: String(holder.address), balance: String(holder.balance), sharePct: number(holder.sharePct) }))
      : [],
  };
}
