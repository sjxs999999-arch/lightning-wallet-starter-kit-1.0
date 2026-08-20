import { decryptBytes } from '../batch-wallet/crypto';
import type { LocalSignedPayload, LocalSigningPayload, LocalSigningWallet } from './local-transfer-types';

export type LocalSigningErrorCode = 'DECRYPT_FAILED' | 'KEY_MISMATCH' | 'PAYLOAD_INVALID' | 'SIGNING_FAILED';
const decoder = new TextDecoder('utf-8', { fatal: true });

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function evmTransaction(value: Record<string, string | number>) {
  const bigintFields = ['gasLimit', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas', 'value'];
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bigintFields.includes(key) ? BigInt(item) : item]));
}

export async function signLocalPayload(key: CryptoKey, wallet: LocalSigningWallet, payload: LocalSigningPayload): Promise<LocalSignedPayload> {
  let plaintext = new Uint8Array();
  let privateKey = '';
  let solanaSecret: Uint8Array<ArrayBufferLike> = new Uint8Array();
  try {
    if (!key || !wallet || !payload || wallet.chain !== payload.chain) throw new Error('PAYLOAD_INVALID');
    try { plaintext = await decryptBytes(key, wallet.encryptedPrivateKey); }
    catch { throw new Error('DECRYPT_FAILED'); }
    try { privateKey = decoder.decode(plaintext); }
    catch { throw new Error('DECRYPT_FAILED'); }
    if (payload.chain === 'EVM') {
      const { Wallet } = await import('ethers');
      const signer = new Wallet(privateKey);
      if (signer.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('KEY_MISMATCH');
      return { chain: 'EVM', signedTransaction: await signer.signTransaction(evmTransaction(payload.transaction)) };
    }
    if (payload.chain === 'SOL') {
      const [{ default: bs58 }, { Keypair, Transaction }] = await Promise.all([import('bs58'), import('@solana/web3.js')]);
      solanaSecret = bs58.decode(privateKey);
      const keypair = Keypair.fromSecretKey(solanaSecret);
      if (keypair.publicKey.toBase58() !== wallet.address) throw new Error('KEY_MISMATCH');
      const transaction = Transaction.from(fromBase64(payload.transaction));
      transaction.sign(keypair);
      return { chain: 'SOL', signedTransaction: transaction.serialize().buffer as ArrayBuffer };
    }
    const { TronWeb, utils: tronUtils } = await import('tronweb');
    const normalized = privateKey.replace(/^0x/, '');
    if (TronWeb.address.fromPrivateKey(normalized) !== wallet.address) throw new Error('KEY_MISMATCH');
    return { chain: 'TRON', signedTransaction: tronUtils.crypto.signTransaction(normalized, payload.transaction) as unknown as Record<string, unknown> };
  } finally {
    plaintext.fill(0);solanaSecret.fill(0);privateKey = '';
  }
}
