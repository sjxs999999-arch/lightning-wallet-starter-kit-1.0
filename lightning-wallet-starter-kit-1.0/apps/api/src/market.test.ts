import { describe, expect, it } from 'vitest';
import { normalizeGoPlusHolders, normalizeHistory, normalizePair, normalizeTrades } from './market.js';

describe('market normalization', () => {
  it('returns read-only public metrics without sensitive material', () => {
    const result = normalizePair({ baseToken: { address: '0x1', name: 'Token', symbol: 'TOK' }, quoteToken: { symbol: 'USDC' }, priceUsd: '1.2', liquidity: { usd: 900 }, txns: { h24: { buys: 3, sells: 2 } } }, 'EVM');
    expect(result).toMatchObject({ address: '0x1', priceUsd: 1.2, liquidityUsd: 900, readOnly: true });
    expect(JSON.stringify(result)).not.toMatch(/privateKey|mnemonic|signature/i);
  });

  it('normalizes valid candles in chronological order', () => {
    const result = normalizeHistory({ data: { attributes: { ohlcv_list: [[20, '2', '3', '1', '2.5', '8'], [10, '1', '2', '.5', '1.5', '5'], ['bad', 1, 1, 1, 1, 1]] } } });
    expect(result).toEqual([
      { time: 10, open: 1, high: 2, low: 0.5, close: 1.5, volume: 5 },
      { time: 20, open: 2, high: 3, low: 1, close: 2.5, volume: 8 },
    ]);
  });

  it('uses the base-token price for both buy and sell trades', () => {
    const result = normalizeTrades({ data: [
      { id: 'buy-1', attributes: { kind: 'sell', from_token_address: '0xusdc', to_token_address: '0xWETH', price_from_in_usd: '1', price_to_in_usd: '1900', volume_in_usd: '90', tx_hash: '0xbuy', block_timestamp: '2026-01-01T00:00:00Z' } },
      { id: 'sell-1', attributes: { kind: 'buy', from_token_address: '0xWETH', to_token_address: '0xusdc', price_from_in_usd: '1910', price_to_in_usd: '1', volume_in_usd: '100', tx_hash: '0xsell', block_timestamp: '2026-01-01T00:01:00Z' } },
    ] }, '0xweth');
    expect(result.map((item: { priceUsd: number | null }) => item.priceUsd)).toEqual([1900, 1910]);
    expect(JSON.stringify(result)).not.toMatch(/tx_from_address|private|signature/i);
  });

  it('normalizes public GoPlus holder counts and fractional ownership percentages', () => {
    const result = normalizeGoPlusHolders({ code: 1, result: { token: { holder_count: '1234', holders: [
      { address: '0x37305b1cd40574e4c5ce33f8e8306be057fd7341', balance: '4093844026.662287', percent: '0.081428799012144361' },
      { account: '7VHUFJHWu2CuExkJcJrzhQPJ2oygupTWkL2A2For4BmE', balance: '100.5', percent: '0.001' },
      { address: 'invalid', balance: '1', percent: '0.5' },
    ] } } }, 'token');
    expect(result).toEqual({ status: 'available', holderCount: 1234, source: 'GoPlus Security', topHolders: [
      { address: '0x37305b1cd40574e4c5ce33f8e8306be057fd7341', balance: '4093844026.662287', sharePct: 8.1428799 },
      { address: '7VHUFJHWu2CuExkJcJrzhQPJ2oygupTWkL2A2For4BmE', balance: '100.5', sharePct: 0.1 },
    ] });
  });

  it('fails closed instead of assigning another token holder result to the requested token', () => {
    expect(() => normalizeGoPlusHolders({ code: 1, result: { other: { holder_count: '1', holders: [] } } }, 'requested')).toThrow(/NOT_FOUND/);
  });
});
