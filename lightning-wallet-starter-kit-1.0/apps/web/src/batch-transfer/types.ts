export type TransferChain = 'EVM' | 'SOL' | 'TRON';
export type TransferMode = 'one-to-many' | 'many-to-one' | 'many-to-many';
export type AssetKind = 'native' | 'token';
export type TransferStatus = 'pending' | 'running' | 'paused' | 'submitted' | 'confirmed' | 'failed' | 'skipped';

export interface TransferInput { from: string; to: string; amount: string; token?: string; decimals?: number; }
export interface TransferTask extends TransferInput { id: string; row: number; chain: TransferChain; assetKind: AssetKind; status: TransferStatus; attempts: number; error?: string; txHash?: string; estimatedFee: string; }
export interface TransferPlan { chain: TransferChain; mode: TransferMode; dryRun: boolean; tasks: TransferTask[]; totalAmount: string; totalEstimatedFee: string; risks: string[]; }
export interface TransferLog { at: string; taskId?: string; level: 'info'|'success'|'error'; message: string; }
