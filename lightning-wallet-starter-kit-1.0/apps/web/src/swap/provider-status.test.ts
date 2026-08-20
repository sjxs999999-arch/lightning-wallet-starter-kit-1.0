import { describe, expect, it } from 'vitest';
import { fallbackSwapProviderAvailability } from './provider-status';

describe('swap provider status fallback', () => {
  it('keeps public LI.FI, Jupiter and SUN.io quote paths available when status cannot be read', () => {
    const result = fallbackSwapProviderAvailability();
    expect(result.find(item => item.chain === 'SOL')).toMatchObject({ available: true, provider: 'Jupiter' });
    expect(result.find(item => item.chain === 'TRON')).toMatchObject({ available: true, provider: 'SUN.io Smart Router' });
    expect(result.find(item => item.chain === 'EVM')).toMatchObject({ available: true, provider: 'LI.FI' });
  });
});
