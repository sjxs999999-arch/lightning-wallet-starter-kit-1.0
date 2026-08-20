import {describe,expect,it} from 'vitest';
import {buildServerlessCapabilities,RELEASE_VERSION} from '../public/api/v1/capabilities-lib.js';

describe('serverless capability fallback',()=>{
  it('is public-safe, truthful and fail-closed without providers',()=>{
    const value=buildServerlessCapabilities({});
    expect(value.version).toBe(RELEASE_VERSION);
    expect(value.operator).toBe('separate-admin-surface');
    expect(value.database).toBe('server-protected');
    expect(value.readiness.finalApproval).toBe(false);
    expect(value.readiness.externalBlockers.map(item=>item.code)).toEqual(['WALLETCONNECT_PROJECT_ID','GASFREE_PAYMASTER','MARKET_HOLDER_PROVIDER','FLASH_LOAN_APPLICATION','AUTOMATION_DELIVERY_PROVIDER']);
    expect(value.features.every(item=>item.status==='ready')).toBe(false);
    expect(value.security).toMatchObject({privateKeysUploaded:false,serverSigning:false});
  });

  it('requires all providers, acceptance and mainnet gates for approval',()=>{
    const env={VITE_WALLETCONNECT_PROJECT_ID:'a'.repeat(32),GASFREE_PROVIDER_URL:'https://paymaster.provider.test',MARKET_HOLDER_PROVIDER_URL:'https://market.provider.test',FLASH_LOAN_PROVIDER_APPROVED:'true',FLASH_LOAN_URL:'https://flash.provider.test',FLASH_LOAN_API_URL:'https://flash.provider.test/api',AUTOMATION_ENABLE_DELIVERY:'true',WEBHOOK_SIGNING_SECRET:'s'.repeat(32),FINAL_WALLET_ACCEPTANCE_APPROVED:'true',VITE_MAINNET_EXECUTION_ENABLED:'true',VITE_ENABLE_MAINNET_SWAP:'true',VITE_ENABLE_MAINNET_LAUNCHPAD:'true',VITE_ENABLE_MAINNET_BRIDGE:'true'};
    expect(buildServerlessCapabilities(env).readiness).toMatchObject({finalApproval:true,walletAcceptanceRequired:false,externalBlockers:[]});
  });

  it('rejects an approved flag that still points to the compatibility shell',()=>{
    const value=buildServerlessCapabilities({FLASH_LOAN_PROVIDER_APPROVED:'true',FLASH_LOAN_URL:'https://lightingwallet.com/flashforge/',FLASH_LOAN_API_URL:'http://flash-loan:32104/api'});
    expect(value.readiness.externalBlockers.map(item=>item.code)).toContain('FLASH_LOAN_APPLICATION');
  });
});
