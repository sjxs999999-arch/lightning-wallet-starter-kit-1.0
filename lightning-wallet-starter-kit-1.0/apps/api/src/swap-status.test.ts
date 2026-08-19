import { describe, expect, it } from 'vitest';
import { swapProviderAvailability } from './swap.js';

describe('swap provider availability', () => {
  it('reports missing provider configuration without exposing credentials', () => {
    const result = swapProviderAvailability({});
    expect(result).toEqual([
      { chain: 'EVM', available: false, provider: '0x', reason: 'EVM 聚合报价服务尚未配置' },
      { chain: 'SOL', available: true, provider: 'Jupiter' },
      { chain: 'TRON', available: false, provider: 'SunSwap adapter', reason: 'TRON 聚合报价服务尚未配置' },
    ]);
  });

  it('reports configured providers but never returns their secrets or URLs', () => {
    const result = swapProviderAvailability({ ZEROX_API_KEY: 'secret-key', TRON_SWAP_PROVIDER_URL: 'https://provider.example/private' });
    expect(result.every(item => item.available)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret-key|provider\.example/);
  });
});
