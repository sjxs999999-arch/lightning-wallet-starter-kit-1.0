import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLocalTestnetScanProfile, scanAsset, scanWalletAssets } from '../asset-collector/scanner';
import { scanLocalWalletPortfolio } from './wallet-portfolio';

vi.mock('../asset-collector/scanner', () => ({
  assertLocalTestnetScanProfile: vi.fn(),
  scanWalletAssets: vi.fn(),
  scanAsset: vi.fn(),
}));

const wallet = { id: 'wallet-1', chain: 'EVM' as const, address: '0x0000000000000000000000000000000000000001' };
const native = { id: 'native', chain: 'EVM' as const, address: wallet.address, asset: 'native' as const, symbol: 'ETH', balance: '1', estimatedFee: '0.001', status: 'ready' as const };

describe('local wallet portfolio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(scanWalletAssets).mockResolvedValue([native]);
  });

  it('attests the testnet before scanning and labels an explicitly registered token', async () => {
    vi.mocked(scanAsset).mockResolvedValue({ ...native, id: 'token', asset: 'token', symbol: 'ERC-20', token: '0x0000000000000000000000000000000000000002', decimals: 6, balance: '2' });
    const result = await scanLocalWalletPortfolio(wallet, [{ id: 'token-1', walletId: wallet.id, chain: 'EVM', symbol: 'USDC', address: '0x0000000000000000000000000000000000000002', decimals: 6 }]);
    expect(assertLocalTestnetScanProfile).toHaveBeenCalledWith('EVM');
    expect(scanWalletAssets).toHaveBeenCalledWith('EVM', { address: wallet.address }, 0, 'local-testnet');
    expect(result.assets.map(asset => asset.symbol)).toEqual(['ETH', 'USDC']);
  });

  it('does not duplicate a Solana token that was already discovered', async () => {
    const mint = '11111111111111111111111111111111';
    vi.mocked(scanWalletAssets).mockResolvedValue([{ ...native, chain: 'SOL', symbol: 'SOL' }, { ...native, id: 'spl', chain: 'SOL', asset: 'token', symbol: 'SPL', token: mint, decimals: 0 }]);
    const result = await scanLocalWalletPortfolio({ ...wallet, chain: 'SOL', address: mint }, [{ id: 'token-1', walletId: wallet.id, chain: 'SOL', symbol: 'NFT1', address: mint, decimals: 0 }]);
    expect(scanAsset).not.toHaveBeenCalled();
    expect(result.assets[1]?.symbol).toBe('NFT1');
  });

  it('skips corrupted, duplicate and unrelated public Token metadata', async () => {
    const result = await scanLocalWalletPortfolio(wallet, [
      { id: 'bad', walletId: wallet.id, chain: 'EVM', symbol: 'BAD TOKEN', address: 'bad', decimals: 99 },
      { id: 'other', walletId: 'wallet-2', chain: 'EVM', symbol: 'USDC', address: '0x0000000000000000000000000000000000000002', decimals: 6 },
    ]);
    expect(result).toMatchObject({ assets: [native], skipped: 2 });
    expect(scanAsset).not.toHaveBeenCalled();
  });
});
