import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getAddress, hashMessage, keccak256 } from 'ethers';
import bs58 from 'bs58';
import type { BatchChain, WalletControlResult } from './types';

const encoder=new TextEncoder();
const fromHex=(value:string)=>Uint8Array.from(value.replace(/^0x/,'').match(/.{2}/g)??[],part=>parseInt(part,16));
const concat=(...values:Uint8Array[])=>{const result=new Uint8Array(values.reduce((total,value)=>total+value.length,0));let offset=0;for(const value of values){result.set(value,offset);offset+=value.length}return result};
const hex=(value:Uint8Array)=>Array.from(value,byte=>byte.toString(16).padStart(2,'0')).join('');
const base=(wallet:{id:string;address:string})=>({walletId:wallet.id,address:wallet.address,signatureValid:false,addressMatched:false});

const base58Values=new Int16Array(128);base58Values.fill(-1);for(const[index,value]of Array.from('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz').entries())base58Values[value.charCodeAt(0)]=index;
const nibble=(value:number)=>value>=48&&value<=57?value-48:value>=65&&value<=70?value-55:value>=97&&value<=102?value-87:-1;

function decodeHexPrivateKey(value:Uint8Array){
  if(value.length!==66||value[0]!==48||(value[1]!==120&&value[1]!==88))return new Uint8Array();
  const output=new Uint8Array(32);
  for(let index=0;index<32;index++){const high=nibble(value[index*2+2]!),low=nibble(value[index*2+3]!);if(high<0||low<0){output.fill(0);return new Uint8Array()}output[index]=(high<<4)|low}
  return output;
}

function decodeBase58PrivateKey(value:Uint8Array){
  let zeros=0;while(zeros<value.length&&value[zeros]===49)zeros++;
  const littleEndian=new Uint8Array(value.length);let length=0;
  for(let index=zeros;index<value.length;index++){
    const byte=value[index]!,digit=byte<base58Values.length?base58Values[byte]??-1:-1;if(digit<0){littleEndian.fill(0);return new Uint8Array()}
    let carry=digit;
    for(let offset=0;offset<length;offset++){carry+=littleEndian[offset]!*58;littleEndian[offset]=carry&255;carry>>=8}
    while(carry>0){littleEndian[length++]=carry&255;carry>>=8}
  }
  const output=new Uint8Array(zeros+length);for(let index=0;index<length;index++)output[output.length-1-index]=littleEndian[index]!;littleEndian.fill(0);return output;
}

export function tronAddressFromPublicKey(publicKey:Uint8Array){
  if(publicKey.length!==65||publicKey[0]!==4)throw new Error('INVALID_PUBLIC_KEY');
  const body=concat(new Uint8Array([0x41]),fromHex(keccak256(publicKey.slice(1))).slice(-20));
  return bs58.encode(concat(body,sha256(sha256(body)).slice(0,4)));
}

function verifyTronSecret(wallet:{id:string;address:string;publicKey:string},secret:Uint8Array):WalletControlResult{
  const initial=base(wallet),challenge=new Uint8Array(48);let digest=new Uint8Array();
  try{
    if(secret.length!==32)return{...initial,pass:false,errorCode:'PRIVATE_KEY_INVALID'};
    crypto.getRandomValues(challenge);new DataView(challenge.buffer).setBigUint64(0,BigInt(Date.now()));digest=sha256(challenge);
    const publicKey=fromHex(wallet.publicKey),signature=secp256k1.sign(digest,secret,{prehash:false});
    if(!secp256k1.verify(signature,digest,publicKey,{prehash:false}))return{...initial,pass:false,errorCode:'SIGNATURE_FAILED'};
    return tronAddressFromPublicKey(publicKey)===wallet.address?{...initial,signatureValid:true,addressMatched:true,pass:true}:{...initial,signatureValid:true,pass:false,errorCode:'ADDRESS_MISMATCH'};
  }catch{return{...initial,pass:false,errorCode:'PRIVATE_KEY_INVALID'}}finally{challenge.fill(0);digest.fill(0)}
}

function verifySolanaSecret(wallet:{id:string;address:string;publicKey:string},secret:Uint8Array):WalletControlResult{
  const initial=base(wallet),challenge=new Uint8Array(48);let seed=new Uint8Array();
  try{
    if(secret.length!==64)return{...initial,pass:false,errorCode:'PRIVATE_KEY_INVALID'};
    crypto.getRandomValues(challenge);new DataView(challenge.buffer).setBigUint64(0,BigInt(Date.now()));seed=secret.slice(0,32);
    const derivedPublicKey=ed25519.getPublicKey(seed),signature=ed25519.sign(challenge,seed);
    if(!ed25519.verify(signature,challenge,derivedPublicKey))return{...initial,pass:false,errorCode:'SIGNATURE_FAILED'};
    const address=bs58.encode(derivedPublicKey),matched=address===wallet.address&&address===wallet.publicKey;
    return matched?{...initial,signatureValid:true,addressMatched:true,pass:true}:{...initial,signatureValid:true,pass:false,errorCode:'ADDRESS_MISMATCH'};
  }catch{return{...initial,pass:false,errorCode:'PRIVATE_KEY_INVALID'}}finally{seed.fill(0);challenge.fill(0)}
}

function verifyEvmSecret(wallet:{id:string;address:string},secret:Uint8Array):WalletControlResult{
  const initial=base(wallet),challenge=new Uint8Array(48);let digest=new Uint8Array();
  try{
    if(secret.length!==32)return{...initial,pass:false,errorCode:'PRIVATE_KEY_INVALID'};
    crypto.getRandomValues(challenge);new DataView(challenge.buffer).setBigUint64(0,BigInt(Date.now()));digest=fromHex(hashMessage(challenge));
    const signature=secp256k1.sign(digest,secret,{prehash:false,format:'recovered'}),recovered=secp256k1.recoverPublicKey(signature,digest,{prehash:false});
    if(!secp256k1.verify(signature,digest,recovered,{prehash:false,format:'recovered'}))return{...initial,pass:false,errorCode:'SIGNATURE_FAILED'};
    const publicKey=secp256k1.Point.fromBytes(recovered).toBytes(false),address=getAddress(`0x${hex(fromHex(keccak256(publicKey.slice(1))).slice(-20))}`);
    return address===getAddress(wallet.address)?{...initial,signatureValid:true,addressMatched:true,pass:true}:{...initial,signatureValid:true,pass:false,errorCode:'ADDRESS_MISMATCH'};
  }catch{return{...initial,pass:false,errorCode:'PRIVATE_KEY_INVALID'}}finally{challenge.fill(0);digest.fill(0)}
}

export async function verifyWalletControlBytes(chain:BatchChain,wallet:{id:string;address:string;publicKey:string},encodedPrivateKey:Uint8Array){
  let secret=new Uint8Array();
  try{secret=chain==='SOL'?decodeBase58PrivateKey(encodedPrivateKey):decodeHexPrivateKey(encodedPrivateKey);return chain==='SOL'?verifySolanaSecret(wallet,secret):chain==='EVM'?verifyEvmSecret(wallet,secret):verifyTronSecret(wallet,secret)}
  finally{secret.fill(0);encodedPrivateKey.fill(0)}
}

export function verifyWalletControl(chain:BatchChain,wallet:{id:string;address:string;publicKey:string},privateKey:string){return verifyWalletControlBytes(chain,wallet,encoder.encode(privateKey))}
export function verifyTronControl(wallet:{id:string;address:string;publicKey:string},privateKey:string){return verifyWalletControl('TRON',wallet,privateKey)}
export function verifySolanaControl(wallet:{id:string;address:string;publicKey:string},privateKey:string){return verifyWalletControl('SOL',wallet,privateKey)}
export function verifyEvmControl(wallet:{id:string;address:string;publicKey:string},privateKey:string){return verifyWalletControl('EVM',{...wallet,publicKey:''},privateKey)}
