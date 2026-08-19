import { Buffer } from 'buffer';
import { Interface, isAddress } from 'ethers';
import { api } from '../api';
import { getSolanaProvider } from '../batch-transfer/executor';
import { confirmedWalletAction } from './guard';
import type { SwapCandidate, SwapRequest } from './types';

type Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type TronWeb = { defaultAddress?: { base58?: string }; trx: { sign(tx: unknown): Promise<unknown>; sendRawTransaction(tx: unknown): Promise<{ result: boolean; txid: string }>; getTransactionInfo?(txId: string): Promise<{ id?: string; receipt?: { result?: string } }> } };
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitEvm(provider: Provider, hash: string) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === '0x0') throw new Error(`交易执行失败：${hash}`);
      return;
    }
    await sleep(1500);
  }
}

async function executeEvm(request: SwapRequest, quote: SwapCandidate) {
  const provider = window.okxwallet ?? window.ethereum as Provider | undefined;
  if (!provider || !quote.transaction?.to || !quote.transaction.data || !isAddress(quote.transaction.to)) throw new Error('EVM 钱包或聚合器交易数据不可用');
  const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts.some(address => address.toLowerCase() === request.taker.toLowerCase())) throw new Error('当前钱包账户与报价 taker 不一致');
  const chainId = String(await provider.request({ method: 'eth_chainId' }));
  if (Number.parseInt(chainId, 16) !== request.chainId) throw new Error(`当前钱包网络与报价 Chain ID ${request.chainId} 不一致`);
  if (quote.amountIn !== request.sellAmount) throw new Error('报价卖出数量已变化，请重新报价');
  const native = request.sellToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  if (quote.allowanceTarget && !native) {
    if (!isAddress(quote.allowanceTarget) || !isAddress(request.sellToken)) throw new Error('聚合器授权地址无效');
    await confirmedWalletAction(() => window.confirm(`需要授权本次精确卖出数量给聚合器：${quote.allowanceTarget}`), async () => {
      const data = new Interface(['function approve(address,uint256)']).encodeFunctionData('approve', [quote.allowanceTarget, request.sellAmount]);
      const hash = String(await provider.request({ method: 'eth_sendTransaction', params: [{ from: request.taker, to: request.sellToken, data, value: '0x0' }] }));
      await waitEvm(provider, hash);
      return hash;
    });
  }
  const hash = String(await provider.request({ method: 'eth_sendTransaction', params: [{ from: request.taker, to: quote.transaction.to, data: quote.transaction.data, value: quote.transaction.value ?? '0x0', ...(quote.transaction.gas ? { gas: quote.transaction.gas } : {}) }] }));
  await waitEvm(provider, hash);
  return hash;
}

async function executeSolana(request: SwapRequest, selected: SwapCandidate) {
  const wallet = getSolanaProvider();
  if (!wallet) throw new Error('Solana 钱包不可用');
  const connected = wallet.connect ? await wallet.connect() : undefined;
  const address = connected?.publicKey?.toString() ?? wallet.publicKey?.toString();
  if (address !== request.taker) throw new Error(`当前 Solana 账户 ${address ?? '未知'} 与报价 taker 不一致`);
  const prepared = (await api<{ data: { serializedTransaction: string; quote: { amountOut: string; priceImpactPct: number } } }>('/swap/solana-transaction', { method: 'POST', body: JSON.stringify({ sellToken: request.sellToken, buyToken: request.buyToken, sellAmount: request.sellAmount, taker: request.taker, slippageBps: request.slippageBps, priority: 'auto' }) })).data;
  if (BigInt(prepared.quote.amountOut) < BigInt(selected.minReceived)) throw new Error('实时 Solana 报价低于原最低收到数量，请重新报价');
  if (prepared.quote.priceImpactPct > 3) throw new Error('实时价格影响超过 3%，已停止签名');
  const { VersionedTransaction } = await import('@solana/web3.js');
  const transaction = VersionedTransaction.deserialize(Buffer.from(prepared.serializedTransaction, 'base64'));
  if (transaction.message.staticAccountKeys[0]?.toString() !== request.taker) throw new Error('Solana 交易付款人与当前钱包不一致');
  return (await wallet.signAndSendTransaction(transaction)).signature;
}

async function executeTron(request: SwapRequest, quote: SwapCandidate) {
  const global = window as unknown as { tronWeb?: TronWeb; okxwallet?: { tronLink?: { tronWeb?: TronWeb; request(args: { method: string }): Promise<{ code?: number }> } } };
  const link = global.okxwallet?.tronLink;
  if (link) { const result = await link.request({ method: 'tron_requestAccounts' }); if (result.code === 4001) throw new Error('用户拒绝连接 TRON 钱包'); }
  const tron = link?.tronWeb ?? global.tronWeb;
  if (!tron || !quote.transaction) throw new Error('TRON 钱包或 SunSwap 交易不可用');
  if (tron.defaultAddress?.base58 !== request.taker) throw new Error('当前 TRON 账户与报价 taker 不一致');
  const signed = await tron.trx.sign(quote.transaction);
  const result = await tron.trx.sendRawTransaction(signed);
  if (!result.result) throw new Error('TRON 广播失败');
  if (tron.trx.getTransactionInfo) for (let attempt = 0; attempt < 20; attempt++) {
    const info = await tron.trx.getTransactionInfo(result.txid).catch(() => null);
    if (info?.id) { if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error('TRON Swap 链上执行失败'); break; }
    await sleep(1500);
  }
  return result.txid;
}

export async function executeSwap(request: SwapRequest, quote: SwapCandidate) {
  if (import.meta.env.VITE_ENABLE_MAINNET_SWAP !== 'true') throw new Error('主网 Swap 默认关闭；仅允许 Dry Run');
  return confirmedWalletAction(() => window.confirm(`确认使用 ${quote.provider} 路由并请求钱包签名？\n最低收到：${quote.minReceived}`), async () => {
    if (request.chain === 'EVM') return executeEvm(request, quote);
    if (request.chain === 'SOL') return executeSolana(request, quote);
    return executeTron(request, quote);
  });
}
