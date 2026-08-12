import { decryptBytes } from './crypto';
import type { EncryptedValue } from './types';

export async function validateEncryptedValue(key:CryptoKey,value:EncryptedValue){let plaintext=new Uint8Array();try{plaintext=await decryptBytes(key,value);return plaintext.length>0}catch{return false}finally{plaintext.fill(0)}}
