import type { EncryptedValue, LocalWalletRecord } from './types';
import { validateAddress } from '../batch-transfer/validation';

type Backup={format:string;algorithm:string;kdf:{name:string;iterations:number;salt:string};wallets:unknown[]};
const base64=/^[A-Za-z0-9+/]+={0,2}$/;
const encrypted=(value:unknown):value is EncryptedValue=>{const item=value as Partial<EncryptedValue>|null;return Boolean(item&&item.version===1&&typeof item.ciphertext==='string'&&item.ciphertext.length>20&&base64.test(item.ciphertext)&&typeof item.iv==='string'&&item.iv.length>=16&&base64.test(item.iv))};
const forbidden=new Set(['privatekey','private_key','mnemonic','seed','secret']);
const containsForbidden=(value:unknown):boolean=>Boolean(value&&typeof value==='object'&&Object.entries(value).some(([key,nested])=>forbidden.has(key.toLowerCase())||containsForbidden(nested)));

export function parseEncryptedWalletBackup(text:string){
  let raw:unknown;try{raw=JSON.parse(text)}catch{throw new Error('加密 JSON 格式无效')}
  const backup=raw as Partial<Backup>|null;
  if(!backup||backup.format!=='lightning-wallet-encrypted-v1'||backup.algorithm!=='AES-256-GCM')throw new Error('不支持的闪电钱包加密备份');
  if(backup.kdf?.name!=='PBKDF2-SHA-256'||backup.kdf.iterations!==600000||typeof backup.kdf.salt!=='string'||!base64.test(backup.kdf.salt))throw new Error('加密参数不受支持或已损坏');
  if(!Array.isArray(backup.wallets)||!backup.wallets.length||backup.wallets.length>1000)throw new Error('钱包数量必须为 1–1000');
  const ids=new Set<string>(),addresses=new Set<string>();
  const wallets=backup.wallets.map((value,index)=>{
    const item=value as Record<string,unknown>;
    if(!item||typeof item!=='object')throw new Error(`第 ${index+1} 个钱包记录无效`);
    if(containsForbidden(item))throw new Error('备份包含明文私钥、助记词或敏感字段，已拒绝导入');
    if(item.chain!=='TRON'||typeof item.id!=='string'||!item.id||typeof item.name!=='string'||!item.name||typeof item.address!=='string'||!validateAddress('TRON',item.address)||typeof item.publicKey!=='string'||!/^0x04[0-9a-f]{128}$/i.test(item.publicKey)||typeof item.index!=='number'||!Number.isInteger(item.index)||item.index<0||item.path!==`m/44'/195'/0'/0/${item.index}`||typeof item.createdAt!=='string'||!Number.isFinite(Date.parse(item.createdAt))||!encrypted(item.encryptedPrivateKey)||!encrypted(item.encryptedMnemonic))throw new Error(`第 ${index+1} 个钱包记录字段无效`);
    if(ids.has(item.id)||addresses.has(item.address))throw new Error(`第 ${index+1} 个钱包记录重复`);ids.add(item.id);addresses.add(item.address);
    return item as unknown as LocalWalletRecord;
  });
  return{wallets,salt:backup.kdf.salt};
}
