import type { DirectScanNetwork } from '../asset-collector/scanner';
import type { BatchChain } from '../batch-wallet/types';

export type PortfolioNetworkId = 'sepolia' | 'ethereum' | 'bsc' | 'polygon' | 'base' | 'arbitrum' | 'solana-devnet' | 'solana-mainnet' | 'tron-nile' | 'tron-shasta' | 'tron-mainnet';

export interface PortfolioNetwork extends DirectScanNetwork {
  id: PortfolioNetworkId;
  chain: BatchChain;
  label: string;
  nativeSymbol: string;
  scope: 'testnet' | 'mainnet';
}

const urls = (primary: string, fallbacks = '') => [primary, ...fallbacks.split(',')]
  .map(value => value.trim().replace(/\/$/, ''))
  .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);

export const PORTFOLIO_NETWORKS: readonly PortfolioNetwork[] = [
  { id: 'sepolia', chain: 'EVM', label: 'Ethereum Sepolia', nativeSymbol: 'ETH', scope: 'testnet', evmChainId: '0xaa36a7', rpcUrls: urls(import.meta.env.VITE_LOCAL_EVM_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org') },
  { id: 'ethereum', chain: 'EVM', label: 'Ethereum Mainnet', nativeSymbol: 'ETH', scope: 'mainnet', evmChainId: '0x1', rpcUrls: urls(import.meta.env.VITE_PORTFOLIO_ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com', import.meta.env.VITE_PORTFOLIO_ETHEREUM_RPC_FALLBACK_URLS || 'https://eth.llamarpc.com') },
  { id: 'bsc', chain: 'EVM', label: 'BNB Smart Chain', nativeSymbol: 'BNB', scope: 'mainnet', evmChainId: '0x38', rpcUrls: urls(import.meta.env.VITE_PORTFOLIO_BSC_RPC_URL || 'https://bsc-rpc.publicnode.com') },
  { id: 'polygon', chain: 'EVM', label: 'Polygon', nativeSymbol: 'POL', scope: 'mainnet', evmChainId: '0x89', rpcUrls: urls(import.meta.env.VITE_PORTFOLIO_POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com') },
  { id: 'base', chain: 'EVM', label: 'Base', nativeSymbol: 'ETH', scope: 'mainnet', evmChainId: '0x2105', rpcUrls: urls(import.meta.env.VITE_PORTFOLIO_BASE_RPC_URL || 'https://base-rpc.publicnode.com') },
  { id: 'arbitrum', chain: 'EVM', label: 'Arbitrum One', nativeSymbol: 'ETH', scope: 'mainnet', evmChainId: '0xa4b1', rpcUrls: urls(import.meta.env.VITE_PORTFOLIO_ARBITRUM_RPC_URL || 'https://arbitrum-one-rpc.publicnode.com') },
  { id: 'solana-devnet', chain: 'SOL', label: 'Solana Devnet', nativeSymbol: 'SOL', scope: 'testnet', solanaGenesis: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', rpcUrls: urls(import.meta.env.VITE_LOCAL_SOLANA_RPC_URL || 'https://api.devnet.solana.com') },
  { id: 'solana-mainnet', chain: 'SOL', label: 'Solana Mainnet', nativeSymbol: 'SOL', scope: 'mainnet', solanaGenesis: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', rpcUrls: urls(import.meta.env.VITE_PORTFOLIO_SOLANA_MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com', import.meta.env.VITE_PORTFOLIO_SOLANA_MAINNET_RPC_FALLBACK_URLS || 'https://solana-rpc.publicnode.com,https://solana.drpc.org') },
  { id: 'tron-nile', chain: 'TRON', label: 'TRON Nile', nativeSymbol: 'TRX', scope: 'testnet', tronHosts: ['nile.trongrid.io', 'api.nileex.io'], rpcUrls: urls(import.meta.env.VITE_LOCAL_TRON_RPC_URL || 'https://nile.trongrid.io') },
  { id: 'tron-shasta', chain: 'TRON', label: 'TRON Shasta', nativeSymbol: 'TRX', scope: 'testnet', tronHosts: ['api.shasta.trongrid.io'], rpcUrls: urls(import.meta.env.VITE_PORTFOLIO_TRON_SHASTA_RPC_URL || 'https://api.shasta.trongrid.io') },
  { id: 'tron-mainnet', chain: 'TRON', label: 'TRON Mainnet', nativeSymbol: 'TRX', scope: 'mainnet', tronHosts: ['api.trongrid.io'], rpcUrls: urls(import.meta.env.VITE_PORTFOLIO_TRON_MAINNET_RPC_URL || 'https://api.trongrid.io') },
] as const;

export function portfolioNetworks(chain: BatchChain) {
  return PORTFOLIO_NETWORKS.filter(network => network.chain === chain);
}

export function defaultPortfolioNetwork(chain: BatchChain) {
  const network = PORTFOLIO_NETWORKS.find(item => item.chain === chain && item.scope === 'testnet');
  if (!network) throw new Error(`没有可用的 ${chain} 只读资产网络`);
  return network;
}
