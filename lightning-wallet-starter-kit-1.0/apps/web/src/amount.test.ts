import { describe, expect, it } from 'vitest';
import { formatAtomic, isPositiveDecimal, sumDecimals } from './amount';

describe('exact asset amounts', () => {
  it('formats zero-decimal tokens without introducing a decimal point', () => {
    expect(formatAtomic(12345678901234567890n, 0)).toBe('12345678901234567890');
  });

  it('preserves values above Number.MAX_SAFE_INTEGER', () => {
    expect(sumDecimals(['9007199254740993.000001', '0.000009', '2'])).toBe('9007199254740995.00001');
  });

  it('keeps 30-place token precision', () => {
    expect(sumDecimals(['0.000000000000000000000000000001', '1'])).toBe('1.000000000000000000000000000001');
  });

  it('checks positive decimal values without floating-point conversion', () => {
    expect(isPositiveDecimal('0.000000000000000000000000000001')).toBe(true);
    expect(isPositiveDecimal('0.000000000000000000000000000000')).toBe(false);
    expect(isPositiveDecimal('not-a-number')).toBe(false);
  });
});
