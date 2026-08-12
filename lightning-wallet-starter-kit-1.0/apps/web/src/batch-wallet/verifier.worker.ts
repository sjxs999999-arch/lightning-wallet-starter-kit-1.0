/// <reference lib="webworker" />
import { decryptBytes } from './crypto';
import { verifyWalletControlBytes } from './verification';
import type { LocalWalletRecord, WalletControlResult } from './types';

type Verify={type:'verify';key:CryptoKey;wallets:LocalWalletRecord[]};
let cancelled=false;
self.onmessage=async(event:MessageEvent<Verify|{type:'cancel'}>)=>{
  if(event.data.type==='cancel'){cancelled=true;return}
  cancelled=false;const{key,wallets}=event.data;let batch:WalletControlResult[]=[];
  for(let index=0;index<wallets.length;index++){
    if(cancelled){self.postMessage({type:'cancelled'});return}
    const wallet=wallets[index]!;let privateKeyBytes=new Uint8Array();let result:WalletControlResult;
    try{privateKeyBytes=await decryptBytes(key,wallet.encryptedPrivateKey);result=await verifyWalletControlBytes(wallet.chain,wallet,privateKeyBytes)}catch{result={walletId:wallet.id,address:wallet.address,pass:false,signatureValid:false,addressMatched:false,errorCode:'DECRYPT_FAILED'}}finally{privateKeyBytes.fill(0)}
    batch.push(result);
    if(batch.length===25||index===wallets.length-1){self.postMessage({type:'batch',results:batch,completed:index+1,total:wallets.length});batch=[];await new Promise(resolve=>setTimeout(resolve,0))}
  }
  self.postMessage({type:'done'});
};
export {};
