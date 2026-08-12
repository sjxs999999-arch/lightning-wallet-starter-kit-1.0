import type { EncryptedVault } from './types';

const DATABASE = 'lightning-chat';
const STORE = 'vault';
const KEY = 'primary';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开聊天本地数据库'));
  });
}

export async function loadVault(): Promise<EncryptedVault | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as EncryptedVault | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

export async function saveVault(vault: EncryptedVault) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE, 'readwrite').objectStore(STORE).put(vault, KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}
