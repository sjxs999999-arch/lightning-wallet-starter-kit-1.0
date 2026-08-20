import { Wallet } from 'ethers';
import type { BatchChain } from '../batch-wallet/types';
import { deriveWalletFromPrivateKey } from '../batch-wallet/engine';

export function importPrivateWallet(chain: BatchChain, privateKey: string) {
  return deriveWalletFromPrivateKey(chain, privateKey);
}

export async function importEvmKeystore(json: string, password: string) {
  if (new TextEncoder().encode(json).byteLength > 1024 * 1024) throw new Error('Keystore 文件超过 1 MB，已拒绝读取');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('Keystore JSON 格式无效'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Keystore JSON 格式无效');
  try {
    const wallet = await Wallet.fromEncryptedJson(json, password);
    return deriveWalletFromPrivateKey('EVM', wallet.privateKey);
  } catch {
    throw new Error('Keystore 密码错误或文件已损坏');
  }
}
