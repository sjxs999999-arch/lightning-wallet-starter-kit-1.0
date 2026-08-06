import { z } from 'zod';
import{fetchWithFallback}from'./resilience.js';

export const gasEstimateSchema=z.object({
  from:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  to:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  value:z.string().regex(/^\d+$/).default('0'),
  data:z.string().regex(/^0x[0-9a-fA-F]*$/).default('0x'),
});

export const sponsorRequestSchema=z.object({
  chainId:z.literal(11155111),
  sender:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  userOperationHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  estimatedCostWei:z.string().regex(/^\d+$/),
  vipTier:z.enum(['standard','silver','gold']),
  dryRun:z.boolean(),
});

export type SponsorRequest=z.infer<typeof sponsorRequestSchema>;
export interface SponsorDecision {eligible:boolean;reason:string;limitWei:string;provider?:string;paymasterData?:string}
export interface PaymasterAdapter {sponsor(request:SponsorRequest):Promise<SponsorDecision>}

const limits={standard:0n,silver:5_000_000_000_000_000n,gold:25_000_000_000_000_000n};
export function evaluateVipPolicy(request:SponsorRequest):SponsorDecision {
  const limit=limits[request.vipTier],cost=BigInt(request.estimatedCostWei);
  return {eligible:cost<=limit&&limit>0n,reason:limit===0n?'STANDARD_TIER_NOT_SPONSORED':cost>limit?'VIP_LIMIT_EXCEEDED':'ELIGIBLE',limitWei:limit.toString()};
}

export class HttpPaymasterAdapter implements PaymasterAdapter {
  constructor(private readonly url:string){}
  async sponsor(request:SponsorRequest):Promise<SponsorDecision>{
    const response=await fetch(this.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error(`Paymaster provider returned ${response.status}`);
    const data=z.object({paymasterData:z.string().min(2),provider:z.string().min(1)}).parse(await response.json());
    return {...evaluateVipPolicy(request),eligible:true,reason:'PROVIDER_APPROVED',provider:data.provider,paymasterData:data.paymasterData};
  }
}

export async function rpcGasEstimate(rpcUrl:string|string[],input:z.infer<typeof gasEstimateSchema>){
  const endpoints=Array.isArray(rpcUrl)?rpcUrl:[rpcUrl];
  const rpc=async(method:string,params:unknown[])=>{
    const response=await fetchWithFallback(endpoints,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})},{timeoutMs:5000,retries:1});
    if(!response.ok)throw new Error(`RPC ${response.status}`);
    const body=z.object({result:z.string().optional(),error:z.object({message:z.string()}).optional()}).parse(await response.json());
    if(body.error||!body.result)throw new Error(body.error?.message||'RPC result missing'); return body.result;
  };
  const transaction={from:input.from,to:input.to,value:`0x${BigInt(input.value).toString(16)}`,data:input.data};
  const [balanceHex,gasHex,priceHex]=await Promise.all([rpc('eth_getBalance',[input.from,'latest']),rpc('eth_estimateGas',[transaction]),rpc('eth_gasPrice',[])]);
  const balance=BigInt(balanceHex),gasLimit=BigInt(gasHex),gasPrice=BigInt(priceHex),estimatedCost=gasLimit*gasPrice;
  return {chainId:11155111,network:'Sepolia',balanceWei:balance.toString(),gasLimit:gasLimit.toString(),gasPriceWei:gasPrice.toString(),estimatedCostWei:estimatedCost.toString(),sufficient:balance>=estimatedCost+BigInt(input.value)};
}
