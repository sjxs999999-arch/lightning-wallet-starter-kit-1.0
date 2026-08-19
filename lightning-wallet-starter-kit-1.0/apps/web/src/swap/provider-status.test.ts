import { describe, expect, it } from 'vitest';
import { fallbackSwapProviderAvailability } from './provider-status';

describe('swap provider status fallback', () => {
  it('keeps only the public Jupiter quote path available when status cannot be read', () => {
    const result = fallbackSwapProviderAvailability();
    expect(result.find(item => item.chain === 'SOL')).toMatchObject({ available: true, provider: 'Jupiter' });
    expect(result.filter(item => item.chain !== 'SOL').every(item => !item.available)).toBe(true);
  });
});
