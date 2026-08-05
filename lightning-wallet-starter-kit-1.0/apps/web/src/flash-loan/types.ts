export type FlashLoanNetwork = 'sepolia';

export interface FlashLoanSettings {
  dryRun: true;
  theme: 'dark';
  network: FlashLoanNetwork;
}

export interface FlashLoanHistoryItem {
  id: string;
  createdAt: string;
  network: FlashLoanNetwork;
  walletAddress?: string;
  status: 'dry-run' | 'submitted' | 'confirmed' | 'failed' | 'rejected';
  transactionHash?: string;
  protocol?: string;
  asset?: string;
  amount?: string;
}

export interface FlashLoanContext {
  type: 'LIGHTNING_FLASH_LOAN_CONTEXT';
  version: 1;
  sessionToken: string;
  walletAddress?: string;
  settings: FlashLoanSettings;
}
