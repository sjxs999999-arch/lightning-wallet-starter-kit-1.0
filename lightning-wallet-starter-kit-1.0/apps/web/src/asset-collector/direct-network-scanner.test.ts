import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDirectScanNetwork, createAttestedAssetScanner } from './scanner';

const response = (data: unknown) => ({ ok: true, json: async () => data });

describe('direct read-only network scanner', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('attests an exact EVM Chain ID before returning a reusable scanner', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ result: '0x38' }))
      .mockResolvedValueOnce(response({ result: '0xde0b6b3a7640000' }))
      .mockResolvedValueOnce(response({ result: '0x3b9aca00' }));
    vi.stubGlobal('fetch', fetchMock);
    const scanner = await createAttestedAssetScanner('EVM', { rpcUrls: ['https://bsc.example.test'], evmChainId: '0x38' });
    await expect(scanner.scanWalletAssets({ address: '0x0000000000000000000000000000000000000001' }, 0)).resolves.toMatchObject([{ symbol: 'ETH', balance: '1', status: 'ready' }]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).method).toBe('eth_chainId');
  });

  it('rejects an EVM network mismatch before any balance request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ result: '0x1' })));
    await expect(createAttestedAssetScanner('EVM', { rpcUrls: ['https://wrong.example.test'], evmChainId: '0x38' })).rejects.toThrow('Chain ID 不匹配');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('requires the exact Solana genesis', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ result: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' })));
    await expect(assertDirectScanNetwork('SOL', { rpcUrls: ['https://sol.example.test'], solanaGenesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' })).resolves.toBeUndefined();
  });

  it('rejects a TRON RPC host from another network without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(assertDirectScanNetwork('TRON', { rpcUrls: ['https://api.trongrid.io'], tronHosts: ['nile.trongrid.io'] })).rejects.toThrow('允许列表');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
