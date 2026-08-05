import type { TransferChain,TransferStatus } from '../batch-transfer/types';
export interface ScanInput{address:string;token?:string;decimals?:number}
export interface ScannedAsset extends ScanInput{id:string;chain:TransferChain;asset:'native'|'token';symbol:string;balance:string;estimatedFee:string;status:'ready'|'failed';error?:string}
export interface CollectorTask extends ScannedAsset{destination:string;reserve:string;collectAmount:string;executionStatus:TransferStatus;attempts:number;txHash?:string}
export interface CollectorLog{at:string;level:'info'|'success'|'error';message:string;taskId?:string}
