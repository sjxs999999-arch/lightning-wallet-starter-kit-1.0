import { describe, expect, it, vi } from 'vitest';
import { resolveSwapTokenMetadata } from './swap-token-metadata.js';

describe('swap token metadata', () => {
  it('reads TRC-20 decimals from a constant call without requesting wallet access', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ result: { result: true }, constant_result: ['0000000000000000000000000000000000000000000000000000000000000006'] }), { status: 200 }));
    await expect(resolveSwapTokenMetadata({ chain: 'TRON', token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' }, { fetcher })).resolves.toMatchObject({ chain: 'TRON', decimals: 6, source: 'TRON RPC' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://api.trongrid.io/wallet/triggerconstantcontract');
    expect(String(init?.body)).toContain('decimals()');
    expect(String(init?.body)).not.toMatch(/private|mnemonic|signature/i);
  });

  it('reads EVM decimals and symbol from the chain RPC instead of the quote provider', async () => {
    const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const symbol = `0x${'20'.padStart(64, '0')}${'4'.padStart(64, '0')}${Buffer.from('USDC').toString('hex').padEnd(64, '0')}`;
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { params: [{ data: string }] };
      const result = request.params[0].data === '0x313ce567' ? `0x${'6'.padStart(64, '0')}` : symbol;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
    });
    await expect(resolveSwapTokenMetadata({ chain: 'EVM', chainId: 1, token }, { fetcher, evmRpcUrls: ['https://rpc.example'] })).resolves.toMatchObject({ decimals: 6, symbol: 'USDC', source: 'EVM RPC' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://rpc.example');
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain('eth_call');
  });

  it('recognizes the EVM native-token sentinel without calling a contract', async () => {
    const fetcher = vi.fn();
    await expect(resolveSwapTokenMetadata({ chain: 'EVM', chainId: 56, token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' }, { fetcher })).resolves.toMatchObject({ decimals: 18, symbol: 'BNB', source: 'EVM RPC' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads SPL decimals from getTokenSupply', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ jsonrpc: '2.0', result: { value: { amount: '1', decimals: 9 } } }), { status: 200 }));
    await expect(resolveSwapTokenMetadata({ chain: 'SOL', token: 'So11111111111111111111111111111111111111112' }, { fetcher, solanaRpcUrls: ['https://rpc.example'] })).resolves.toMatchObject({ decimals: 9, source: 'Solana RPC' });
    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain('getTokenSupply');
  });
});
