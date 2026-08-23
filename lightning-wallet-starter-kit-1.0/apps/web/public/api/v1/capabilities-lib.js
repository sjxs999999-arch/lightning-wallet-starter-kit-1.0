export const RELEASE_VERSION='2.35.0';

const enabled=value=>String(value??'').toLowerCase()==='true';
const present=value=>typeof value==='string'&&value.trim().length>0;
const secureProvider=value=>present(value)&&value.startsWith('https://');
const blocker=(code,label)=>({code,label});

export function buildServerlessCapabilities(env=process.env){
  const walletConnectConfigured=/^[a-fA-F0-9]{32}$/.test(env.VITE_WALLETCONNECT_PROJECT_ID??'');
  const gasfreeConfigured=secureProvider(env.GASFREE_PROVIDER_URL);
  const marketHolderConfigured=secureProvider(env.MARKET_HOLDER_PROVIDER_URL);
  const flashTargets=`${env.FLASH_LOAN_URL??''},${env.FLASH_LOAN_API_URL??''}`;
  const flashLoanConfigured=enabled(env.FLASH_LOAN_PROVIDER_APPROVED)&&secureProvider(env.FLASH_LOAN_URL)&&secureProvider(env.FLASH_LOAN_API_URL)&&!/example|localhost|lightingwallet\.com|flash-loan:32104/i.test(flashTargets);
  const automationDeliveryConfigured=enabled(env.AUTOMATION_ENABLE_DELIVERY)&&Boolean(present(env.TELEGRAM_BOT_TOKEN)||(present(env.EMAIL_PROVIDER_URL)&&present(env.EMAIL_API_KEY))||present(env.WEBHOOK_SIGNING_SECRET));
  const walletAcceptanceApproved=enabled(env.FINAL_WALLET_ACCEPTANCE_APPROVED);
  const mainnet={execution:enabled(env.VITE_MAINNET_EXECUTION_ENABLED),swap:enabled(env.VITE_ENABLE_MAINNET_SWAP),launchpad:enabled(env.VITE_ENABLE_MAINNET_LAUNCHPAD),bridge:enabled(env.VITE_ENABLE_MAINNET_BRIDGE)};
  const externalBlockers=[
    ...(!walletConnectConfigured?[blocker('WALLETCONNECT_PROJECT_ID','WalletConnect Project ID')]:[]),
    ...(!gasfreeConfigured?[blocker('GASFREE_PAYMASTER','GasFree Paymaster')]:[]),
    ...(!marketHolderConfigured?[blocker('MARKET_HOLDER_PROVIDER','Market holder-data provider')]:[]),
    ...(!flashLoanConfigured?[blocker('FLASH_LOAN_APPLICATION','Real Flash Loan application/API')]:[]),
    ...(!automationDeliveryConfigured?[blocker('AUTOMATION_DELIVERY_PROVIDER','Automation delivery provider')]:[]),
  ];
  const walletReady=walletAcceptanceApproved&&mainnet.execution;
  return{version:RELEASE_VERSION,environment:'production',database:'server-protected',operator:'separate-admin-surface',chains:['Ethereum','BNB Chain','Base','Arbitrum','Optimism','Polygon','Avalanche C-Chain','Solana','TRON'],features:[
    {name:'多链钱包',mode:'browser-provider-and-local-worker',status:walletConnectConfigured?'ready':'provider-required'},
    {name:'批量转账',mode:'wallet-signed',status:walletReady?'ready':'acceptance-required'},
    {name:'资产归集',mode:'wallet-signed',status:walletReady?'ready':'acceptance-required'},
    {name:'闪电兑换',mode:'aggregator-and-wallet-signed',status:walletReady&&mainnet.swap?'ready':'acceptance-required'},
    {name:'闪电贷款',mode:'external-application-integration',status:flashLoanConfigured?(walletAcceptanceApproved?'ready':'acceptance-required'):'real-app-required'},
    {name:'GasFree',mode:'paymaster-policy-and-wallet-signature',status:gasfreeConfigured?(walletAcceptanceApproved?'ready':'acceptance-required'):'provider-required'},
    {name:'Token Studio',mode:'client-wallet-deployment-with-mainnet-double-gate',status:walletReady&&mainnet.launchpad?'ready':'acceptance-required'},
    {name:'项目与市场中心',mode:'public-read',status:marketHolderConfigured?'ready':'partial-provider-configuration'},
    {name:'自动化中心',mode:'read-only-monitoring-and-configured-delivery',status:automationDeliveryConfigured?'ready':'delivery-provider-required'},
  ],readiness:{finalApproval:externalBlockers.length===0&&walletReady&&mainnet.swap&&mainnet.launchpad&&mainnet.bridge,walletAcceptanceRequired:!walletAcceptanceApproved,externalBlockers,mainnet},security:{privateKeysUploaded:false,serverSigning:false,serverBroadcast:false,analytics:false,sessionRevocation:true,httpOnlySession:true,csrfProtection:true,defaultDenyApi:true,contentSecurityPolicy:true,metadataOnlyDiagnostics:true,automaticSessionRecovery:true,workerOnlyExportValidation:true,zeroizedKeyBuffers:true}};
}
