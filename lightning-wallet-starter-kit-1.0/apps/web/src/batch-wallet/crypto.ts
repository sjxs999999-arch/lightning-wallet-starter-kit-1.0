import type { EncryptedValue } from './types';
const encoder=new TextEncoder(); const decoder=new TextDecoder(); const ITERATIONS=600_000;
const bytes=(size:number)=>{const value=new Uint8Array(size);crypto.getRandomValues(value);return value};
const b64=(value:Uint8Array)=>btoa(String.fromCharCode(...value));
const unb64=(value:string)=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
export async function createExportKey(password:string){if(password.length<12)throw new Error('导出密码至少需要 12 个字符');const salt=bytes(16);return{key:await deriveExportKey(password,b64(salt)),salt:b64(salt)}}
export async function deriveExportKey(password:string,salt:string){const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:unb64(salt),iterations:ITERATIONS},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
export async function encryptValue(key:CryptoKey,value:string):Promise<EncryptedValue>{const iv=bytes(12);const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,encoder.encode(value));return{ciphertext:b64(new Uint8Array(encrypted)),iv:b64(iv),version:1}}
export async function decryptValue(key:CryptoKey,value:EncryptedValue){try{return decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(value.iv)},key,unb64(value.ciphertext)))}catch{throw new Error('密码错误或加密数据已损坏')}}
