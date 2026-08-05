import{planGas}from'./planner';import type{GasEstimate,VipTier}from'./types';
self.onmessage=(event:MessageEvent<{estimate:GasEstimate;tier:VipTier;minReserveWei:string}>)=>{try{postMessage({type:'planned',plan:planGas(event.data.estimate,event.data.tier,event.data.minReserveWei)})}catch(error){postMessage({type:'error',message:error instanceof Error?error.message:'Gas 规划失败'})}};
