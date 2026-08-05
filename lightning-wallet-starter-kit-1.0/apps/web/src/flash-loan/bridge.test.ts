import { describe, expect, it } from 'vitest';
import { buildExternalUrl, containsSensitiveFields, readHistory, sanitizeHistory, saveHistory } from './bridge';

function memoryStorage() { let value: string | null=null; return {getItem:()=>value,setItem:(_key:string,next:string)=>{value=next}}; }

describe('flash loan integration bridge', () => {
  it('shares only public settings through the external URL', () => {
    const url=new URL(buildExternalUrl('http://localhost:32104', {walletAddress:'0x1234',settings:{network:'sepolia',theme:'dark',dryRun:true}}));
    expect(url.searchParams.get('network')).toBe('sepolia'); expect(url.searchParams.get('dryRun')).toBe('true'); expect(url.search).not.toMatch(/token|private|mnemonic/i);
  });
  it('accepts metadata while dropping unknown fields', () => {
    const item=sanitizeHistory({id:'1',status:'dry-run',privateKey:'never-store',amount:'12'});
    expect(item).toEqual(expect.objectContaining({id:'1',status:'dry-run',amount:'12'})); expect(item).not.toHaveProperty('privateKey');
  });
  it('blocks sensitive integration messages', () => { expect(containsSensitiveFields({mnemonic:'x'})).toBe(true); expect(containsSensitiveFields({transactionHash:'0x1'})).toBe(false); });
  it('persists metadata-only history', () => { const storage=memoryStorage(); const item=sanitizeHistory({id:'1',status:'submitted'})!; saveHistory(item,storage); expect(readHistory(storage)).toHaveLength(1); });
});
