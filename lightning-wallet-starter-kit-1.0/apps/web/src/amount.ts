const decimalPattern = /^\d+(?:\.\d+)?$/;

export function formatAtomic(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) throw new Error('Invalid decimal scale');
  if (decimals === 0) return value.toString();
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const raw = absolute.toString().padStart(decimals + 1, '0');
  const formatted = `${raw.slice(0, -decimals)}.${raw.slice(-decimals)}`.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return negative ? `-${formatted}` : formatted;
}

export function sumDecimals(values: string[]): string {
  if (!values.length) return '0';
  const parsed = values.map(value => {
    if (!decimalPattern.test(value)) throw new Error('Invalid decimal value');
    const [whole, fraction = ''] = value.split('.');
    if (fraction.length > 30) throw new Error('Decimal precision exceeds 30 places');
    return { whole: whole!, fraction };
  });
  const scale = Math.max(...parsed.map(value => value.fraction.length));
  const total = parsed.reduce((sum, value) => sum + BigInt(`${value.whole}${value.fraction.padEnd(scale, '0')}`), 0n);
  return formatAtomic(total, scale);
}
