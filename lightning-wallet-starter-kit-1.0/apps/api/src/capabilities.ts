export const RELEASE_VERSION='2.35.0';

export type ExternalBlockerCode='WALLETCONNECT_PROJECT_ID'|'GASFREE_PAYMASTER'|'MARKET_HOLDER_PROVIDER'|'FLASH_LOAN_APPLICATION'|'AUTOMATION_DELIVERY_PROVIDER';
export type CapabilityInput={
  environment:string;
  chains:string[];
  walletConnectConfigured:boolean;
  gasfreeConfigured:boolean;
  marketHolderConfigured:boolean;
  flashLoanConfigured:boolean;
  automationDeliveryConfigured:boolean;
  walletAcceptanceApproved:boolean;
  mainnetExecutionEnabled:boolean;
  mainnetSwapEnabled:boolean;
  mainnetLaunchpadEnabled:boolean;
  mainnetBridgeEnabled:boolean;
  swapStatus:string;
};

const blocker=(code:ExternalBlockerCode,label:string)=>({code,label});

export function buildCapabilities(input:CapabilityInput){
  const externalBlockers=[
    ...(!input.walletConnectConfigured?[blocker('WALLETCONNECT_PROJECT_ID','WalletConnect Project ID')]:[]),
    ...(!input.gasfreeConfigured?[blocker('GASFREE_PAYMASTER','GasFree Paymaster')]:[]),
    ...(!input.marketHolderConfigured?[blocker('MARKET_HOLDER_PROVIDER','Market holder-data provider')]:[]),
    ...(!input.flashLoanConfigured?[blocker('FLASH_LOAN_APPLICATION','Real Flash Loan application/API')]:[]),
    ...(!input.automationDeliveryConfigured?[blocker('AUTOMATION_DELIVERY_PROVIDER','Automation delivery provider')]:[]),
  ];
  const mainnet={
    execution:input.mainnetExecutionEnabled,
    swap:input.mainnetSwapEnabled,
    launchpad:input.mainnetLaunchpadEnabled,
    bridge:input.mainnetBridgeEnabled,
  };
  const walletReady=input.walletAcceptanceApproved&&mainnet.execution;
  const finalApproval=externalBlockers.length===0&&walletReady&&mainnet.swap&&mainnet.launchpad&&mainnet.bridge&&input.swapStatus==='ready';
  const automationReady=input.automationDeliveryConfigured?'ready':'delivery-provider-required';
  const flashLoanStatus=input.flashLoanConfigured?(input.walletAcceptanceApproved?'ready':'acceptance-required'):'real-app-required';
  const gasfreeStatus=input.gasfreeConfigured?(input.walletAcceptanceApproved?'ready':'acceptance-required'):'provider-required';
  const marketStatus=input.marketHolderConfigured?'ready':'partial-provider-configuration';
  return{
    version:RELEASE_VERSION,
    environment:input.environment,
    database:'server-protected',
    operator:'separate-admin-surface',
    chains:input.chains,
    features:[
      {name:'多链钱包',mode:'browser-provider-and-local-worker',status:input.walletConnectConfigured?'ready':'provider-required'},
      {name:'批量转账',mode:'wallet-signed',status:walletReady?'ready':'acceptance-required'},
      {name:'资产归集',mode:'wallet-signed',status:walletReady?'ready':'acceptance-required'},
      {name:'闪电兑换',mode:'aggregator-and-wallet-signed',status:walletReady&&mainnet.swap?input.swapStatus:'acceptance-required'},
      {name:'闪电贷款',mode:'external-application-integration',status:flashLoanStatus},
      {name:'GasFree',mode:'paymaster-policy-and-wallet-signature',status:gasfreeStatus},
      {name:'Token Studio',mode:'client-wallet-deployment-with-mainnet-double-gate',status:walletReady&&mainnet.launchpad?'ready':'acceptance-required'},
      {name:'项目与市场中心',mode:'public-read',status:marketStatus},
      {name:'自动化中心',mode:'read-only-monitoring-and-configured-delivery',status:automationReady},
    ],
    readiness:{finalApproval,walletAcceptanceRequired:!input.walletAcceptanceApproved,externalBlockers,mainnet},
    security:{privateKeysUploaded:false,serverSigning:false,serverBroadcast:false,analytics:false,sessionRevocation:true,httpOnlySession:true,csrfProtection:true,defaultDenyApi:true,contentSecurityPolicy:true,metadataOnlyDiagnostics:true,automaticSessionRecovery:true,workerOnlyExportValidation:true,zeroizedKeyBuffers:true},
  };
}
