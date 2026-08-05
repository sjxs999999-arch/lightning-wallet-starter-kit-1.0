import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Wallet, SigningKey, keccak256 } from 'ethers';
import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import type { BatchChain } from './types';
const hex=(value:Uint8Array)=>Array.from(value,b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=(value:string)=>Uint8Array.from(value.replace(/^0x/,'').match(/.{2}/g)??[],part=>parseInt(part,16));
const concat=(...values:Uint8Array[])=>{const result=new Uint8Array(values.reduce((n,v)=>n+v.length,0));let offset=0;for(const value of values){result.set(value,offset);offset+=value.length}return result};
const ser32=(value:number)=>new Uint8Array([(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255]);
async function hmac(key:Uint8Array,data:Uint8Array){const imported=await crypto.subtle.importKey('raw',Uint8Array.from(key).buffer,{name:'HMAC',hash:'SHA-512'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',imported,Uint8Array.from(data).buffer))}
async function ed25519Seed(seed:Uint8Array,path:string){let digest=await hmac(new TextEncoder().encode('ed25519 seed'),seed);let key=digest.slice(0,32);let chain=digest.slice(32);for(const part of path.split('/').slice(1)){const index=Number(part.replace("'",''))+0x80000000;digest=await hmac(chain,concat(new Uint8Array([0]),key,ser32(index)));key=digest.slice(0,32);chain=digest.slice(32)}return key}
export const newMnemonic=()=>{const entropy=new Uint8Array(16);crypto.getRandomValues(entropy);return entropyToMnemonic(entropy,wordlist)};
export const pathFor=(chain:BatchChain,index:number)=>chain==='SOL'?`m/44'/501'/${index}'/0'`:chain==='TRON'?`m/44'/195'/0'/0/${index}`:`m/44'/60'/0'/0/${index}`;
export async function deriveWallet(chain:BatchChain,mnemonic:string,index:number){if(!validateMnemonic(mnemonic,wordlist))throw new Error('BIP39 助记词无效');const seed=mnemonicToSeedSync(mnemonic);const path=pathFor(chain,index);if(chain==='SOL'){const seed32=await ed25519Seed(seed,path);const publicBytes=ed25519.getPublicKey(seed32);const publicKey=bs58.encode(publicBytes);return{address:publicKey,publicKey,privateKey:bs58.encode(concat(seed32,publicBytes)),mnemonic,path,index}}const node=HDKey.fromMasterSeed(seed).derive(path);if(!node.privateKey)throw new Error('无法派生私钥');const privateKey=`0x${hex(node.privateKey)}`;if(chain==='EVM'){const wallet=new Wallet(privateKey);return{address:wallet.address,publicKey:SigningKey.computePublicKey(privateKey,true),privateKey,mnemonic,path,index}}const publicKey=SigningKey.computePublicKey(privateKey,false);const publicBytes=fromHex(publicKey);const body=concat(new Uint8Array([0x41]),fromHex(keccak256(publicBytes.slice(1))).slice(-20));const checksum=sha256(sha256(body)).slice(0,4);return{address:bs58.encode(concat(body,checksum)),publicKey,privateKey,mnemonic,path,index}}
