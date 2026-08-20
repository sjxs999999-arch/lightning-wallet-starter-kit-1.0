import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmedWalletAction } from './guard';
import { fetchQuotes } from './quote';
import { executeSwap } from './executor';
import type { SwapRequest } from './types';

const request: SwapRequest = { chain: 'SOL', sellToken: 'a', buyToken: 'b', sellAmount: '1', taker: '11111111111111111111111111111111', slippageBps: 50 };
const response = { data: [{ provider: 'test', amountIn: '1', amountOut: '2', minReceived: '1', priceImpactPct: 0, route: [], raw: {} }] };

describe('swap resilience', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('rejects before wallet access while either mainnet Swap gate is closed', async () => {
    vi.stubEnv('VITE_MAINNET_EXECUTION_ENABLED', 'true');
    vi.stubEnv('VITE_ENABLE_MAINNET_SWAP', 'false');
    await expect(executeSwap(request, response.data[0]!)).rejects.toThrow(/双重生产开关/);
  });
  it('does not broadcast when the user rejects wallet signature', async () => {
    const broadcast = vi.fn(async () => 'hash');
    await expect(confirmedWalletAction(() => false, broadcast)).rejects.toThrow('用户取消');
    expect(broadcast).not.toHaveBeenCalled();
  });
  it('times out a stalled quote request', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => { (init as RequestInit).signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError'))); })));
    await expect(fetchQuotes(request, 5)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('reports an empty route response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })));
    await expect(fetchQuotes(request)).rejects.toThrow('没有返回可用路线');
  });
  it('uses the HttpOnly session and CSRF guard for the same-origin quote API', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, json: async () => response }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchQuotes(request, 1000);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/swap/quotes');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include', headers: { 'x-lightning-csrf': '1' } });
    expect(JSON.stringify(fetchMock.mock.calls[0]?.[1])).not.toMatch(/authorization|session-token/i);
  });
  it('handles 100 quote responses with low average client overhead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })));
    const started = performance.now();
    for (let index = 0; index < 100; index++) await fetchQuotes(request);
    const average = (performance.now() - started) / 100;
    expect(average).toBeLessThan(10);
    console.info(`PERF SWAP QUOTES 100 AVG: ${average.toFixed(3)}ms`);
  });
});
