import { buildPlan } from './planner';
self.onmessage=(event:MessageEvent)=>{try{const started=performance.now();const plan=buildPlan(event.data.chain,event.data.mode,event.data.inputs,event.data.dryRun);postMessage({type:'planned',plan,elapsed:Math.round(performance.now()-started)})}catch(error){postMessage({type:'error',message:error instanceof Error?error.message:'任务规划失败'})}};
