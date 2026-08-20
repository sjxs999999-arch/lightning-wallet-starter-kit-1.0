import { validateAddress } from '../batch-transfer/validation';
import type { BatchChain } from '../batch-wallet/types';

const ADDRESS_BOOK_KEY = 'lightning-wallet.address-book.v1';
const TOKEN_KEY = 'lightning-wallet.custom-tokens.v1';

export interface AddressBookEntry { id: string; label: string; chain: BatchChain; address: string }
export interface CustomToken { id: string; walletId: string; chain: BatchChain; symbol: string; address: string; decimals: number }

function loadArray<T>(key: string, storage: Pick<Storage, 'getItem'> = localStorage): T[] {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveArray<T>(key: string, value: T[], storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(key, JSON.stringify(value));
}

export const loadAddressBook = (storage?: Pick<Storage, 'getItem'>) => loadArray<AddressBookEntry>(ADDRESS_BOOK_KEY, storage);
export const saveAddressBook = (value: AddressBookEntry[], storage?: Pick<Storage, 'setItem'>) => saveArray(ADDRESS_BOOK_KEY, value, storage);
export const loadCustomTokens = (storage?: Pick<Storage, 'getItem'>) => loadArray<CustomToken>(TOKEN_KEY, storage);
export const saveCustomTokens = (value: CustomToken[], storage?: Pick<Storage, 'setItem'>) => saveArray(TOKEN_KEY, value, storage);

export function makeAddressBookEntry(label: string, chain: BatchChain, address: string): AddressBookEntry {
  const cleanLabel = label.trim();
  const cleanAddress = address.trim();
  if (!cleanLabel || cleanLabel.length > 80) throw new Error('联系人名称必须为 1–80 个字符');
  if (!validateAddress(chain, cleanAddress)) throw new Error('联系人地址格式或校验和无效');
  return { id: crypto.randomUUID(), label: cleanLabel, chain, address: cleanAddress };
}

export function makeCustomToken(walletId: string, chain: BatchChain, symbol: string, address: string, decimals: number): CustomToken {
  const cleanSymbol = symbol.trim().toUpperCase();
  const cleanAddress = address.trim();
  if (!/^[A-Z0-9._-]{1,16}$/.test(cleanSymbol)) throw new Error('Token 符号必须为 1–16 个字母或数字');
  if (!validateAddress(chain, cleanAddress)) throw new Error('Token 合约或 Mint 地址无效');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) throw new Error('Token 精度必须为 0–30');
  return { id: crypto.randomUUID(), walletId, chain, symbol: cleanSymbol, address: cleanAddress, decimals };
}
