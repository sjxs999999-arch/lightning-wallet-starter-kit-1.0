import { HDKey } from '@scure/bip32';
import { entropyToMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { Wallet, SigningKey, getAddress, keccak256 } from 'ethers';
import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import type { BatchChain } from './types';

const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string) => Uint8Array.from(value.replace(/^0x/, '').match(/.{2}/g) ?? [], part => parseInt(part, 16));
const concat = (...values: Uint8Array[]) => {
  const result = new Uint8Array(values.reduce((total, value) => total + value.length, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
};
const ser32 = (value: number) => new Uint8Array([
  (value >>> 24) & 255,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
]);

async function hmac(key: Uint8Array, data: Uint8Array) {
  const keyCopy = Uint8Array.from(key);
  const dataCopy = Uint8Array.from(data);
  try {
    const imported = await crypto.subtle.importKey(
      'raw',
      keyCopy.buffer,
      { name: 'HMAC', hash: 'SHA-512' },
      false,
      ['sign'],
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', imported, dataCopy.buffer));
  } finally {
    keyCopy.fill(0);
    dataCopy.fill(0);
  }
}

async function ed25519Seed(seed: Uint8Array, path: string) {
  const label = new TextEncoder().encode('ed25519 seed');
  const digest = await hmac(label, seed);
  let key = digest.slice(0, 32);
  let chain = digest.slice(32);
  let completed = false;
  label.fill(0);
  digest.fill(0);
  try {
    for (const part of path.split('/').slice(1)) {
      const index = Number(part.replace("'", '')) + 0x80000000;
      const data = concat(new Uint8Array([0]), key, ser32(index));
      const next = await hmac(chain, data);
      data.fill(0);
      key.fill(0);
      chain.fill(0);
      key = next.slice(0, 32);
      chain = next.slice(32);
      next.fill(0);
    }
    completed = true;
    return key;
  } finally {
    if (!completed) key.fill(0);
    chain.fill(0);
  }
}

export const newMnemonic = () => {
  const entropy = new Uint8Array(16);
  crypto.getRandomValues(entropy);
  try {
    return entropyToMnemonic(entropy, wordlist);
  } finally {
    entropy.fill(0);
  }
};

export const isValidMnemonic = (mnemonic: string) => validateMnemonic(mnemonic, wordlist);

export const pathFor = (chain: BatchChain, index: number) => chain === 'SOL'
  ? `m/44'/501'/${index}'/0'`
  : chain === 'TRON'
    ? `m/44'/195'/0'/0/${index}`
    : `m/44'/60'/0'/0/${index}`;

export interface PublicDerivedWallet {
  address: string;
  publicKey: string;
  path: string;
  index: number;
}

async function derivePublicWalletFromSeed(
  chain: BatchChain,
  seed: Uint8Array,
  index: number,
): Promise<PublicDerivedWallet> {
  const path = pathFor(chain, index);
  if (chain === 'SOL') {
    const seed32 = await ed25519Seed(seed, path);
    try {
      const publicKey = bs58.encode(ed25519.getPublicKey(seed32));
      return { address: publicKey, publicKey, path, index };
    } finally {
      seed32.fill(0);
    }
  }

  const node = HDKey.fromMasterSeed(seed).derive(path);
  const privateBytes = node.privateKey;
  if (!privateBytes) throw new Error('无法派生私钥');
  try {
    const publicBytes = secp256k1.getPublicKey(privateBytes, false);
    try {
      if (chain === 'EVM') {
        const compressed = secp256k1.getPublicKey(privateBytes, true);
        try {
          const addressBytes = fromHex(keccak256(publicBytes.slice(1))).slice(-20);
          const address = getAddress(`0x${hex(addressBytes)}`);
          addressBytes.fill(0);
          return { address, publicKey: `0x${hex(compressed)}`, path, index };
        } finally {
          compressed.fill(0);
        }
      }

      const publicKey = `0x${hex(publicBytes)}`;
      const hashBytes = fromHex(keccak256(publicBytes.slice(1)));
      const body = concat(new Uint8Array([0x41]), hashBytes.slice(-20));
      const checksum = sha256(sha256(body)).slice(0, 4);
      const encoded = concat(body, checksum);
      try {
        return { address: bs58.encode(encoded), publicKey, path, index };
      } finally {
        hashBytes.fill(0);
        body.fill(0);
        checksum.fill(0);
        encoded.fill(0);
      }
    } finally {
      publicBytes.fill(0);
    }
  } finally {
    privateBytes.fill(0);
  }
}

/**
 * Re-derive only public wallet metadata for a shared mnemonic. The BIP39 seed is
 * created once for the whole batch and no per-wallet private-key or mnemonic
 * strings are constructed.
 */
export async function deriveWalletPublicBatch(
  chain: BatchChain,
  mnemonic: string,
  indices: readonly number[],
  onProgress?: (completed: number, total: number) => void,
) {
  if (!isValidMnemonic(mnemonic)) throw new Error('BIP39 助记词无效');
  const seed = mnemonicToSeedSync(mnemonic);
  const wallets: PublicDerivedWallet[] = [];
  const total = indices.length;
  try {
    for (let offset = 0; offset < total; offset++) {
      wallets.push(await derivePublicWalletFromSeed(chain, seed, indices[offset]!));
      const completed = offset + 1;
      if (completed % 25 === 0 || completed === total) onProgress?.(completed, total);
    }
    return wallets;
  } finally {
    seed.fill(0);
  }
}

export async function deriveWallet(chain: BatchChain, mnemonic: string, index: number) {
  if (!isValidMnemonic(mnemonic)) throw new Error('BIP39 助记词无效');
  const seed = mnemonicToSeedSync(mnemonic);
  const path = pathFor(chain, index);
  try {
    if (chain === 'SOL') {
      const seed32 = await ed25519Seed(seed, path);
      const publicBytes = ed25519.getPublicKey(seed32);
      const publicKey = bs58.encode(publicBytes);
      const secret = concat(seed32, publicBytes);
      try {
        return { address: publicKey, publicKey, privateKey: bs58.encode(secret), mnemonic, path, index };
      } finally {
        seed32.fill(0);
        secret.fill(0);
      }
    }

    const node = HDKey.fromMasterSeed(seed).derive(path);
    const privateBytes = node.privateKey;
    if (!privateBytes) throw new Error('无法派生私钥');
    try {
      const privateKey = `0x${hex(privateBytes)}`;
      if (chain === 'EVM') {
        const wallet = new Wallet(privateKey);
        return {
          address: wallet.address,
          publicKey: SigningKey.computePublicKey(privateKey, true),
          privateKey,
          mnemonic,
          path,
          index,
        };
      }
      const publicKey = SigningKey.computePublicKey(privateKey, false);
      const publicBytes = fromHex(publicKey);
      const body = concat(new Uint8Array([0x41]), fromHex(keccak256(publicBytes.slice(1))).slice(-20));
      const checksum = sha256(sha256(body)).slice(0, 4);
      return {
        address: bs58.encode(concat(body, checksum)),
        publicKey,
        privateKey,
        mnemonic,
        path,
        index,
      };
    } finally {
      privateBytes.fill(0);
    }
  } finally {
    seed.fill(0);
  }
}

export function deriveWalletFromPrivateKey(chain: BatchChain, input: string) {
  if (chain === 'SOL') {
    let secret: Uint8Array;
    try {
      secret = bs58.decode(input.trim());
    } catch {
      throw new Error('Solana 私钥必须是 Base58 编码');
    }
    try {
      if (secret.length !== 64) throw new Error('Solana 私钥解码后必须为 64 字节');
      const publicBytes = ed25519.getPublicKey(secret.slice(0, 32));
      try {
        const embedded = secret.slice(32);
        const matches = embedded.every((byte, index) => byte === publicBytes[index]);
        embedded.fill(0);
        if (!matches) throw new Error('Solana 私钥中的公钥部分不匹配');
        const publicKey = bs58.encode(publicBytes);
        return { address: publicKey, publicKey, privateKey: bs58.encode(secret) };
      } finally {
        publicBytes.fill(0);
      }
    } finally {
      secret.fill(0);
    }
  }

  const normalized = input.trim().startsWith('0x') ? input.trim() : `0x${input.trim()}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error(`${chain} 私钥必须为 32 字节十六进制`);
  const wallet = new Wallet(normalized);
  if (chain === 'EVM') {
    return {
      address: wallet.address,
      publicKey: SigningKey.computePublicKey(normalized, true),
      privateKey: normalized,
    };
  }
  const publicKey = SigningKey.computePublicKey(normalized, false);
  const publicBytes = fromHex(publicKey);
  const hashBytes = fromHex(keccak256(publicBytes.slice(1)));
  const body = concat(new Uint8Array([0x41]), hashBytes.slice(-20));
  const checksum = sha256(sha256(body)).slice(0, 4);
  const encoded = concat(body, checksum);
  try {
    return { address: bs58.encode(encoded), publicKey, privateKey: normalized };
  } finally {
    publicBytes.fill(0);
    hashBytes.fill(0);
    body.fill(0);
    checksum.fill(0);
    encoded.fill(0);
  }
}
