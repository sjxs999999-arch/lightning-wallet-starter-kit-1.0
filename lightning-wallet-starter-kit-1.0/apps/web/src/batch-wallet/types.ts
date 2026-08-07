export type BatchChain = 'EVM' | 'SOL' | 'TRON';
export interface EncryptedValue { ciphertext:string; iv:string; version:1 }
export interface LocalWalletRecord { id:string; name:string; chain:BatchChain; address:string; publicKey:string; path:string; index:number; encryptedPrivateKey:EncryptedValue; encryptedMnemonic:EncryptedValue; createdAt:string }
export interface WalletControlResult { walletId:string; address:string; pass:boolean; errorCode?:'DECRYPT_FAILED'|'PRIVATE_KEY_INVALID'|'SIGNATURE_FAILED'|'ADDRESS_MISMATCH' }
