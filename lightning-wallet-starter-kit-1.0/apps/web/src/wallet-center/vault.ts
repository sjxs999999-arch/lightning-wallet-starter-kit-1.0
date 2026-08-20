import { validateAddress } from '../batch-transfer/validation';
import { createExportKey, decryptValue, deriveExportKey, encryptValue } from '../batch-wallet/crypto';
import type { BatchChain, EncryptedValue } from '../batch-wallet/types';

export const WALLET_VAULT_STORAGE_KEY = 'lightning-wallet.local-vault.v1';
export const WALLET_VAULT_FORMAT = 'lightning-wallet-local-vault-v1';
const VERIFIER = 'lightning-wallet-vault-control-v1';
const MAX_WALLETS = 1000;

export type WalletOrigin = 'created' | 'mnemonic' | 'private-key' | 'keystore' | 'derived';

export interface VaultWallet {
  id: string;
  name: string;
  chain: BatchChain;
  address: string;
  publicKey: string;
  path: string;
  index: number;
  origin: WalletOrigin;
  hasMnemonic: boolean;
  encryptedPrivateKey: EncryptedValue;
  encryptedMnemonic: EncryptedValue;
  createdAt: string;
}

export interface VaultEnvelope {
  format: typeof WALLET_VAULT_FORMAT;
  algorithm: 'AES-256-GCM';
  kdf: { name: 'PBKDF2-SHA-256'; iterations: 600000; salt: string };
  verifier: EncryptedValue;
  wallets: VaultWallet[];
}

const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
const forbidden = new Set(['privatekey', 'private_key', 'mnemonic', 'seed', 'secret']);
const walletKeys = new Set(['id', 'name', 'chain', 'address', 'publicKey', 'path', 'index', 'origin', 'hasMnemonic', 'encryptedPrivateKey', 'encryptedMnemonic', 'createdAt']);

function onlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(value).every(key => allowed.has(key));
}

function encrypted(value: unknown): value is EncryptedValue {
  const item = value as Partial<EncryptedValue> | null;
  return Boolean(item && typeof item === 'object'
    && onlyKeys(item as Record<string, unknown>, new Set(['version', 'ciphertext', 'iv']))
    && item.version === 1
    && typeof item.ciphertext === 'string' && item.ciphertext.length > 20 && base64.test(item.ciphertext)
    && typeof item.iv === 'string' && item.iv.length >= 16 && base64.test(item.iv));
}

function containsForbidden(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Object.entries(value).some(([key, nested]) => forbidden.has(key.toLowerCase()) || containsForbidden(nested)));
}

export function parseVault(raw: string | null): VaultEnvelope | null {
  if (!raw) return null;
  if (new TextEncoder().encode(raw).byteLength > 5 * 1024 * 1024) throw new Error('本地钱包保险库超过 5 MB');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('本地钱包保险库已损坏'); }
  const vault = value as Partial<VaultEnvelope> | null;
  if (!vault || typeof vault !== 'object' || Array.isArray(vault) || containsForbidden(vault)
    || !onlyKeys(vault as Record<string, unknown>, new Set(['format', 'algorithm', 'kdf', 'verifier', 'wallets']))
    || vault.format !== WALLET_VAULT_FORMAT || vault.algorithm !== 'AES-256-GCM'
    || !vault.kdf || !onlyKeys(vault.kdf as unknown as Record<string, unknown>, new Set(['name', 'iterations', 'salt'])) || vault.kdf.name !== 'PBKDF2-SHA-256' || vault.kdf.iterations !== 600000 || !base64.test(vault.kdf.salt)
    || !encrypted(vault.verifier) || !Array.isArray(vault.wallets) || vault.wallets.length > MAX_WALLETS) {
    throw new Error('本地钱包保险库格式无效');
  }
  const ids = new Set<string>();
  const addresses = new Set<string>();
  for (const entry of vault.wallets) {
    const wallet = entry as unknown as Record<string, unknown>;
    if (!wallet || typeof wallet !== 'object' || Array.isArray(wallet) || !onlyKeys(wallet, walletKeys)
      || typeof wallet.id !== 'string' || !wallet.id || ids.has(wallet.id)
      || typeof wallet.name !== 'string' || !wallet.name || wallet.name.length > 128
      || (wallet.chain !== 'EVM' && wallet.chain !== 'SOL' && wallet.chain !== 'TRON')
      || typeof wallet.address !== 'string' || !validateAddress(wallet.chain, wallet.address)
      || addresses.has(`${wallet.chain}:${wallet.address}`)
      || typeof wallet.publicKey !== 'string' || !wallet.publicKey
      || typeof wallet.path !== 'string' || !wallet.path
      || typeof wallet.index !== 'number' || !Number.isInteger(wallet.index) || wallet.index < 0 || wallet.index >= MAX_WALLETS
      || !['created', 'mnemonic', 'private-key', 'keystore', 'derived'].includes(String(wallet.origin))
      || typeof wallet.hasMnemonic !== 'boolean'
      || !encrypted(wallet.encryptedPrivateKey)
      || !encrypted(wallet.encryptedMnemonic)
      || typeof wallet.createdAt !== 'string' || !Number.isFinite(Date.parse(wallet.createdAt))) {
      throw new Error('本地钱包保险库包含无效记录');
    }
    ids.add(wallet.id);
    addresses.add(`${wallet.chain}:${wallet.address}`);
  }
  return vault as VaultEnvelope;
}

export function loadVault(storage: Pick<Storage, 'getItem'> = localStorage) {
  return parseVault(storage.getItem(WALLET_VAULT_STORAGE_KEY));
}

export function saveVault(vault: VaultEnvelope, storage: Pick<Storage, 'setItem'> = localStorage) {
  if (vault.wallets.length > MAX_WALLETS) throw new Error(`本地保险库最多保存 ${MAX_WALLETS} 个钱包`);
  storage.setItem(WALLET_VAULT_STORAGE_KEY, JSON.stringify(vault));
}

export async function createVault(password: string) {
  const { key, salt } = await createExportKey(password);
  const verifier = await encryptValue(key, VERIFIER);
  const vault: VaultEnvelope = {
    format: WALLET_VAULT_FORMAT,
    algorithm: 'AES-256-GCM',
    kdf: { name: 'PBKDF2-SHA-256', iterations: 600000, salt },
    verifier,
    wallets: [],
  };
  return { key, vault };
}

export async function unlockVault(vault: VaultEnvelope, password: string) {
  const key = await deriveExportKey(password, vault.kdf.salt);
  const value = await decryptValue(key, vault.verifier);
  if (value !== VERIFIER) throw new Error('保险库密码错误或数据已损坏');
  return key;
}

export async function encryptVaultWallet(
  key: CryptoKey,
  wallet: Omit<VaultWallet, 'encryptedPrivateKey' | 'encryptedMnemonic' | 'hasMnemonic'>,
  privateKey: string,
  mnemonic?: string,
): Promise<VaultWallet> {
  const encryptedPrivateKey = await encryptValue(key, privateKey);
  const encryptedMnemonic = await encryptValue(key, mnemonic ?? '');
  return { ...wallet, hasMnemonic: Boolean(mnemonic), encryptedPrivateKey, encryptedMnemonic };
}
