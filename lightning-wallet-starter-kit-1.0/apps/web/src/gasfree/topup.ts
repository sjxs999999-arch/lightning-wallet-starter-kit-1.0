import { isAddress } from 'ethers';
import { resolveEvmProvider } from '../batch-transfer/executor';

export type GasTopUpState = 'submitted' | 'confirmed';
export type GasTopUpResult = { hash: string; state: GasTopUpState; account: string };
export type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

type TopUpOptions = {
  provider?: EthereumProvider;
  confirm?: (message: string) => boolean;
  pollAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
};

export class GasTopUpFailedError extends Error {
  constructor(message: string, readonly hash: string) {
    super(message);
    this.name = 'GasTopUpFailedError';
  }
}

function accounts(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && isAddress(item)) : [];
}

export async function executeSepoliaTopUp(destination: string, topUpWei: string, options: TopUpOptions = {}): Promise<GasTopUpResult> {
  if (!isAddress(destination)) throw new Error('补 Gas 目标地址无效');
  if (!/^\d+$/.test(topUpWei) || BigInt(topUpWei) <= 0n) throw new Error('补 Gas 数量必须是正整数 Wei');

  const selected = options.provider
    ? { provider: options.provider, address: accounts(await options.provider.request({ method: 'eth_accounts' }))[0] ?? '' }
    : await resolveEvmProvider();
  if (!selected.address) throw new Error('钱包未授权任何有效 EVM 账户');

  const chainId = String(await selected.provider.request({ method: 'eth_chainId' })).toLowerCase();
  if (chainId !== '0xaa36a7') throw new Error('请先将钱包切换到 Sepolia（Chain ID 11155111）');

  const transaction = { from: selected.address, to: destination, value: `0x${BigInt(topUpWei).toString(16)}` };
  const beforeEstimate = accounts(await selected.provider.request({ method: 'eth_accounts' }));
  if (!beforeEstimate.some(account => account.toLowerCase() === selected.address.toLowerCase())) throw new Error('钱包活动账户已变化，已阻止发送');
  await selected.provider.request({ method: 'eth_estimateGas', params: [transaction] });

  const confirmation = `网络：Sepolia\n发送账户：${selected.address}\n目标地址：${destination}\n补充数量：${topUpWei} Wei\n确认后将打开钱包签名。`;
  if (!(options.confirm ?? window.confirm)(confirmation)) throw new Error('用户取消签名');

  const beforeSend = accounts(await selected.provider.request({ method: 'eth_accounts' }));
  if (!beforeSend.some(account => account.toLowerCase() === selected.address.toLowerCase())) throw new Error('钱包活动账户已变化，已阻止发送');
  const hash = String(await selected.provider.request({ method: 'eth_sendTransaction', params: [transaction] }));
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('钱包未返回有效交易哈希');

  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  try {
    for (let attempt = 0; attempt < (options.pollAttempts ?? 20); attempt++) {
      const receipt = await selected.provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as { status?: string } | null;
      if (receipt?.status === '0x1') return { hash, state: 'confirmed', account: selected.address };
      if (receipt?.status === '0x0') throw new GasTopUpFailedError(`补 Gas 交易链上执行失败：${hash}`, hash);
      await wait(1_500);
    }
  } catch (cause) {
    if (cause instanceof GasTopUpFailedError) throw cause;
  }
  return { hash, state: 'submitted', account: selected.address };
}
