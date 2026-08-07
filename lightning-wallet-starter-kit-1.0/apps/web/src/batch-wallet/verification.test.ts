import { describe,expect,it } from 'vitest';
import { deriveWallet,newMnemonic } from './engine';
import { verifyTronControl } from './verification';

describe('TRON wallet control verification',()=>{
  it('signs, verifies and re-derives 1000 generated wallet addresses locally',async()=>{
    const mnemonic=newMnemonic(),started=performance.now();
    for(let index=0;index<1000;index++){
      const wallet=await deriveWallet('TRON',mnemonic,index),record={id:`tron-${index}`,address:wallet.address,publicKey:wallet.publicKey};
      expect(verifyTronControl(record,wallet.privateKey)).toEqual({walletId:record.id,address:wallet.address,pass:true});
    }
    console.info(`PERF TRON CONTROL 1000: ${Math.round(performance.now()-started)}ms`);
  },120_000);
  it('fails when the public key does not control the claimed address',async()=>{const mnemonic=newMnemonic(),first=await deriveWallet('TRON',mnemonic,0),second=await deriveWallet('TRON',mnemonic,1);expect(verifyTronControl({id:'bad',address:first.address,publicKey:second.publicKey},first.privateKey)).toMatchObject({pass:false,errorCode:'SIGNATURE_FAILED'})});
});
