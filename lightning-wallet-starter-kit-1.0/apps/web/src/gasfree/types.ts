export type VipTier='standard'|'silver'|'gold';
export interface GasEstimate{chainId:number;network:string;balanceWei:string;gasLimit:string;gasPriceWei:string;estimatedCostWei:string;sufficient:boolean;jobId?:string}
export interface GasPlan{requiredWei:string;topUpWei:string;sponsorEligible:boolean;action:'none'|'sponsor'|'top-up';risk:string[]}
export interface GasAuditJob{id:string;kind:'gas-estimate'|'gas-sponsor';status:string;payload:{network?:string;from?:string;to?:string;sender?:string;vipTier?:VipTier;estimatedCostWei?:string;dryRun?:boolean};result:{estimatedCostWei?:string;eligible?:boolean;reason?:string;dryRun?:boolean;serverSigning:false;serverBroadcast:false};created_at:string;updated_at:string}
