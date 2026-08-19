import { Interface, parseEther, parseUnits } from 'ethers';
import { assertExecutionPolicy } from './execution-policy';
import type { TransferTask } from './types';

type Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
export type EvmBatchResult = { index: number; hash: string; state: 'submitted' | 'confirmed' };

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export function buildEvmCalls(tasks: TransferTask[]) {
  const tokenInterface = new Interface(['function transfer(address,uint256)']);
  return tasks.map(task => task.token ? {
    to: task.token,
    value: '0x0',
    data: tokenInterface.encodeFunctionData('transfer', [task.to, parseUnits(task.amount, task.decimals!)]),
  } : { to: task.to, value: `0x${parseEther(task.amount).toString(16)}` });
}

function selectedProvider(): Provider | undefined {
  return window.okxwallet ?? window.ethereum;
}

function unsupported(cause: unknown) {
  const value = cause as { code?: number; message?: string };
  return value?.code === 4200 || /unsupported|not supported|method not found/i.test(value?.message ?? '');
}

export async function executeEvmBatch(tasks: TransferTask[], provider: Provider | undefined = selectedProvider()): Promise<EvmBatchResult[] | null> {
  if (!provider || !tasks.length || !tasks.every(task => task.chain === 'EVM')) return null;
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  const from = tasks[0]!.from;
  if (!accounts.some(address => address.toLowerCase() === from.toLowerCase())) throw new Error('当前钱包账户与 CSV 发送钱包不一致');
  const chainId = String(await provider.request({ method: 'eth_chainId' }));
  assertExecutionPolicy(tasks, chainId);
  try { await provider.request({ method: 'wallet_getCapabilities', params: [from] }); }
  catch (cause) { if (unsupported(cause)) return null; throw cause; }
  let response: unknown;
  try {
    response = await provider.request({ method: 'wallet_sendCalls', params: [{ version: '2.0.0', chainId, from, atomicRequired: false, calls: buildEvmCalls(tasks) }] });
  } catch (cause) {
    if (unsupported(cause)) return null;
    throw cause;
  }
  const batchId = typeof response === 'string' ? response : String((response as { id?: unknown })?.id ?? '');
  if (!batchId) throw new Error('钱包未返回批量调用 ID，未标记为已发送');
  const fallback = tasks.map((_, index) => ({ index, hash: batchId, state: 'submitted' as const }));
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(1000);
    let status: { status?: number | string; receipts?: { transactionHash?: string; status?: string }[] };
    try { status = await provider.request({ method: 'wallet_getCallsStatus', params: [batchId] }) as typeof status; }
    catch (cause) { if (unsupported(cause)) return fallback; throw cause; }
    const code = Number(status.status);
    if (code >= 400) throw new Error(`钱包批量调用失败：${batchId}`);
    if (code >= 200 && code < 300) return tasks.map((_, index) => ({ index, hash: status.receipts?.[index]?.transactionHash ?? batchId, state: 'confirmed' }));
  }
  return fallback;
}
