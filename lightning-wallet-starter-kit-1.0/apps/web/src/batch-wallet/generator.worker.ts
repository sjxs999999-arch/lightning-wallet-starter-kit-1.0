/// <reference lib="webworker" />
import { deriveWallet, newMnemonic } from './engine';
import { encryptValue } from './crypto';
import type { BatchChain, LocalWalletRecord } from './types';

type Generate={type:'generate';key:CryptoKey;chain:BatchChain;count:number;prefix:string};
let cancelled=false;

self.onmessage=async(event:MessageEvent<Generate|{type:'cancel'}>)=>{
  if(event.data.type==='cancel'){cancelled=true;return}
  cancelled=false;const{key,chain,count,prefix}=event.data;let mnemonic='';
  try{
    mnemonic=newMnemonic();const seen=new Set<string>();let batch:LocalWalletRecord[]=[];
    for(let index=0;index<count;index++){
      if(cancelled){self.postMessage({type:'cancelled'});return}
      const wallet=await deriveWallet(chain,mnemonic,index);
      try{
        if(seen.has(wallet.address))throw new Error(`检测到重复地址：${wallet.address}`);seen.add(wallet.address);
        const encryptedPrivateKey=await encryptValue(key,wallet.privateKey),encryptedMnemonic=await encryptValue(key,wallet.mnemonic);
        batch.push({id:crypto.randomUUID(),name:`${prefix}-${String(index+1).padStart(4,'0')}`,chain,address:wallet.address,publicKey:wallet.publicKey,path:wallet.path,index,encryptedPrivateKey,encryptedMnemonic,createdAt:new Date().toISOString()});
      }finally{wallet.privateKey='';wallet.mnemonic=''}
      if(batch.length===25||index===count-1){self.postMessage({type:'batch',records:batch,completed:index+1,total:count});batch=[];await new Promise(resolve=>setTimeout(resolve,0))}
    }
    self.postMessage({type:'done',unique:seen.size});
  }catch(error){self.postMessage({type:'error',message:error instanceof Error?error.message:'生成失败'})}
  finally{mnemonic=''}
};
export {};
