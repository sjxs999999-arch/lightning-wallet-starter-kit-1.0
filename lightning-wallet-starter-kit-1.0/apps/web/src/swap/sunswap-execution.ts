import type { SwapCandidate, SwapRequest } from './types';
import { TRON_NATIVE_TOKEN, type InjectedTronWeb, type SunSwapWallet } from './tron-wallet';

const SUNSWAP_UNIVERSAL_ROUTER = 'TSJEtPuqHpvSaVnSwvCsngaeBxrGUzp95Q';
const SUNSWAP_PERMIT2 = 'TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9';
const SAFE_POOL_VERSIONS = new Set(['v1', 'v2', 'v3', 'v4', 'usdd202pool', '2pool', '2pooltusdusdt', 'old3pool', 'oldusdcpool', 'usdc2pooltusdusdt', 'usdj2pooltusdusdt', 'usdd2pooltusdusdt', 'usdt20psm', 'htxsun', 'wtrx']);

type JsonRecord = Record<string, unknown>;
export interface SafeSunRoute {
  amountIn: string; amountInRaw: string; amountOut: string; amountOutRaw: string; amountOutMinimum: string; amountOutMinimumRaw: string;
  inUsd: string; outUsd: string; impact: string; fee: string; containsUnverifiedHook: false;
  tokens: string[]; symbols: string[]; poolFees: string[]; poolVersions: string[]; poolKeys: Array<null | { token0: string; token1: string; hooks: string; fee: number; parameters: string }>; stepAmountsOut: string[];
}

const record = (value: unknown): JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const stringArray = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string') ? value as string[] : null;
const decimal = (value: unknown) => typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) && value.length <= 100 ? value : null;
const rawAmount = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) > 0n ? value : null;

function safePoolKeys(value: unknown, tokens: string[], poolFees: string[], poolVersions: string[]) {
  if (!Array.isArray(value) || value.length !== poolVersions.length) return null;
  const keys = value.map((candidate, index) => {
    if (poolVersions[index] !== 'v4') return candidate === null ? null : undefined;
    const key = record(candidate);
    if (Object.keys(key).some(name => !['token0', 'token1', 'hooks', 'fee', 'parameters'].includes(name))) return undefined;
    const token0 = typeof key.token0 === 'string' ? key.token0 : '', token1 = typeof key.token1 === 'string' ? key.token1 : '';
    const fee = typeof key.fee === 'number' && Number.isSafeInteger(key.fee) && key.fee >= 0 ? key.fee : null;
    const parameters = typeof key.parameters === 'string' && /^0x[0-9a-fA-F]{64}$/.test(key.parameters) ? key.parameters : '';
    const hop = new Set([tokens[index], tokens[index + 1]]);
    if (!hop.has(token0) || !hop.has(token1) || token0 === token1 || key.hooks !== TRON_NATIVE_TOKEN || fee === null || String(fee) !== poolFees[index] || !parameters) return undefined;
    return { token0, token1, hooks: TRON_NATIVE_TOKEN, fee, parameters };
  });
  return keys.some(key => key === undefined) ? null : keys as SafeSunRoute['poolKeys'];
}

export function validateExecutableSunRoute(request: SwapRequest, quote: SwapCandidate): SafeSunRoute {
  const raw = record(quote.raw), route = record(raw.sunRoute);
  const tokens = stringArray(route.tokens), symbols = stringArray(route.symbols), poolFees = stringArray(route.poolFees), poolVersions = stringArray(route.poolVersions), stepAmountsOut = stringArray(route.stepAmountsOut);
  const poolKeys = tokens && poolFees && poolVersions ? safePoolKeys(route.poolKeys, tokens, poolFees, poolVersions) : null;
  const amountInRaw = rawAmount(route.amountInRaw), amountOutRaw = rawAmount(route.amountOutRaw);
  if (
    quote.provider !== 'SUN.io Smart Router'
    || raw.source !== 'SUN.io Smart Router'
    || raw.network !== 'mainnet'
    || raw.verifiedHooksOnly !== true
    || route.containsUnverifiedHook !== false
    || !tokens || !symbols || !poolFees || !poolVersions || !poolKeys || !stepAmountsOut
    || poolVersions.length < 1 || poolVersions.length > 11 || poolVersions.some(value => !SAFE_POOL_VERSIONS.has(value))
    || tokens.length !== poolVersions.length + 1 || poolFees.length !== tokens.length || poolKeys.length !== poolVersions.length || stepAmountsOut.length !== poolVersions.length
    || tokens[0] !== request.sellToken || tokens.at(-1) !== request.buyToken
    || amountInRaw !== request.sellAmount || amountInRaw !== quote.amountIn || amountOutRaw !== quote.amountOut
    || (BigInt(amountOutRaw ?? '0') * BigInt(10_000 - request.slippageBps) / 10_000n).toString() !== quote.minReceived
    || !tokens.every(value => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value))
    || !symbols.every(value => /^[A-Za-z0-9 ._-]{1,32}$/.test(value))
    || !poolFees.every(value => /^\d{1,8}$/.test(value))
    || !stepAmountsOut.every(value => decimal(value) !== null)
  ) throw new Error('SUN.io 可执行路由验证失败，请重新报价');

  const fields = ['amountIn', 'amountOut', 'amountOutMinimum', 'amountOutMinimumRaw', 'inUsd', 'outUsd', 'impact', 'fee'] as const;
  if (fields.some(field => decimal(route[field]) === null)) throw new Error('SUN.io 可执行路由数值无效');
  return { amountIn: route.amountIn as string, amountInRaw, amountOut: route.amountOut as string, amountOutRaw, amountOutMinimum: route.amountOutMinimum as string, amountOutMinimumRaw: route.amountOutMinimumRaw as string, inUsd: route.inUsd as string, outUsd: route.outUsd as string, impact: route.impact as string, fee: route.fee as string, containsUnverifiedHook: false, tokens, symbols, poolFees, poolVersions, poolKeys, stepAmountsOut };
}

async function waitForConfirmation(tronWeb: InjectedTronWeb, txid: string) {
  if (!tronWeb.trx.getTransactionInfo) return;
  for (let attempt = 0; attempt < 30; attempt++) {
    const info = await tronWeb.trx.getTransactionInfo(txid).catch(() => null);
    if (info?.id) {
      if (info.receipt?.result && info.receipt.result !== 'SUCCESS') throw new Error(`TRON 链上执行失败：${txid}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1_500));
  }
  throw new Error(`TRON 确认超时：${txid}`);
}

async function readAllowance(tronWeb: InjectedTronWeb, owner: string, token: string) {
  if (!tronWeb.transactionBuilder) throw new Error('TRON 钱包不支持合约交易构建');
  const issuer = tronWeb.address?.toHex?.(owner) ?? owner;
  const result = await tronWeb.transactionBuilder.triggerConfirmedConstantContract(token, 'allowance(address,address)', { callValue: 0, feeLimit: 100_000_000 }, [{ type: 'address', value: owner }, { type: 'address', value: SUNSWAP_PERMIT2 }], issuer);
  const value = result.constant_result?.[0];
  if (!value || !/^[0-9a-f]+$/i.test(value)) throw new Error('无法读取 TRC-20 授权额度');
  return BigInt(`0x${value}`);
}

async function setAllowance(tronWeb: InjectedTronWeb, wallet: SunSwapWallet, owner: string, token: string, amount: string) {
  if (!tronWeb.transactionBuilder) throw new Error('TRON 钱包不支持合约交易构建');
  const unsigned = await tronWeb.transactionBuilder.triggerSmartContract(token, 'approve(address,uint256)', { callValue: 0, feeLimit: 150_000_000 }, [{ type: 'address', value: SUNSWAP_PERMIT2 }, { type: 'uint256', value: amount }], owner);
  const result = await wallet.signAndBroadcast(unsigned, 'mainnet');
  await waitForConfirmation(tronWeb, result.txid);
  return result.txid;
}

export async function ensureExactSunSwapAllowance(tronWeb: InjectedTronWeb, wallet: SunSwapWallet, owner: string, token: string, requiredAmount: string) {
  if (token === TRON_NATIVE_TOKEN) return [];
  const current = await readAllowance(tronWeb, owner, token), required = BigInt(requiredAmount), txids: string[] = [];
  if (current === required) return txids;
  if (current > 0n) txids.push(await setAllowance(tronWeb, wallet, owner, token, '0'));
  txids.push(await setAllowance(tronWeb, wallet, owner, token, requiredAmount));
  return txids;
}

export async function executeVerifiedSunSwap(request: SwapRequest, quote: SwapCandidate, tronWeb: InjectedTronWeb, wallet: SunSwapWallet, owner: string) {
  const sunRoute = validateExecutableSunRoute(request, quote);
  if (!tronWeb.transactionBuilder) throw new Error('TRON 钱包不支持合约交易构建');
  await ensureExactSunSwapAllowance(tronWeb, wallet, owner, request.sellToken, request.sellAmount);

  const [{ parseRouteAPIResponse, TradePlanner }, { AllowanceTransfer, PERMIT_TYPES }] = await Promise.all([
    import('@sun-protocol/universal-router-sdk'),
    import('@sun-protocol/permit2-sdk'),
  ]);
  let permitSingleWithSignature;
  if (request.sellToken !== TRON_NATIVE_TOKEN) {
    const permit2 = new AllowanceTransfer(tronWeb as never, SUNSWAP_PERMIT2, false);
    const now = Math.floor(Date.now() / 1_000), deadline = String(now + 1_200);
    const { domain, permitSingle } = await permit2.generatePermitSignData({ owner, token: request.sellToken, amount: BigInt(request.sellAmount), deadline }, SUNSWAP_UNIVERSAL_ROUTER, deadline);
    const signature = `0x${await wallet.signTypedData('PermitSingle', domain, PERMIT_TYPES, permitSingle as unknown as Record<string, unknown>)}` as `0x${string}`;
    permitSingleWithSignature = { signature, ...permitSingle };
  }

  const trade = parseRouteAPIResponse(sunRoute, false, { slippageBips: BigInt(request.slippageBps) });
  const planner = new TradePlanner([trade], false, { permitOptions: { permitEnabled: Boolean(permitSingleWithSignature), permit: permitSingleWithSignature } });
  planner.encode();
  const nativeValue = request.sellToken === TRON_NATIVE_TOKEN ? BigInt(request.sellAmount) : 0n;
  if (nativeValue > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TRX 卖出数量超过浏览器安全整数范围');
  const unsigned = await tronWeb.transactionBuilder.triggerSmartContract(SUNSWAP_UNIVERSAL_ROUTER, 'execute(bytes,bytes[],uint256)', { callValue: Number(nativeValue), feeLimit: 500_000_000 }, [{ type: 'bytes', value: planner.commands }, { type: 'bytes[]', value: planner.inputs }, { type: 'uint256', value: Math.floor(Date.now() / 1_000) + 1_200 }], owner);
  const result = await wallet.signAndBroadcast(unsigned, 'mainnet');
  await waitForConfirmation(tronWeb, result.txid);
  return result.txid;
}
