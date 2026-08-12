import { fetchQuotes } from './quote';
import type { SwapRequest } from './types';

self.onmessage = async (event: MessageEvent<{ request: SwapRequest }>) => {
  try { postMessage({ type: 'quotes', candidates: await fetchQuotes(event.data.request, 10_000) }); }
  catch (error) { postMessage({ type: 'error', message: error instanceof Error ? (error.name === 'AbortError' ? '报价请求超时，请稍后重试' : error.message) : '聚合报价失败' }); }
};
