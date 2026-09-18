import type { SwapCandidate, SwapChain, SwapRequest, SwapTokenMetadata } from './types';

export function quoteApiBase(options: { configured?: string; production: boolean } = { configured: import.meta.env.VITE_API_URL, production: import.meta.env.PROD }) {
  return options.configured || (options.production ? '/api/v1' : 'http://localhost:3001/api/v1');
}

export async function fetchQuotes(request: SwapRequest, timeoutMs = 10_000): Promise<SwapCandidate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${quoteApiBase()}/swap/quotes`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-lightning-csrf': '1' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.message ?? body?.error ?? `Quote HTTP ${response.status}`);
    if (!Array.isArray(body.data) || !body.data.length) throw new Error('聚合器没有返回可用路线');
    return body.data;
  } finally { clearTimeout(timer); }
}

export async function fetchSwapTokenMetadata(chain: SwapChain, token: string, chainId?: number, signal?: AbortSignal): Promise<SwapTokenMetadata> {
  const query = new URLSearchParams({ chain, token, ...(chain === 'EVM' && chainId ? { chainId: String(chainId) } : {}) });
  const response = await fetch(`${quoteApiBase()}/swap/token-metadata?${query}`, { credentials: 'include', signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message ?? body?.error ?? `Token metadata HTTP ${response.status}`);
  const value = body?.data as SwapTokenMetadata | undefined;
  const tokenMatches = value && (chain === 'EVM' ? value.token.toLowerCase() === token.toLowerCase() : value.token === token);
  if (!value || value.chain !== chain || !tokenMatches || (chain === 'EVM' && value.chainId !== chainId) || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 30) throw new Error('Token 精度响应无效');
  return value;
}
