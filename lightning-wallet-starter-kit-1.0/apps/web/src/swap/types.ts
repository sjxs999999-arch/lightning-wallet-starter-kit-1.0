export type SwapChain = 'EVM' | 'SOL' | 'TRON';

export interface SwapAmountDisplay {
  amountIn: string;
  amountOut: string;
  minReceived: string;
  sellSymbol: string;
  buySymbol: string;
  sellDecimals: number;
  buyDecimals: number;
  usdValuationAvailable: boolean;
}

export interface SwapCandidate {
  provider: string;
  amountIn: string;
  amountOut: string;
  minReceived: string;
  priceImpactPct: number;
  route: string[];
  allowanceTarget?: string;
  transaction?: { to?: string; data?: string; value?: string; gas?: string; gasPrice?: string };
  feeUsd?: string;
  gasCostUsd?: string;
  expiresAt?: string;
  display?: SwapAmountDisplay;
  raw: unknown;
}

export interface SwapRequest {
  chain: SwapChain;
  chainId?: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  sellDecimals: number;
  taker: string;
  slippageBps: number;
}

export interface SwapTokenMetadata {
  chain: SwapChain;
  chainId?: number;
  token: string;
  decimals: number;
  symbol?: string;
  source: string;
  verifiedAt: string;
}

export interface SwapProviderAvailability { chain: SwapChain; available: boolean; provider: string; reason?: string }
