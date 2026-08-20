import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertTronMainnet, assertTronSellBalance, connectInjectedTron, createSunSwapWallet, TRON_NATIVE_TOKEN, type InjectedTronWeb } from './tron-wallet';

function tronWeb(overrides: Partial<InjectedTronWeb> = {}): InjectedTronWeb {
  return {
    defaultAddress: { base58: 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA' },
    fullNode: { host: 'https://api.trongrid.io' },
    trx: { sign: vi.fn(async tx => ({ txID: 'txid', transaction: tx })), sendRawTransaction: vi.fn(async () => ({ result: true, txid: 'txid' })), getBalance: vi.fn(async () => 2_000_000) },
    ...overrides,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
});

describe('injected SUN.io wallet boundary', () => {
  it('uses the modern TronLink provider and requests account access', async () => {
    const injected = tronWeb();
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_requestAccounts' ? [] : '0x2b6653dc');
    (window as unknown as { tron: unknown }).tron = { request, tronWeb: injected };
    await expect(connectInjectedTron()).resolves.toMatchObject({ tronWeb: injected, address: injected.defaultAddress?.base58 });
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });

  it('fails closed on testnet or an unverifiable RPC host', async () => {
    await expect(assertTronMainnet(tronWeb({ fullNode: { host: 'https://nile.trongrid.io' } }))).rejects.toThrow('Mainnet');
    await expect(assertTronMainnet(tronWeb({ fullNode: { host: 'https://rpc.unknown.example' } }))).rejects.toThrow('无法验证');
  });

  it('checks native and TRC-20 sell balances before signing', async () => {
    const tokenBalance = vi.fn(async () => '999');
    const injected = tronWeb({ contract: () => ({ at: async () => ({ balanceOf: () => ({ call: tokenBalance }) }) }) });
    await expect(assertTronSellBalance(injected, injected.defaultAddress!.base58!, TRON_NATIVE_TOKEN, '1000000')).resolves.toBe(2_000_000n);
    await expect(assertTronSellBalance(injected, injected.defaultAddress!.base58!, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', '1000')).rejects.toThrow('余额不足');
  });

  it('unwraps, signs and broadcasts locally and strips typed-signature prefixes', async () => {
    const signTypedData = vi.fn(async () => '0xabc123');
    const injected = tronWeb({ trx: { sign: vi.fn(async tx => ({ txID: 'signed-id', transaction: tx })), sendRawTransaction: vi.fn(async () => ({ result: true, txid: 'broadcast-id' })), signTypedData } });
    const wallet = createSunSwapWallet(injected, injected.defaultAddress!.base58!);
    await expect(wallet.signAndBroadcast({ transaction: { raw_data: {} } }, 'mainnet')).resolves.toEqual({ result: true, txid: 'broadcast-id' });
    await expect(wallet.signTypedData('PermitSingle', {}, {}, {})).resolves.toBe('abc123');
  });
});
