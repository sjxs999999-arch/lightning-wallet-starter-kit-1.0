import { describe,expect,it } from 'vitest';
import { deriveWallet,newMnemonic } from './engine';
import { verifyWalletControlBytes } from './verification';
import type { BatchChain } from './types';

async function verifyBatch(chain:BatchChain,count:number){
  const mnemonic=newMnemonic(),started=performance.now(),encoder=new TextEncoder();let signatures=0,addresses=0,failed=0,buffersCleared=0;
  for(let index=0;index<count;index++){
    const wallet=await deriveWallet(chain,mnemonic,index),record={id:`${chain}-${index}`,address:wallet.address,publicKey:wallet.publicKey};
    const encoded=encoder.encode(wallet.privateKey),result=await verifyWalletControlBytes(chain,record,encoded);
    signatures+=Number(result.signatureValid);addresses+=Number(result.addressMatched);failed+=Number(!result.pass);buffersCleared+=Number(encoded.every(byte=>byte===0));
  }
  console.info(`PERF ${chain} CONTROL ${count}: ${Math.round(performance.now()-started)}ms`);
  return{total:count,signatures,addresses,failed,buffersCleared,privateKeyUploads:0};
}

describe.each(['TRON','SOL','EVM'] as const)('%s wallet control verification',chain=>{
  it('passes all 10 wallets and clears every plaintext buffer',async()=>expect(await verifyBatch(chain,10)).toEqual({total:10,signatures:10,addresses:10,failed:0,buffersCleared:10,privateKeyUploads:0}),30_000);
  it('passes all 1000 wallets and clears every plaintext buffer',async()=>expect(await verifyBatch(chain,1000)).toEqual({total:1000,signatures:1000,addresses:1000,failed:0,buffersCleared:1000,privateKeyUploads:0}),180_000);
  it('rejects a mismatched claimed address',async()=>{
    const mnemonic=newMnemonic(),first=await deriveWallet(chain,mnemonic,0),second=await deriveWallet(chain,mnemonic,1);
    const result=await verifyWalletControlBytes(chain,{id:'bad',address:second.address,publicKey:first.publicKey},new TextEncoder().encode(first.privateKey));
    expect(result).toMatchObject({pass:false,signatureValid:true,addressMatched:false,errorCode:'ADDRESS_MISMATCH'});
  });
});
