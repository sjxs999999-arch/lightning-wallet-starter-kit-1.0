import { describe, expect, it, vi } from 'vitest';
import { executeSepoliaTopUp } from './topup';

const source = '0x1111111111111111111111111111111111111111';
const destination = '0x2222222222222222222222222222222222222222';
const hash = `0x${'a'.repeat(64)}`;

function provider(overrides: Record<string, unknown> = {}) {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts') return [source];
    if (method === 'eth_chainId') return '0xaa36a7';
    if (method === 'eth_estimateGas') return '0x5208';
    if (method === 'eth_sendTransaction') return hash;
    if (method === 'eth_getTransactionReceipt') return { status: '0x1' };
    return null;
  });
  return { request: vi.fn(async (args: { method: string; params?: unknown[] }) => args.method in overrides ? overrides[args.method] : request(args)), inner: request };
}

describe('GasFree Sepolia top-up execution boundary', () => {
  it('validates public inputs before accessing a wallet', async () => {
    const wallet = provider();
    await expect(executeSepoliaTopUp('bad', '1', { provider: wallet })).rejects.toThrow(/地址无效/);
    expect(wallet.request).not.toHaveBeenCalled();
  });

  it('rejects the wrong chain before confirmation or broadcast', async () => {
    const wallet = provider({ eth_chainId: '0x1' }), confirm = vi.fn();
    await expect(executeSepoliaTopUp(destination, '1', { provider: wallet, confirm })).rejects.toThrow(/Sepolia/);
    expect(confirm).not.toHaveBeenCalled();
    expect(wallet.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
  });

  it('stops if the active account changes after confirmation', async () => {
    let accountReads = 0;
    const wallet = { request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts') return ++accountReads < 3 ? [source] : [destination];
      if (method === 'eth_chainId') return '0xaa36a7';
      if (method === 'eth_estimateGas') return '0x5208';
      return null;
    }) };
    await expect(executeSepoliaTopUp(destination, '1', { provider: wallet, confirm: () => true })).rejects.toThrow(/活动账户已变化/);
    expect(wallet.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
  });

  it('does not broadcast when the user rejects confirmation', async () => {
    const wallet = provider();
    await expect(executeSepoliaTopUp(destination, '1', { provider: wallet, confirm: () => false })).rejects.toThrow(/取消签名/);
    expect(wallet.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
  });

  it('never reports a reverted receipt as successful', async () => {
    const wallet = provider({ eth_getTransactionReceipt: { status: '0x0' } });
    await expect(executeSepoliaTopUp(destination, '1', { provider: wallet, confirm: () => true, wait: async () => undefined })).rejects.toMatchObject({ hash, name: 'GasTopUpFailedError' });
  });

  it('keeps a broadcast hash as submitted when confirmation times out', async () => {
    const wallet = provider({ eth_getTransactionReceipt: null });
    await expect(executeSepoliaTopUp(destination, '1', { provider: wallet, confirm: () => true, pollAttempts: 2, wait: async () => undefined })).resolves.toEqual({ hash, state: 'submitted', account: source });
  });

  it('reports success only for an exact successful receipt', async () => {
    const wallet = provider();
    await expect(executeSepoliaTopUp(destination, '1', { provider: wallet, confirm: () => true, wait: async () => undefined })).resolves.toEqual({ hash, state: 'confirmed', account: source });
  });
});
