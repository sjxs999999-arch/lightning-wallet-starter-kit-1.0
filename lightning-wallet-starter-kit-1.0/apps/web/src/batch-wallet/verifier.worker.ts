/// <reference lib="webworker" />
import { decryptValue } from './crypto';
import { verifyTronControl } from './verification';
import type { LocalWalletRecord, WalletControlResult } from './types';

type Verify={type:'verify';key:CryptoKey;wallets:LocalWalletRecord[]};
let cancelled=false;
self.onmessage=async(event:MessageEvent<Verify|{type:'cancel'}>)=>{
  if(event.data.type==='cancel'){cancelled=true;return}
  cancelled=false;const{key,wallets}=event.data;let batch:WalletControlResult[]=[];
  for(let index=0;index<wallets.length;index++){
    if(cancelled){self.postMessage({type:'cancelled'});return}
    const wallet=wallets[index]!;let privateKey='';let result:WalletControlResult;
    try{privateKey=await decryptValue(key,wallet.encryptedPrivateKey);result=verifyTronControl(wallet,privateKey)}catch{result={walletId:wallet.id,address:wallet.address,pass:false,errorCode:'DECRYPT_FAILED'}}finally{privateKey=''}
    batch.push(result);
    if(batch.length===25||index===wallets.length-1){self.postMessage({type:'batch',results:batch,completed:index+1,total:wallets.length});batch=[];await new Promise(resolve=>setTimeout(resolve,0))}
  }
  self.postMessage({type:'done'});
};
export {};
