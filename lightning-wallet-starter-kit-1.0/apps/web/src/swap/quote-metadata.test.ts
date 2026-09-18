import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSwapTokenMetadata } from './quote';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('swap token metadata identity', () => {
  it('treats Solana and TRON identifiers as case-sensitive', async () => {
    const token = 'So11111111111111111111111111111111111111112';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { chain: 'SOL', token: token.toLowerCase(), decimals: 9, source: 'Solana RPC', verifiedAt: new Date().toISOString() } }), { status: 200 })));
    await expect(fetchSwapTokenMetadata('SOL', token)).rejects.toThrow('响应无效');
  });

  it('accepts EVM checksum-case differences for the same address', async () => {
    const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { chain: 'EVM', chainId: 1, token: token.toLowerCase(), decimals: 6, source: 'EVM RPC', verifiedAt: new Date().toISOString() } }), { status: 200 })));
    await expect(fetchSwapTokenMetadata('EVM', token, 1)).resolves.toMatchObject({ decimals: 6 });
  });

  it('rejects metadata from a different EVM chain', async () => {
    const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { chain: 'EVM', chainId: 56, token, decimals: 6, source: 'EVM RPC', verifiedAt: new Date().toISOString() } }), { status: 200 })));
    await expect(fetchSwapTokenMetadata('EVM', token, 1)).rejects.toThrow('响应无效');
  });
});
