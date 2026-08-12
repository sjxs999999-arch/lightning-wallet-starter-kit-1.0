import { describe, expect, it } from 'vitest';
import { buildExternalUrl, containsSensitiveFields, sanitizeHistory } from './bridge';

describe('flash loan integration bridge', () => {
  it('shares only public settings through the external URL', () => {
    const url=new URL(buildExternalUrl('http://localhost:32104', {walletAddress:'0x1234',settings:{network:'sepolia',theme:'dark',dryRun:true}}));
    expect(url.searchParams.get('network')).toBe('sepolia'); expect(url.searchParams.get('dryRun')).toBe('true'); expect(url.search).not.toMatch(/token|private|mnemonic/i);
  });
  it('accepts Dry Run metadata while dropping unknown fields', () => {
    const item=sanitizeHistory({id:'1',status:'dry-run',privateKey:'never-store',amount:'12'});
    expect(item).toEqual(expect.objectContaining({id:'1',status:'dry-run',amount:'12'})); expect(item).not.toHaveProperty('privateKey');
    expect(sanitizeHistory({id:'2',status:'submitted'})).toBeNull();
  });
  it('blocks nested sensitive integration messages', () => { expect(containsSensitiveFields({payload:{wallet:{mnemonic:'x'}}})).toBe(true); expect(containsSensitiveFields({payload:{transactionHash:'0x1'}})).toBe(false); });
});
