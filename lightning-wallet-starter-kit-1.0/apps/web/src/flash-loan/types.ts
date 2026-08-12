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
  status: 'dry-run' | 'failed' | 'rejected';
  transactionHash?: string;
  protocol?: string;
  asset?: string;
  amount?: string;
}

export interface FlashLoanAuditJob {
  id: string;
  kind: 'flash-loan';
  status: string;
  payload: {clientRecordId:string;externalCreatedAt:string;network:FlashLoanNetwork;walletAddress?:string;protocol?:string;asset?:string;amount?:string;dryRun:true};
  result: {status:FlashLoanHistoryItem['status'];transactionHash:null;broadcast:false;serverSigning:false;serverBroadcast:false};
  created_at: string;
  updated_at: string;
}

export interface FlashLoanContext {
  type: 'LIGHTNING_FLASH_LOAN_CONTEXT';
  version: 1;
  sessionToken: string;
  walletAddress?: string;
  settings: FlashLoanSettings;
}
