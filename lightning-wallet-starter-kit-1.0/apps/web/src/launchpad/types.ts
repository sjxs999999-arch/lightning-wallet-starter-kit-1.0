export type LaunchChain='EVM'|'SOL'|'TRON';
export type LaunchNetwork='sepolia'|'ethereum'|'bsc'|'polygon'|'base'|'arbitrum'|'solana-devnet'|'solana-mainnet'|'tron-nile'|'tron-shasta'|'tron-mainnet';
export const launchNetworkOptions:Record<LaunchChain,{value:LaunchNetwork;label:string;mainnet:boolean}[]>={
  EVM:[{value:'sepolia',label:'Sepolia 测试网',mainnet:false},{value:'ethereum',label:'Ethereum 主网',mainnet:true},{value:'bsc',label:'BSC 主网',mainnet:true},{value:'polygon',label:'Polygon 主网',mainnet:true},{value:'base',label:'Base 主网',mainnet:true},{value:'arbitrum',label:'Arbitrum 主网',mainnet:true}],
  SOL:[{value:'solana-devnet',label:'Solana Devnet',mainnet:false},{value:'solana-mainnet',label:'Solana Mainnet',mainnet:true}],
  TRON:[{value:'tron-nile',label:'TRON Nile',mainnet:false},{value:'tron-shasta',label:'TRON Shasta',mainnet:false},{value:'tron-mainnet',label:'TRON Mainnet',mainnet:true}],
};
export const launchNetworkMatchesChain=(chain:LaunchChain,network:LaunchNetwork)=>launchNetworkOptions[chain].some(item=>item.value===network);
export const isMainnetLaunchNetwork=(network:LaunchNetwork)=>launchNetworkOptions.EVM.concat(launchNetworkOptions.SOL,launchNetworkOptions.TRON).some(item=>item.value===network&&item.mainnet);
export interface MediaDescriptor{name:string;type:string;size:number}
export interface LaunchDraft{chain:LaunchChain;network:LaunchNetwork;name:string;symbol:string;decimals:number;supply:string;description:string;website:string;socials:{x:string;telegram:string;discord:string};media:{logo?:MediaDescriptor;banner?:MediaDescriptor;whitepaper?:MediaDescriptor};liquidity:{tokenAmount:string;quoteSymbol:string;quoteAmount:string;lockDays:number};dryRun:boolean}
export interface LiquidityPlan{initialPrice:string;tokenShareBps:number;lockDays:number;warnings:string[]}
export interface DeploymentPlan{projectId:string;planId:string;status:'validated'|'signature-required';broadcast:false;serverSigning:false;requiredSigner:'user-wallet';checklist:Record<string,boolean>}
