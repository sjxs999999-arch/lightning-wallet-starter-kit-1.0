export type VipTier='standard'|'silver'|'gold';
export interface GasEstimate{chainId:number;network:string;balanceWei:string;gasLimit:string;gasPriceWei:string;estimatedCostWei:string;sufficient:boolean}
export interface GasPlan{requiredWei:string;topUpWei:string;sponsorEligible:boolean;action:'none'|'sponsor'|'top-up';risk:string[]}
export interface GasHistory{at:string;address:string;network:string;estimatedCostWei:string;topUpWei:string;vipTier:VipTier;dryRun:boolean;status:'estimated'|'eligible'|'top-up-required'|'failed';error?:string}
