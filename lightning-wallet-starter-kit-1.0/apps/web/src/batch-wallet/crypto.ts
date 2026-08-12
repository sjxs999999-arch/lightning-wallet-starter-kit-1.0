import type { EncryptedValue } from './types';
const encoder=new TextEncoder(); const decoder=new TextDecoder(); const ITERATIONS=600_000;
const bytes=(size:number)=>{const value=new Uint8Array(size);crypto.getRandomValues(value);return value};
const b64=(value:Uint8Array)=>btoa(String.fromCharCode(...value));
const unb64=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
export async function createExportKey(password:string){if(password.length<12)throw new Error('导出密码至少需要 12 个字符');const salt=bytes(16);return{key:await deriveExportKey(password,b64(salt)),salt:b64(salt)}}
export async function deriveExportKey(password:string,salt:string){const passwordBytes=encoder.encode(password),saltBytes=unb64(salt);try{const material=await crypto.subtle.importKey('raw',passwordBytes,'PBKDF2',false,['deriveKey']);return await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:saltBytes,iterations:ITERATIONS},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}finally{passwordBytes.fill(0);saltBytes.fill(0)}}
export async function encryptValue(key:CryptoKey,value:string):Promise<EncryptedValue>{const iv=bytes(12),plaintext=encoder.encode(value);try{const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plaintext);return{ciphertext:b64(new Uint8Array(encrypted)),iv:b64(iv),version:1}}finally{plaintext.fill(0);iv.fill(0)}}
export async function encryptBytes(key:CryptoKey,value:Uint8Array):Promise<EncryptedValue>{const iv=bytes(12),plaintext=value.slice();try{const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plaintext);return{ciphertext:b64(new Uint8Array(encrypted)),iv:b64(iv),version:1}}finally{plaintext.fill(0);iv.fill(0)}}
export async function decryptBytes(key:CryptoKey,value:EncryptedValue){const iv=unb64(value.iv),ciphertext=unb64(value.ciphertext);try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},key,ciphertext))}catch{throw new Error('密码错误或加密数据已损坏')}finally{iv.fill(0);ciphertext.fill(0)}}
export async function decryptValue(key:CryptoKey,value:EncryptedValue){const plaintext=await decryptBytes(key,value);try{return decoder.decode(plaintext)}finally{plaintext.fill(0)}}
