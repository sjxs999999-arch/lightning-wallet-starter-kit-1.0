import { getAddress, isAddress } from 'ethers';
import bs58 from 'bs58';
import { sha256 } from '@noble/hashes/sha2.js';
import type { TransferChain } from './types';

function validBase58(value:string,lengths:number[]){try{return lengths.includes(bs58.decode(value).length)}catch{return false}}
export function validateAddress(chain:TransferChain,value:string){
  if(chain==='EVM')return isAddress(value)&&getAddress(value)===value;
  if(chain==='SOL')return validBase58(value,[32]);
  if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value))return false;
  try{const decoded=bs58.decode(value);if(decoded.length!==25||decoded[0]!==0x41)return false;const checksum=sha256(sha256(decoded.slice(0,21))).slice(0,4);return checksum.every((byte,index)=>byte===decoded[index+21])}catch{return false}
}
export function validateAmount(value:string){return value.length<=100&&/^\d+(\.\d+)?$/.test(value)&&/[1-9]/.test(value)}
export function validateAmountScale(value:string,decimals:number){return validateAmount(value)&&(value.split('.')[1]?.length??0)<=decimals}
