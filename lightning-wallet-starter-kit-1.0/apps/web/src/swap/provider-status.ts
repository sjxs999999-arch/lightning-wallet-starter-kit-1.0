import type { SwapProviderAvailability } from './types';

export function fallbackSwapProviderAvailability(): SwapProviderAvailability[] {
  return [
    { chain: 'EVM', available: true, provider: 'LI.FI', reason: '服务状态接口暂时不可用；执行前必须重新确认报价' },
    { chain: 'SOL', available: true, provider: 'Jupiter' },
    { chain: 'TRON', available: true, provider: 'SUN.io Smart Router' },
  ];
}
