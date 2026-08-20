import { describe, expect, it } from 'vitest';
import { PORTFOLIO_NETWORKS, portfolioNetworks } from './portfolio-networks';

describe('wallet portfolio network catalog', () => {
  it('covers the frozen EVM, Solana and TRON read-only networks', () => {
    expect(PORTFOLIO_NETWORKS.map(network => network.id)).toEqual([
      'sepolia', 'ethereum', 'bsc', 'polygon', 'base', 'arbitrum',
      'solana-devnet', 'solana-mainnet', 'tron-nile', 'tron-shasta', 'tron-mainnet',
    ]);
    expect(portfolioNetworks('EVM').map(network => network.evmChainId)).toEqual(['0xaa36a7', '0x1', '0x38', '0x89', '0x2105', '0xa4b1']);
  });

  it('keeps each TRON profile on its exact allowed host', () => {
    for (const network of portfolioNetworks('TRON')) {
      expect(network.rpcUrls.every(url => network.tronHosts?.includes(new URL(url).hostname))).toBe(true);
    }
  });

  it('marks seven production networks as read-only mainnets', () => {
    expect(PORTFOLIO_NETWORKS.filter(network => network.scope === 'mainnet')).toHaveLength(7);
  });
});
