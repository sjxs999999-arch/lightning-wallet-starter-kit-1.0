import { describe, expect, it, vi } from 'vitest';
import { ensureExactSunSwapAllowance, validateExecutableSunRoute } from './sunswap-execution';
import type { SwapCandidate, SwapRequest } from './types';
import type { InjectedTronWeb, SunSwapWallet } from './tron-wallet';

const request: SwapRequest = { chain: 'TRON', sellToken: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', buyToken: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', sellAmount: '1000000', taker: 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA', slippageBps: 50 };
const sunRoute = { amountIn: '1.000000', amountInRaw: '1000000', amountOut: '0.340000', amountOutRaw: '340000', amountOutMinimum: '0.340000', amountOutMinimumRaw: '340000', inUsd: '0.34', outUsd: '0.339', impact: '-0.0215', fee: '0.0005', containsUnverifiedHook: false, tokens: [request.sellToken, 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR', request.buyToken], symbols: ['TRX', 'WTRX', 'USDT'], poolFees: ['0', '500', '0'], poolVersions: ['v2', 'v3'], poolKeys: [null, null], stepAmountsOut: ['1.000000', '0.340000'] };
const quote: SwapCandidate = { provider: 'SUN.io Smart Router', amountIn: '1000000', amountOut: '340000', minReceived: '338300', priceImpactPct: 0.0215, route: ['TRX', 'WTRX', 'USDT'], raw: { source: 'SUN.io Smart Router', network: 'mainnet', poolVersions: ['v2', 'v3'], verifiedHooksOnly: true, sunRoute } };

describe('verified SUN.io execution plan', () => {
  it('accepts an exact verified quote and rejects tampering', () => {
    expect(validateExecutableSunRoute(request, quote)).toMatchObject({ amountInRaw: request.sellAmount, amountOutRaw: quote.amountOut });
    expect(() => validateExecutableSunRoute(request, { ...quote, minReceived: '1' })).toThrow('验证失败');
  });


  it('accepts only a strictly validated no-hook V4 pool key', () => {
    const v4 = { ...sunRoute, tokens: [request.sellToken, request.buyToken], symbols: ['TRX', 'USDT'], poolFees: ['500', '0'], poolVersions: ['v4'], stepAmountsOut: ['0.340000'], poolKeys: [{ token0: request.sellToken, token1: request.buyToken, hooks: request.sellToken, fee: 500, parameters: '0x00000000000000000000000000000000000000000000000000000000000a0000' }] };
    const v4Quote = { ...quote, route: ['TRX', 'USDT'], raw: { ...quote.raw as object, poolVersions: ['v4'], sunRoute: v4 } };
    expect(validateExecutableSunRoute(request, v4Quote).poolKeys).toHaveLength(1);
    expect(() => validateExecutableSunRoute(request, { ...v4Quote, raw: { ...v4Quote.raw as object, sunRoute: { ...v4, poolKeys: [{ ...v4.poolKeys[0], hooks: request.buyToken }] } } })).toThrow('验证失败');
  });

  it('resets a non-exact allowance before setting the exact sell amount', async () => {
    const triggerConfirmedConstantContract = vi.fn(async () => ({ constant_result: ['05'] }));
    const triggerSmartContract = vi.fn(async (_address: string, _selector: string, _options: unknown, parameters: { value: string }[]) => ({ transaction: { amount: parameters[1]!.value } }));
    const tronWeb = { trx: { sign: vi.fn(), sendRawTransaction: vi.fn(), getTransactionInfo: vi.fn(async txid => ({ id: txid, receipt: { result: 'SUCCESS' } })) }, transactionBuilder: { triggerConfirmedConstantContract, triggerSmartContract } } as unknown as InjectedTronWeb;
    const signAndBroadcast = vi.fn(async () => ({ result: true, txid: `tx-${signAndBroadcast.mock.calls.length}` }));
    const wallet = { type: 'test', getAddress: vi.fn(), getTronWeb: vi.fn(), signAndBroadcast, signMessage: vi.fn(), signTypedData: vi.fn() } as unknown as SunSwapWallet;
    await expect(ensureExactSunSwapAllowance(tronWeb, wallet, request.taker, request.buyToken, '10')).resolves.toHaveLength(2);
    expect(triggerSmartContract.mock.calls.map(call => call[3][1]!.value)).toEqual(['0', '10']);
    expect(signAndBroadcast).toHaveBeenCalledTimes(2);
  });
});
