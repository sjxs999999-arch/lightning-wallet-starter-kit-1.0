import { describe, expect, it } from 'vitest';
import { swapProviderAvailability } from './swap.js';

describe('swap provider availability', () => {
  it('keeps the public LI.FI EVM provider available without exposing credentials', () => {
    const result = swapProviderAvailability({});
    expect(result).toEqual([
      { chain: 'EVM', available: true, provider: 'LI.FI' },
      { chain: 'SOL', available: true, provider: 'Jupiter' },
      { chain: 'TRON', available: true, provider: 'SUN.io Smart Router' },
    ]);
  });

  it('reports configured providers but never returns their secrets', () => {
    const result = swapProviderAvailability({ ZEROX_API_KEY: 'secret-key' });
    expect(result.every(item => item.available)).toBe(true);
    expect(result[0]?.provider).toBe('LI.FI + 0x');
    expect(JSON.stringify(result)).not.toMatch(/secret-key/);
  });
});
