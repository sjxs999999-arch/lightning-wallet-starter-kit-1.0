import { describe,expect,it } from 'vitest';
import { parseEncryptedWalletBackup } from './import';
import { createExportKey,decryptValue,deriveExportKey,encryptValue } from './crypto';
import { deriveWallet,newMnemonic } from './engine';
import { verifyTronControl } from './verification';

const encrypted={ciphertext:'QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB',iv:'QUFBQUFBQUFBQUFB',version:1};
const backup={format:'lightning-wallet-encrypted-v1',algorithm:'AES-256-GCM',kdf:{name:'PBKDF2-SHA-256',iterations:600000,salt:'QUFBQUFBQUFBQUFBQUFBQQ=='},wallets:[{id:'one',name:'TRON-Wallet-0001',chain:'TRON',address:'TJhUSDcqe9Efq2b7UNhKq619FrReEXoRjQ',publicKey:`0x04${'11'.repeat(64)}`,path:"m/44'/195'/0'/0/0",index:0,encryptedPrivateKey:encrypted,encryptedMnemonic:encrypted,createdAt:'2026-08-07T00:00:00.000Z'}]};
describe('encrypted wallet backup import',()=>{
  it('loads only encrypted TRON records and preserves the salt',()=>{const result=parseEncryptedWalletBackup(JSON.stringify(backup));expect(result.wallets).toHaveLength(1);expect(result.salt).toBe(backup.kdf.salt)});
  it('rejects plaintext secret fields',()=>{expect(()=>parseEncryptedWalletBackup(JSON.stringify({...backup,wallets:[{...backup.wallets[0],privateKey:'secret'}]}))).toThrow(/明文私钥/)});
  it('rejects unsupported formats and excessive batches',()=>{expect(()=>parseEncryptedWalletBackup('{}')).toThrow(/不支持/);expect(()=>parseEncryptedWalletBackup(JSON.stringify({...backup,wallets:Array(1001).fill(backup.wallets[0])}))).toThrow(/1–1000/)});
  it('restores an encrypted wallet and verifies control without exposing secrets in JSON',async()=>{const wallet=await deriveWallet('TRON',newMnemonic(),0),password='unique-offline-password',derived=await createExportKey(password),record={id:'roundtrip',name:'TRON-Wallet-0001',chain:'TRON' as const,address:wallet.address,publicKey:wallet.publicKey,path:wallet.path,index:0,encryptedPrivateKey:await encryptValue(derived.key,wallet.privateKey),encryptedMnemonic:await encryptValue(derived.key,wallet.mnemonic),createdAt:new Date().toISOString()},json=JSON.stringify({...backup,kdf:{...backup.kdf,salt:derived.salt},wallets:[record]});expect(json).not.toContain(wallet.privateKey);expect(json).not.toContain(wallet.mnemonic);const imported=parseEncryptedWalletBackup(json),key=await deriveExportKey(password,imported.salt),privateKey=await decryptValue(key,imported.wallets[0]!.encryptedPrivateKey);expect(verifyTronControl(imported.wallets[0]!,privateKey).pass).toBe(true)});
});
