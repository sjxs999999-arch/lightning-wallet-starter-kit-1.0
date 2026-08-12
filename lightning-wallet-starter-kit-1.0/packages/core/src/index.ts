export type ChainFamily = 'evm' | 'solana' | 'tron';
export type ChainId = 'ethereum' | 'bsc' | 'polygon' | 'base' | 'arbitrum' | 'optimism' | 'avalanche' | 'solana' | 'tron';
export interface ChainConfig { id: ChainId; name: string; family: ChainFamily; nativeSymbol: string; enabled: boolean }
export interface WalletAccount { id: string; address: string; chain: ChainId; label: string; createdAt: string }
export interface TransferRequest { chain: ChainId; fromWalletId: string; to: string; asset: string; amount: string; idempotencyKey: string }
export interface BatchTransferRequest { mode: 'one-to-many' | 'many-to-one' | 'many-to-many'; transfers: TransferRequest[]; dryRun?: boolean }
export interface QuoteRequest { chain: ChainId; sellToken: string; buyToken: string; amount: string; slippageBps: number }
export interface Quote { provider: string; amountIn: string; amountOut: string; route: string[]; expiresAt: string }
export const chains: ChainConfig[] = [
  { id: 'ethereum', name: 'Ethereum', family: 'evm', nativeSymbol: 'ETH', enabled: true },
  { id: 'bsc', name: 'BNB Chain', family: 'evm', nativeSymbol: 'BNB', enabled: true },
  { id: 'polygon', name: 'Polygon', family: 'evm', nativeSymbol: 'POL', enabled: true },
  { id: 'base', name: 'Base', family: 'evm', nativeSymbol: 'ETH', enabled: true },
  { id: 'arbitrum', name: 'Arbitrum', family: 'evm', nativeSymbol: 'ETH', enabled: true },
  { id: 'optimism', name: 'Optimism', family: 'evm', nativeSymbol: 'ETH', enabled: true },
  { id: 'avalanche', name: 'Avalanche C-Chain', family: 'evm', nativeSymbol: 'AVAX', enabled: true },
  { id: 'solana', name: 'Solana', family: 'solana', nativeSymbol: 'SOL', enabled: true },
  { id: 'tron', name: 'TRON', family: 'tron', nativeSymbol: 'TRX', enabled: true }
];
