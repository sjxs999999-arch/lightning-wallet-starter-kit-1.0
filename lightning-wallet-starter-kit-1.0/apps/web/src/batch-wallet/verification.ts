import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak256 } from 'ethers';
import bs58 from 'bs58';
import type { WalletControlResult } from './types';

const fromHex=(value:string)=>Uint8Array.from(value.replace(/^0x/,'').match(/.{2}/g)??[],part=>parseInt(part,16));
const concat=(...values:Uint8Array[])=>{const result=new Uint8Array(values.reduce((total,value)=>total+value.length,0));let offset=0;for(const value of values){result.set(value,offset);offset+=value.length}return result};

export function tronAddressFromPublicKey(publicKey:Uint8Array){
  if(publicKey.length!==65||publicKey[0]!==4)throw new Error('INVALID_PUBLIC_KEY');
  const body=concat(new Uint8Array([0x41]),fromHex(keccak256(publicKey.slice(1))).slice(-20));
  return bs58.encode(concat(body,sha256(sha256(body)).slice(0,4)));
}

export function verifyTronControl(wallet:{id:string;address:string;publicKey:string},privateKeyHex:string):WalletControlResult{
  const base={walletId:wallet.id,address:wallet.address};
  const privateKey=fromHex(privateKeyHex),challenge=new Uint8Array(48);crypto.getRandomValues(challenge);new DataView(challenge.buffer).setBigUint64(0,BigInt(Date.now()));const digest=sha256(challenge);
  try{
    if(privateKey.length!==32)return{...base,pass:false,errorCode:'PRIVATE_KEY_INVALID'};
    const publicKey=fromHex(wallet.publicKey),signature=secp256k1.sign(digest,privateKey);
    if(!secp256k1.verify(signature,digest,publicKey))return{...base,pass:false,errorCode:'SIGNATURE_FAILED'};
    return tronAddressFromPublicKey(publicKey)===wallet.address?{...base,pass:true}:{...base,pass:false,errorCode:'ADDRESS_MISMATCH'};
  }catch{return{...base,pass:false,errorCode:'PRIVATE_KEY_INVALID'}}finally{privateKey.fill(0);challenge.fill(0);digest.fill(0)}
}
