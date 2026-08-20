import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAttestedAssetScanner } from '../asset-collector/scanner';
import { PORTFOLIO_NETWORKS } from './portfolio-networks';
import { scanWalletPortfolio } from './wallet-portfolio';

vi.mock('../asset-collector/scanner', () => ({ createAttestedAssetScanner: vi.fn() }));

const wallet = { id: 'wallet-1', chain: 'EVM' as const, address: '0x0000000000000000000000000000000000000001' };
const native = { id: 'native', chain: 'EVM' as const, address: wallet.address, asset: 'native' as const, symbol: 'ETH', balance: '1', estimatedFee: '0.001', status: 'ready' as const };
const scanAsset = vi.fn();
const scanWalletAssets = vi.fn();

describe('wallet portfolio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scanWalletAssets.mockResolvedValue([native]);
    vi.mocked(createAttestedAssetScanner).mockResolvedValue({ scanAsset, scanWalletAssets });
  });

  it('creates an attested network scanner and labels a registered Token', async () => {
    scanAsset.mockResolvedValue({ ...native, id: 'token', asset: 'token', symbol: 'ERC-20', token: '0x0000000000000000000000000000000000000002', decimals: 6, balance: '2' });
    const ethereum = PORTFOLIO_NETWORKS.find(network => network.id === 'ethereum')!;
    const result = await scanWalletPortfolio(wallet, [{ id: 'token-1', walletId: wallet.id, chain: 'EVM', symbol: 'USDC', address: '0x0000000000000000000000000000000000000002', decimals: 6 }], ethereum);
    expect(createAttestedAssetScanner).toHaveBeenCalledWith('EVM', expect.objectContaining({ id: 'ethereum', evmChainId: '0x1' }));
    expect(scanWalletAssets).toHaveBeenCalledWith({ address: wallet.address }, 0);
    expect(result.assets.map(asset => asset.symbol)).toEqual(['ETH', 'USDC']);
  });

  it('does not duplicate a Solana token that was already discovered', async () => {
    const mint = '11111111111111111111111111111111';
    scanWalletAssets.mockResolvedValue([{ ...native, chain: 'SOL', symbol: 'SOL' }, { ...native, id: 'spl', chain: 'SOL', asset: 'token', symbol: 'SPL', token: mint, decimals: 0 }]);
    const devnet = PORTFOLIO_NETWORKS.find(network => network.id === 'solana-devnet')!;
    const result = await scanWalletPortfolio({ ...wallet, chain: 'SOL', address: mint }, [{ id: 'token-1', walletId: wallet.id, chain: 'SOL', symbol: 'NFT1', address: mint, decimals: 0 }], devnet);
    expect(scanAsset).not.toHaveBeenCalled();
    expect(result.assets[1]?.symbol).toBe('NFT1');
  });

  it('skips corrupted, duplicate and unrelated public Token metadata', async () => {
    const result = await scanWalletPortfolio(wallet, [
      { id: 'bad', walletId: wallet.id, chain: 'EVM', symbol: 'BAD TOKEN', address: 'bad', decimals: 99 },
      { id: 'other', walletId: 'wallet-2', chain: 'EVM', symbol: 'USDC', address: '0x0000000000000000000000000000000000000002', decimals: 6 },
    ]);
    expect(result).toMatchObject({ assets: [native], skipped: 2 });
    expect(scanAsset).not.toHaveBeenCalled();
  });

  it('rejects selecting a network from another wallet family before any RPC call', async () => {
    const solana = PORTFOLIO_NETWORKS.find(network => network.id === 'solana-mainnet')!;
    await expect(scanWalletPortfolio(wallet, [], solana)).rejects.toThrow('链类型不匹配');
    expect(createAttestedAssetScanner).not.toHaveBeenCalled();
  });
});
