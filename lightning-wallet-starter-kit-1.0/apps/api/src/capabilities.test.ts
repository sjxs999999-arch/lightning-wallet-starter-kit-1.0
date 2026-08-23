import {describe,expect,it} from 'vitest';
import {buildCapabilities,RELEASE_VERSION} from './capabilities.js';

const complete={environment:'production',chains:['Ethereum','Solana','TRON'],walletConnectConfigured:true,gasfreeConfigured:true,marketHolderConfigured:true,flashLoanConfigured:true,automationDeliveryConfigured:true,walletAcceptanceApproved:true,mainnetExecutionEnabled:true,mainnetSwapEnabled:true,mainnetLaunchpadEnabled:true,mainnetBridgeEnabled:true,swapStatus:'ready'};

describe('production capability contract',()=>{
  it('reports the exact external blockers and never claims final approval by default',()=>{
    const value=buildCapabilities({...complete,walletConnectConfigured:false,gasfreeConfigured:false,marketHolderConfigured:false,flashLoanConfigured:false,automationDeliveryConfigured:false,walletAcceptanceApproved:false,mainnetExecutionEnabled:false,mainnetSwapEnabled:false,mainnetLaunchpadEnabled:false,mainnetBridgeEnabled:false});
    expect(value.version).toBe(RELEASE_VERSION);
    expect(value.readiness.externalBlockers.map(item=>item.code)).toEqual(['WALLETCONNECT_PROJECT_ID','GASFREE_PAYMASTER','MARKET_HOLDER_PROVIDER','FLASH_LOAN_APPLICATION','AUTOMATION_DELIVERY_PROVIDER']);
    expect(value.readiness).toMatchObject({finalApproval:false,walletAcceptanceRequired:true,mainnet:{execution:false,swap:false,launchpad:false,bridge:false}});
    expect(value.features.find(item=>item.name==='闪电贷款')?.status).toBe('real-app-required');
    expect(value.features.find(item=>item.name==='GasFree')?.status).toBe('provider-required');
    expect(value.security).toMatchObject({privateKeysUploaded:false,serverSigning:false,serverBroadcast:false});
  });

  it('requires providers, wallet acceptance and every mainnet gate for final approval',()=>{
    expect(buildCapabilities(complete).readiness.finalApproval).toBe(true);
    expect(buildCapabilities({...complete,mainnetBridgeEnabled:false}).readiness.finalApproval).toBe(false);
    expect(buildCapabilities({...complete,walletAcceptanceApproved:false}).readiness.finalApproval).toBe(false);
  });
});
