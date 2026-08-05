import { describe, expect, it } from 'vitest';
import { flashLoanSessionClaims } from './flash-loan.js';

describe('flash loan integration session', () => {
  it('creates only a dry-run Sepolia session with metadata scopes', () => {
    expect(flashLoanSessionClaims({network:'sepolia',dryRun:true},{sub:'operator@example.com',role:'operator'})).toEqual({sub:'operator@example.com',aud:'flash-loan',scope:['wallet:public','history:metadata'],network:'sepolia',dryRun:true});
  });
  it('rejects mainnet or non-dry-run sessions', () => {
    expect(()=>flashLoanSessionClaims({network:'mainnet',dryRun:true},{sub:'operator',role:'operator'})).toThrow();
    expect(()=>flashLoanSessionClaims({network:'sepolia',dryRun:false},{sub:'operator',role:'operator'})).toThrow();
    expect(()=>flashLoanSessionClaims({network:'sepolia',dryRun:true},{sub:'integration'})).toThrow();
  });
  it('never accepts signing material in the session contract', () => {
    const claims=flashLoanSessionClaims({network:'sepolia',dryRun:true,privateKey:'blocked'},{sub:'operator',role:'operator',mnemonic:'blocked'});
    expect(JSON.stringify(claims)).not.toMatch(/privateKey|mnemonic|blocked/);
  });
});
