import {describe,expect,it}from'vitest';import{sponsorRequestSchema,evaluateVipPolicy}from'./gasfree.js';
const request={chainId:11155111 as const,sender:'0x1111111111111111111111111111111111111111',userOperationHash:`0x${'ab'.repeat(32)}`,estimatedCostWei:'1000000000000000',vipTier:'silver' as const,dryRun:true};
describe('GasFree policy',()=>{
  it('accepts only Sepolia sponsor metadata without keys',()=>{expect(sponsorRequestSchema.parse({...request,privateKey:'blocked'})).not.toHaveProperty('privateKey')});
  it('approves eligible VIP cost',()=>expect(evaluateVipPolicy(request)).toMatchObject({eligible:true,reason:'ELIGIBLE'}));
  it('rejects standard and over-limit requests',()=>{expect(evaluateVipPolicy({...request,vipTier:'standard'}).eligible).toBe(false);expect(evaluateVipPolicy({...request,estimatedCostWei:'6000000000000000'}).eligible).toBe(false)});
  it('rejects mainnet',()=>expect(()=>sponsorRequestSchema.parse({...request,chainId:1})).toThrow());
});
