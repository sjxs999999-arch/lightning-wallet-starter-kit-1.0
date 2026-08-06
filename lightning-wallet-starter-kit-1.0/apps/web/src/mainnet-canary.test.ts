import { describe, expect, it } from 'vitest';
import { assertMainnetCanaryTask, reserveMainnetCanaryExecution } from './mainnet-canary';
import type { TransferTask } from './batch-transfer/types';

const task: TransferTask = { id:'1', row:2, chain:'EVM', assetKind:'native', from:'0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a', to:'0x1311897252Bd6D7E5705443D9e7c32eE22E73067', amount:'0.0001', status:'pending', attempts:0, estimatedFee:'0' };
const tronUsdtTask: TransferTask = { id:'2', row:2, chain:'TRON', assetKind:'token', from:'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA', to:'TQxgyuuj43UrFhYtgkBGNTZtLY4iuvm7CL', amount:'1', token:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals:6, status:'pending', attempts:0, estimatedFee:'0' };

describe('mainnet canary policy', () => {
  it('allows only the approved native transfer pair and supported network', () => {
    expect(() => assertMainnetCanaryTask(task, '0x38')).not.toThrow();
    expect(() => assertMainnetCanaryTask(task, '0x1')).toThrow(/BSC/);
    expect(() => assertMainnetCanaryTask({...task,to:'0x0000000000000000000000000000000000000001'}, '0x38')).toThrow(/地址对/);
    expect(() => assertMainnetCanaryTask({...task,token:'0x0000000000000000000000000000000000000001'}, '0x38')).toThrow(/Token/);
    expect(() => assertMainnetCanaryTask({...task,amount:'0.0002'}, '0x38')).toThrow(/上限/);
  });

  it('allows only the approved TRON USDT canary', () => {
    expect(() => assertMainnetCanaryTask(tronUsdtTask, 'https://api.trongrid.io')).not.toThrow();
    expect(() => assertMainnetCanaryTask({...tronUsdtTask,amount:'1.01'}, 'https://api.trongrid.io')).toThrow(/上限/);
    expect(() => assertMainnetCanaryTask({...tronUsdtTask,decimals:18}, 'https://api.trongrid.io')).toThrow(/decimals/);
    expect(() => assertMainnetCanaryTask({...tronUsdtTask,token:'TJG8JPF9kTJW7iiNddRLTdLxsdtU8CGhhE'}, 'https://api.trongrid.io')).toThrow(/官方 USDT/);
  });

  it('enforces ten browser-side executions per UTC day', () => {
    const values = new Map<string,string>();
    const storage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}};
    for(let index=0;index<10;index++) reserveMainnetCanaryExecution(storage,new Date('2026-08-07T01:00:00Z'));
    expect(() => reserveMainnetCanaryExecution(storage,new Date('2026-08-07T02:00:00Z'))).toThrow(/每日/);
  });
});
