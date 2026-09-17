import { describe, expect, it } from 'vitest';
import { buildExternalUrl, connectSepoliaWallet, containsSensitiveFields, flashLoanHealthReady, flashLoanMessageOriginAllowed, flashLoanSessionActive, flashLoanSessionExpiry, postFlashLoanContext, sanitizeHistory, SEPOLIA_CHAIN_ID } from './bridge';

describe('flash loan integration bridge', () => {
  it('shares only public settings through the external URL', () => {
    const context={walletAddress:'0x1234',settings:{network:'sepolia',theme:'dark',dryRun:true}} as const;
    const url=new URL(buildExternalUrl('http://localhost:32104', context));
    expect(url.searchParams.get('network')).toBe('sepolia'); expect(url.searchParams.get('dryRun')).toBe('true'); expect(url.searchParams.has('wallet')).toBe(false); expect(url.search).not.toMatch(/token|private|mnemonic|0x1234/i);
  });
  it('accepts Dry Run metadata while dropping unknown fields', () => {
    const item=sanitizeHistory({id:'1',status:'dry-run',privateKey:'never-store',amount:'12'});
    expect(item).toEqual(expect.objectContaining({id:'1',status:'dry-run',amount:'12'})); expect(item).not.toHaveProperty('privateKey');
    expect(sanitizeHistory({id:'2',status:'submitted'})).toBeNull();
  });
  it('blocks nested sensitive integration messages', () => { expect(containsSensitiveFields({payload:{wallet:{mnemonic:'x'}}})).toBe(true); expect(containsSensitiveFields({payload:{transactionHash:'0x1'}})).toBe(false); });
  it('trusts only API health that explicitly stays on Sepolia with mainnet disabled', () => {
    expect(flashLoanHealthReady({status:'ready',network:'sepolia',mainnetEnabled:false})).toBe(true);
    expect(flashLoanHealthReady({status:'ready',network:'mainnet',mainnetEnabled:true})).toBe(false);
    expect(flashLoanHealthReady({status:'degraded',network:'sepolia',mainnetEnabled:false})).toBe(false);
  });
  it('expires sessions within five minutes and rejects stale tokens', () => {
    expect(flashLoanSessionExpiry(1_000, 900)).toBe(301_000);
    expect(flashLoanSessionActive('token', 2_000, 1_999)).toBe(true);
    expect(flashLoanSessionActive('token', 2_000, 2_000)).toBe(false);
  });
  it('posts context only to the configured exact origin', () => {
    const calls: unknown[][]=[];
    const context={type:'LIGHTNING_FLASH_LOAN_CONTEXT' as const,version:1 as const,sessionToken:'token',settings:{network:'sepolia' as const,theme:'dark' as const,dryRun:true as const}};
    postFlashLoanContext({postMessage:(...args:unknown[])=>calls.push(args)},context,'https://flash.example');
    expect(calls).toEqual([[context,'https://flash.example']]);
    expect(()=>postFlashLoanContext({postMessage:()=>undefined},context,'*')).toThrow(/precise/i);
    expect(flashLoanMessageOriginAllowed('https://flash.example','https://flash.example')).toBe(true);
    expect(flashLoanMessageOriginAllowed('null','https://flash.example')).toBe(false);
  });
  it('switches to Sepolia and revalidates the chain and account', async () => {
    let currentChain='0x1';
    const calls:string[]=[];
    const provider={request:async({method}:{method:string})=>{calls.push(method);if(method==='eth_requestAccounts'||method==='eth_accounts')return['0x1111111111111111111111111111111111111111'];if(method==='eth_chainId')return currentChain;if(method==='wallet_switchEthereumChain'){currentChain=SEPOLIA_CHAIN_ID;return null;}throw new Error('unexpected')}};
    await expect(connectSepoliaWallet(provider)).resolves.toBe('0x1111111111111111111111111111111111111111');
    expect(calls).toEqual(['eth_requestAccounts','eth_chainId','wallet_switchEthereumChain','eth_chainId','eth_accounts']);
  });
  it('rejects providers that remain off Sepolia after a switch request', async () => {
    const provider={request:async({method}:{method:string})=>method==='eth_requestAccounts'||method==='eth_accounts'?['0x1111111111111111111111111111111111111111']:method==='eth_chainId'?'0x1':null};
    await expect(connectSepoliaWallet(provider)).rejects.toThrow('FLASH_LOAN_WRONG_NETWORK');
  });
});
