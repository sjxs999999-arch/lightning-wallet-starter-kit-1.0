import { beforeEach,describe,expect,it,vi } from 'vitest';
import { executeTask } from './executor';
import type { TransferTask } from './types';
const task:TransferTask={id:'0x1',row:2,chain:'EVM',assetKind:'native',from:'0x0000000000000000000000000000000000000001',to:'0x0000000000000000000000000000000000000002',amount:'0.01',status:'pending',attempts:0,estimatedFee:'0.00021'};
describe('client-only transaction executor',()=>{
  beforeEach(()=>Object.defineProperty(globalThis,'window',{configurable:true,value:{confirm:vi.fn(()=>true)}}));
  it('requires explicit confirmation before any wallet request',async()=>{window.confirm=vi.fn(()=>false);window.ethereum={request:vi.fn()};await expect(executeTask(task)).rejects.toThrow('用户取消');expect(window.ethereum.request).not.toHaveBeenCalled()});
  it('blocks unapproved EVM mainnet address pairs',async()=>{window.ethereum={request:vi.fn(async()=> '0x1')};await expect(executeTask({...task,amount:'0.0001'})).rejects.toThrow('地址对');expect(window.ethereum.request).toHaveBeenCalledTimes(1)});
  it('requests wallet signing on Sepolia without private key material',async()=>{window.ethereum={request:vi.fn(async({method})=>method==='eth_chainId'?'0xaa36a7':'0xtesthash')};await expect(executeTask(task)).resolves.toBe('0xtesthash');expect(JSON.stringify(vi.mocked(window.ethereum.request).mock.calls)).not.toMatch(/private|mnemonic|secret/i)});
});
