export type BridgeChain = {
  id: number;
  key: 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon' | 'solana';
  name: string;
  family: 'EVM' | 'SOL';
  nativeSymbol: string;
};

export type BridgeQuoteRequest = {
  fromChainId: number;
  toChainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  fromAddress: string;
  toAddress: string;
  slippageBps: number;
  order: 'CHEAPEST' | 'FASTEST';
};

export type BridgeTransaction = {
  family: 'EVM' | 'SOL';
  chainId: number;
  to?: string;
  data?: string;
  value?: string;
  gasLimit?: string;
  serialized?: string;
  simulated?: boolean;
  unitsConsumed?: number;
};

export type BridgeRoute = {
  id: string;
  provider: string;
  providerLabel: string;
  kind: 'aggregator' | 'official';
  fromAmount: string;
  toAmount?: string;
  toAmountMin?: string;
  feeUsd?: string;
  gasCostUsd?: string;
  durationSeconds?: number;
  priceImpactPct?: number;
  steps: string[];
  approvalAddress?: string;
  fromTokenAddress?: string;
  transaction?: BridgeTransaction;
  officialUrl?: string;
  expiresAt?: string;
  warnings: string[];
};

export const BRIDGE_CHAINS: BridgeChain[] = [
  { id: 1, key: 'ethereum', name: 'Ethereum', family: 'EVM', nativeSymbol: 'ETH' },
  { id: 42161, key: 'arbitrum', name: 'Arbitrum', family: 'EVM', nativeSymbol: 'ETH' },
  { id: 10, key: 'optimism', name: 'Optimism', family: 'EVM', nativeSymbol: 'ETH' },
  { id: 8453, key: 'base', name: 'Base', family: 'EVM', nativeSymbol: 'ETH' },
  { id: 137, key: 'polygon', name: 'Polygon', family: 'EVM', nativeSymbol: 'POL' },
  { id: 1_151_111_081_099_710, key: 'solana', name: 'Solana', family: 'SOL', nativeSymbol: 'SOL' },
];
