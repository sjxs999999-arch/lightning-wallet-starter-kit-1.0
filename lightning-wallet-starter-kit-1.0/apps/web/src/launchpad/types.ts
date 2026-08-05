export type LaunchChain='EVM'|'SOL'|'TRON';export type LaunchNetwork='sepolia'|'solana-devnet'|'tron-nile';
export interface MediaDescriptor{name:string;type:string;size:number}
export interface LaunchDraft{chain:LaunchChain;network:LaunchNetwork;name:string;symbol:string;decimals:number;supply:string;description:string;website:string;socials:{x:string;telegram:string;discord:string};media:{logo?:MediaDescriptor;banner?:MediaDescriptor;whitepaper?:MediaDescriptor};liquidity:{tokenAmount:string;quoteSymbol:string;quoteAmount:string;lockDays:number};dryRun:boolean}
export interface LiquidityPlan{initialPrice:string;tokenShareBps:number;lockDays:number;warnings:string[]}
export interface DeploymentPlan{planId:string;status:'validated'|'signature-required';broadcast:false;serverSigning:false;requiredSigner:'user-wallet';checklist:Record<string,boolean>}
