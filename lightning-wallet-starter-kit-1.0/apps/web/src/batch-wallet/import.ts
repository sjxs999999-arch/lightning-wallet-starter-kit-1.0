import { computeAddress } from 'ethers';
import bs58 from 'bs58';
import { validateAddress } from '../batch-transfer/validation';
import { pathFor } from './engine';
import type { BatchChain, EncryptedValue, LocalWalletRecord } from './types';
import { tronAddressFromPublicKey } from './verification';

type Backup = {
  format: string;
  algorithm: string;
  kdf: { name: string; iterations: number; salt: string };
  wallets: unknown[];
};

const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
const hexBytes = (value: string) => Uint8Array.from(value.replace(/^0x/, '').match(/.{2}/g) ?? [], part => Number.parseInt(part, 16));
const forbidden = new Set(['privatekey', 'private_key', 'mnemonic', 'seed', 'secret']);
const walletKeys = new Set(['id', 'name', 'chain', 'address', 'publicKey', 'path', 'index', 'encryptedPrivateKey', 'encryptedMnemonic', 'createdAt']);

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every(key => allowed.has(key));
}

function encrypted(value: unknown): value is EncryptedValue {
  const item = value as Partial<EncryptedValue> | null;
  return Boolean(
    item
      && typeof item === 'object'
      && onlyKeys(item as Record<string, unknown>, new Set(['version', 'ciphertext', 'iv']))
      && item.version === 1
      && typeof item.ciphertext === 'string'
      && item.ciphertext.length > 20
      && base64.test(item.ciphertext)
      && typeof item.iv === 'string'
      && item.iv.length >= 16
      && base64.test(item.iv),
  );
}

function containsForbidden(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Object.entries(value).some(([key, nested]) => forbidden.has(key.toLowerCase()) || containsForbidden(nested)));
}

function validPublicKey(chain: BatchChain, publicKey: string) {
  if (chain === 'EVM') return /^0x0[23][0-9a-f]{64}$/i.test(publicKey);
  if (chain === 'TRON') return /^0x04[0-9a-f]{128}$/i.test(publicKey);
  try {
    return bs58.decode(publicKey).length === 32;
  } catch {
    return false;
  }
}

function publicKeyMatchesAddress(chain: BatchChain, publicKey: string, address: string) {
  try {
    if (chain === 'EVM') return computeAddress(publicKey) === address;
    if (chain === 'SOL') return publicKey === address;
    return tronAddressFromPublicKey(hexBytes(publicKey)) === address;
  } catch {
    return false;
  }
}

export function parseEncryptedWalletBackup(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('加密备份超过 5 MB，已拒绝导入');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('加密 JSON 格式无效');
  }
  const backup = raw as Partial<Backup> | null;
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) || !onlyKeys(backup as Record<string, unknown>, new Set(['format', 'algorithm', 'kdf', 'wallets'])) || backup.format !== 'lightning-wallet-encrypted-v1' || backup.algorithm !== 'AES-256-GCM') {
    throw new Error('不支持的闪电钱包加密备份');
  }
  if (!backup.kdf || typeof backup.kdf !== 'object' || !onlyKeys(backup.kdf as unknown as Record<string, unknown>, new Set(['name', 'iterations', 'salt'])) || backup.kdf.name !== 'PBKDF2-SHA-256' || backup.kdf.iterations !== 600000 || typeof backup.kdf.salt !== 'string' || !base64.test(backup.kdf.salt)) {
    throw new Error('加密参数不受支持或已损坏');
  }
  if (!Array.isArray(backup.wallets) || !backup.wallets.length || backup.wallets.length > 1000) throw new Error('钱包数量必须为 1–1000');

  const ids = new Set<string>();
  const addresses = new Set<string>();
  const indices = new Set<number>();
  const chains = new Set<BatchChain>();
  const wallets = backup.wallets.map((value, index) => {
    const item = value as Record<string, unknown>;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`第 ${index + 1} 个钱包记录无效`);
    if (containsForbidden(item)) throw new Error('备份包含明文私钥、助记词或敏感字段，已拒绝导入');
    if (!onlyKeys(item, walletKeys)) throw new Error(`第 ${index + 1} 个钱包记录无效`);
    if (item.chain !== 'EVM' && item.chain !== 'SOL' && item.chain !== 'TRON') throw new Error(`第 ${index + 1} 个钱包网络无效`);
    const chain = item.chain;
    if (
      typeof item.id !== 'string' || !item.id || item.id.length > 128
      || typeof item.name !== 'string' || !item.name || item.name.length > 128
      || typeof item.address !== 'string' || !validateAddress(chain, item.address)
      || typeof item.publicKey !== 'string' || !validPublicKey(chain, item.publicKey) || !publicKeyMatchesAddress(chain, item.publicKey, item.address)
      || typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0 || item.index > 999
      || item.path !== pathFor(chain, item.index)
      || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))
      || !encrypted(item.encryptedPrivateKey) || !encrypted(item.encryptedMnemonic)
    ) throw new Error(`第 ${index + 1} 个钱包记录字段无效`);
    if (ids.has(item.id) || addresses.has(item.address) || indices.has(item.index)) throw new Error(`第 ${index + 1} 个钱包记录重复`);
    ids.add(item.id);
    addresses.add(item.address);
    indices.add(item.index);
    chains.add(chain);
    return item as unknown as LocalWalletRecord;
  });
  if (chains.size !== 1) throw new Error('一个加密备份只能包含同一网络的钱包');
  return { wallets, salt: backup.kdf.salt, chain: wallets[0]!.chain };
}
