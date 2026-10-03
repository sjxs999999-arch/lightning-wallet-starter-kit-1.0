import type { VaultEnvelope, VaultWallet } from '../wallet-center/vault';
import type { LocalSignedPayload, LocalTransferDraft } from '../wallet-center/local-transfer-types';
import type { TransferChain, TransferTask } from './types';
import { localEvmNetwork, localEvmMainnetEnabled } from '../wallet-center/local-evm-network';
import type { PortfolioNetworkId } from '../wallet-center/portfolio-networks';
import { assertExecutionPolicy, executionPolicyConfig } from './execution-policy';

export type LocalVaultBatchResult = {
  index: number;
  hash?: string;
  state?: 'submitted' | 'confirmed';
  error?: string;
};

type LocalVaultBatchOptions = {
  networkId?: PortfolioNetworkId;
  waitUntilResumed(): Promise<void>;
  shouldStop(): boolean;
  onStart(index: number): void;
  onResult(result: LocalVaultBatchResult): void;
};

function sameAddress(chain: TransferChain, left: string, right: string) {
  return chain === 'EVM' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function walletsForChain(vault: VaultEnvelope | null, chain: TransferChain) {
  return (vault?.wallets ?? []).filter(wallet => wallet.chain === chain);
}

export function selectLocalWallet(vault: VaultEnvelope | null, chain: TransferChain, walletId: string, tasks: TransferTask[]) {
  const wallet = vault?.wallets.find(item => item.id === walletId && item.chain === chain);
  if (!wallet) throw new Error('请选择当前网络的本地加密钱包');
  const matching = tasks.filter(task => task.chain === chain && sameAddress(chain, task.from, wallet.address));
  if (!matching.length) throw new Error(`本地钱包 ${wallet.address} 与 CSV 发送钱包不一致`);
  return { wallet, tasks: matching };
}

function nativeAsset(chain: TransferChain) {
  if (chain === 'EVM') return { symbol: 'Sepolia ETH', decimals: 18 };
  if (chain === 'SOL') return { symbol: 'Devnet SOL', decimals: 9 };
  return { symbol: 'Testnet TRX', decimals: 6 };
}

export function localDraft(task: TransferTask, wallet: VaultWallet, networkId?: PortfolioNetworkId): LocalTransferDraft {
  if (!sameAddress(task.chain, task.from, wallet.address)) throw new Error('本地钱包与任务发送地址不一致');
  return {
    ...(task.chain === 'EVM' && networkId ? { networkId } : {}),
    walletId: wallet.id,
    chain: task.chain,
    from: task.from,
    to: task.to,
    amount: task.amount,
    asset: task.token
      ? { symbol: 'Token', address: task.token, decimals: task.decimals! }
      : task.chain === 'EVM' && networkId ? { symbol: localEvmNetwork(networkId).nativeSymbol, decimals: 18 } : nativeAsset(task.chain),
  };
}

export async function executeLocalVaultBatch(tasks: TransferTask[], wallet: VaultWallet, vaultKey: CryptoKey, options: LocalVaultBatchOptions) {
  if (!tasks.length) throw new Error('没有可执行交易');
  if (tasks.some(task => task.chain !== wallet.chain || !sameAddress(task.chain, task.from, wallet.address))) throw new Error('批次任务与本地钱包不一致');
  if (wallet.chain === 'EVM') {
    const network = localEvmNetwork(options.networkId);
    assertExecutionPolicy(tasks, network.evmChainId!, { ...executionPolicyConfig(), mainnetEnabled: localEvmMainnetEnabled() });
  }
  const [{ planLocalTransfer, broadcastLocalTransfer }, { signWithLocalWorker }] = await Promise.all([
    import('../wallet-center/local-transfer'),
    import('../wallet-center/local-signer'),
  ]);
  const results: LocalVaultBatchResult[] = [];
  for (const [index, task] of tasks.entries()) {
    await options.waitUntilResumed();
    if (options.shouldStop()) break;
    options.onStart(index);
    let signed: LocalSignedPayload | undefined;
    try {
      const plan = await planLocalTransfer(localDraft(task, wallet, options.networkId));
      if (options.shouldStop()) throw new Error('本地保险库已锁定；交易没有签名或广播');
      signed = await signWithLocalWorker(vaultKey, {
        id: wallet.id,
        chain: wallet.chain,
        address: wallet.address,
        encryptedPrivateKey: wallet.encryptedPrivateKey,
      }, plan.signingPayload);
      if (options.shouldStop()) throw new Error('本地保险库已锁定；已签名交易没有广播');
      const broadcast = await broadcastLocalTransfer(plan, signed);
      const result: LocalVaultBatchResult = { index, hash: broadcast.hash, state: broadcast.state };
      results.push(result);
      options.onResult(result);
    } catch (cause) {
      const result: LocalVaultBatchResult = { index, error: cause instanceof Error ? cause.message : '本地钱包执行失败' };
      results.push(result);
      options.onResult(result);
      break;
    } finally {
      if (signed?.chain === 'SOL') new Uint8Array(signed.signedTransaction).fill(0);
      signed = undefined;
    }
  }
  return results;
}
