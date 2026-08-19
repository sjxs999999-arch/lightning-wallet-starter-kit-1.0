import type { SwapProviderAvailability } from './types';

export function fallbackSwapProviderAvailability(): SwapProviderAvailability[] {
  return [
    { chain: 'EVM', available: false, provider: '0x', reason: 'EVM 报价状态尚未确认' },
    { chain: 'SOL', available: true, provider: 'Jupiter' },
    { chain: 'TRON', available: false, provider: 'SunSwap adapter', reason: 'TRON 报价状态尚未确认' },
  ];
}
