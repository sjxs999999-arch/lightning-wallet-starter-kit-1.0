export type WalletFamily='EVM'|'SOL'|'TRON';export type WalletName='MetaMask'|'WalletConnect'|'OKX Wallet'|'Rabby'|'Phantom'|'Backpack'|'Solflare'|'TronLink';
export type ConnectedWallet={name:WalletName;family:WalletFamily;address:string;network:string;provider:unknown};
export type TestnetHistory={id:string;wallet:WalletName;family:WalletFamily;network:string;address:string;operation:'connect'|'sign'|'broadcast';hash?:string;status:'connected'|'signed'|'broadcast'|'confirmed'|'rejected'|'failed';at:string;error?:string};
export type RequestProvider={request(args:{method:string;params?:unknown[]}):Promise<unknown>;on?(event:string,listener:(...args:unknown[])=>void):void};
