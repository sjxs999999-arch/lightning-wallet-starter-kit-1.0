import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import{fetchWithFallback}from'./resilience.js';
import type { Queryable } from './projects.js';

export const gasEstimateSchema=z.object({
  from:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  to:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  value:z.string().regex(/^\d{1,78}$/).default('0'),
  data:z.string().max(16_386).regex(/^0x(?:[0-9a-fA-F]{2})*$/).default('0x'),
  audit:z.boolean().default(true),
}).strict();

export const sponsorRequestSchema=z.object({
  chainId:z.literal(11155111),
  sender:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  userOperationHash:z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  estimatedCostWei:z.string().regex(/^\d+$/),
  vipTier:z.enum(['standard','silver','gold']),
  dryRun:z.boolean(),
}).strict();

export const gasHistoryQuerySchema=z.object({limit:z.coerce.number().int().min(1).max(100).default(20)}).strict();

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

export async function resolveSponsorDecision(request:SponsorRequest,providerUrl?:string):Promise<SponsorDecision>{
  const policy=evaluateVipPolicy(request);
  if(!policy.eligible||!providerUrl)return policy;
  const decision=await new HttpPaymasterAdapter(providerUrl).sponsor(request);
  return{eligible:decision.eligible,reason:decision.reason,limitWei:policy.limitWei,provider:decision.provider};
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

export async function recordGasEstimate(db:Queryable,input:z.infer<typeof gasEstimateSchema>,estimate:Awaited<ReturnType<typeof rpcGasEstimate>>){const id=randomUUID(),payload={chainId:11155111,network:'Sepolia',from:input.from,to:input.to,value:input.value,dataBytes:(input.data.length-2)/2,dryRun:true},result={balanceWei:estimate.balanceWei,gasLimit:estimate.gasLimit,gasPriceWei:estimate.gasPriceWei,estimatedCostWei:estimate.estimatedCostWei,sufficient:estimate.sufficient,serverSigning:false,serverBroadcast:false};const rows=await db.query("INSERT INTO operation_jobs(id,kind,status,idempotency_key,payload,result) VALUES($1,'gas-estimate','completed',$2,$3,$4) RETURNING id,kind,status,created_at,updated_at",[id,`gas-estimate:${id}`,payload,result]),row=rows.rows[0]??{};return{...row,id:String(row.id??id),payload,result}}
export async function recordGasSponsor(db:Queryable,input:SponsorRequest,decision:SponsorDecision&{dryRun:boolean;signatureRequired:boolean;broadcast:boolean}){const id=randomUUID(),payload={chainId:input.chainId,sender:input.sender,userOperationHash:input.userOperationHash,estimatedCostWei:input.estimatedCostWei,vipTier:input.vipTier,dryRun:decision.dryRun},result={eligible:decision.eligible,reason:decision.reason,limitWei:decision.limitWei,provider:decision.provider,dryRun:decision.dryRun,signatureRequired:decision.signatureRequired,broadcast:false,serverSigning:false,serverBroadcast:false};const rows=await db.query("INSERT INTO operation_jobs(id,kind,status,idempotency_key,payload,result) VALUES($1,'gas-sponsor','completed',$2,$3,$4) RETURNING id,kind,status,created_at,updated_at",[id,`gas-sponsor:${id}`,payload,result]),row=rows.rows[0]??{};return{...row,id:String(row.id??id),payload,result}}
export async function listGasJobs(db:Queryable,input:unknown){const{limit}=gasHistoryQuerySchema.parse(input),rows=await db.query("SELECT id,kind,status,jsonb_build_object('chainId',payload->'chainId','network',payload->'network','from',payload->'from','to',payload->'to','sender',payload->'sender','vipTier',payload->'vipTier','estimatedCostWei',payload->'estimatedCostWei','dryRun',payload->'dryRun') AS payload,jsonb_build_object('estimatedCostWei',result->'estimatedCostWei','eligible',result->'eligible','reason',result->'reason','dryRun',result->'dryRun','serverSigning',false,'serverBroadcast',false) AS result,created_at,updated_at FROM operation_jobs WHERE kind IN ('gas-estimate','gas-sponsor') ORDER BY created_at DESC LIMIT $1",[limit]);return rows.rows}
