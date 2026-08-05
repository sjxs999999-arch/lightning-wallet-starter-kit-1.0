import { keccak256, toUtf8Bytes } from 'ethers';
import type { TransferChain, TransferInput, TransferMode, TransferPlan, TransferTask } from './types';
import { validateAddress, validateAmount } from './validation';
const fee={EVM:{native:.00021,token:.00065},SOL:{native:.000005,token:.00001},TRON:{native:1.1,token:15}} as const;
export function buildPlan(chain:TransferChain,mode:TransferMode,inputs:TransferInput[],dryRun=true):TransferPlan{
  if(!inputs.length||inputs.length>1000)throw new Error('任务数量必须为 1–1000');
  const seen=new Set<string>(); const tasks:TransferTask[]=inputs.map((input,index)=>{
    if(!validateAddress(chain,input.from)||!validateAddress(chain,input.to))throw new Error(`第 ${index+2} 行地址格式或校验和无效`);
    if(!validateAmount(input.amount))throw new Error(`第 ${index+2} 行金额无效`);
    if(input.token&&!validateAddress(chain,input.token))throw new Error(`第 ${index+2} 行 Token 地址无效`);
    const key=`${chain}|${input.from}|${input.to}|${input.token??'native'}|${input.amount}`.toLowerCase();if(seen.has(key))throw new Error(`第 ${index+2} 行是重复交易`);seen.add(key);
    const assetKind=input.token?'token':'native';return{...input,id:keccak256(toUtf8Bytes(key)),row:index+2,chain,assetKind,status:'pending',attempts:0,estimatedFee:String(fee[chain][assetKind])};
  });
  const fromCount=new Set(tasks.map(x=>x.from)).size,toCount=new Set(tasks.map(x=>x.to)).size;if(mode==='one-to-many'&&fromCount!==1)throw new Error('一对多模式必须只有一个发送地址');if(mode==='many-to-one'&&toCount!==1)throw new Error('多对一模式必须只有一个接收地址');
  const total=(key:'amount'|'estimatedFee')=>tasks.reduce((sum,item)=>sum+Number(item[key]),0).toFixed(8).replace(/0+$/,'').replace(/\.$/,'');
  return{chain,mode,dryRun,tasks,totalAmount:total('amount'),totalEstimatedFee:total('estimatedFee'),risks:[dryRun?'模拟模式不会广播交易':'真实执行将逐笔请求钱包确认与签名',...(tasks.length>=100?['大批量任务请确认余额和 RPC 限流']:[])]};
}
