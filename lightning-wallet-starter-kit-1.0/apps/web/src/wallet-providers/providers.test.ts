import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { broadcastSelfTest, connectEvm, connectSol, connectTron, discoverEvmProviders, readNativeBalance, subscribeWalletSession } from './providers';
import type { ConnectedWallet, RequestProvider } from './types';

class TestCustomEvent<T> extends Event {
  detail: T;
  constructor(type: string, init: { detail: T }) { super(type); this.detail = init.detail; }
}

function setWindow(properties: Record<string, unknown> = {}) {
  const root = Object.assign(new EventTarget(), properties);
  Object.defineProperty(globalThis, 'window', { value: root, writable: true, configurable: true });
  return root as EventTarget & Record<string, unknown>;
}

function announce(name: string, rdns: string, provider: RequestProvider) {
  window.addEventListener('eip6963:requestProvider', () => {
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { name, rdns }, provider } }));
  }, { once: true });
}

describe('wallet provider discovery and fail-closed network validation', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'CustomEvent', { value: TestCustomEvent, writable: true, configurable: true });
    setWindow();
  });

  it('discovers EIP-6963 providers without reading keys', async () => {
    const provider = { request: async () => [] };
    announce('Rabby', 'io.rabby', provider);
    const found = await discoverEvmProviders(0);
    expect(found[0]?.info.name).toBe('Rabby');
    expect(JSON.stringify(found[0]?.info)).not.toMatch(/privateKey|mnemonic/i);
  });

  it('switches to Sepolia, re-reads the chain and normalizes the active address', async () => {
    let chainId = '0x1';
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return ['0x0000000000000000000000000000000000000001'];
      if (method === 'eth_chainId') return chainId;
      if (method === 'wallet_switchEthereumChain') { chainId = '0xaa36a7'; return null; }
      return null;
    });
    announce('MetaMask', 'io.metamask', { request });
    await expect(connectEvm('MetaMask', undefined, 0)).resolves.toMatchObject({ family: 'EVM', network: 'Sepolia', address: '0x0000000000000000000000000000000000000001' });
    expect(request).toHaveBeenCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
    expect(request.mock.calls.filter(([value]) => value.method === 'eth_chainId')).toHaveLength(2);
  });

  it('rejects an ignored EVM network switch instead of mislabeling Mainnet as Sepolia', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_requestAccounts'
      ? ['0x0000000000000000000000000000000000000001']
      : method === 'eth_chainId' ? '0x1' : null);
    announce('MetaMask', 'io.metamask', { request });
    await expect(connectEvm('MetaMask', undefined, 0)).rejects.toThrow('没有切换到 Sepolia');
  });

  it('connects EVM mainnet in read-only mode and verifies chain id 1', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_requestAccounts'
      ? ['0x0000000000000000000000000000000000000001']
      : method === 'eth_chainId' ? '0x1' : null);
    announce('MetaMask', 'io.metamask', { request });
    await expect(connectEvm('MetaMask', undefined, 0, 'mainnet')).resolves.toMatchObject({
      family: 'EVM', network: 'Ethereum Mainnet', mode: 'mainnet', chainId: '0x1', readOnly: true,
    });
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'wallet_switchEthereumChain' }));
  });

  it.each([
    ['0x1', 'Ethereum Mainnet', 'ETH'],
    ['0xa', 'Optimism', 'ETH'],
    ['0x38', 'BSC', 'BNB'],
    ['0x89', 'Polygon', 'POL'],
    ['0x2105', 'Base', 'ETH'],
    ['0xa4b1', 'Arbitrum', 'ETH'],
    ['0xa86a', 'Avalanche', 'AVAX'],
  ])('labels %s native balances with the correct symbol', async (chainId, network, symbol) => {
    const address = '0x0000000000000000000000000000000000000001';
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return chainId;
      if (method === 'eth_accounts') return [address];
      if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
      return null;
    });
    const wallet: ConnectedWallet = {
      name: 'MetaMask', family: 'EVM', address, network, mode: 'mainnet', chainId, readOnly: true, provider: { request },
    };

    await expect(readNativeBalance(wallet)).resolves.toEqual({ symbol, formatted: '1' });
  });

  it('validates the full Devnet genesis before connecting OKX Solana', async () => {
    const address = Keypair.generate().publicKey.toBase58();
    const connect = vi.fn().mockResolvedValue({ publicKey: { toString: () => address } });
    setWindow({ okxwallet: { request: vi.fn(), solana: { connect } } });
    const connection = { getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') };
    await expect(connectSol('OKX Wallet', connection)).resolves.toMatchObject({ name: 'OKX Wallet', family: 'SOL', address, network: 'Solana Devnet' });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong Solana cluster before requesting the wallet', async () => {
    const connect = vi.fn();
    setWindow({ phantom: { solana: { connect } } });
    await expect(connectSol('Phantom', { getGenesisHash: vi.fn().mockResolvedValue('mainnet-or-unknown') })).rejects.toThrow('不是 Devnet');
    expect(connect).not.toHaveBeenCalled();
  });

  it('validates the full Solana mainnet genesis before requesting the wallet', async () => {
    const address = Keypair.generate().publicKey.toBase58();
    const connect = vi.fn().mockResolvedValue({ publicKey: { toString: () => address } });
    setWindow({ phantom: { solana: { connect } } });
    const connection = { getGenesisHash: vi.fn().mockResolvedValue('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') };
    await expect(connectSol('Phantom', connection, 'mainnet')).resolves.toMatchObject({
      family: 'SOL', network: 'Solana Mainnet', mode: 'mainnet', readOnly: true,
    });
  });

  it('connects OKX TRON only on an exact official testnet hostname', async () => {
    const request = vi.fn().mockResolvedValue({ code: 200 });
    const tronWeb = { defaultAddress: { base58: 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA' }, fullNode: { host: 'https://nile.trongrid.io' } };
    setWindow({ okxwallet: { request: vi.fn(), tronLink: { request, tronWeb } } });
    await expect(connectTron('OKX Wallet')).resolves.toMatchObject({ name: 'OKX Wallet', family: 'TRON', network: 'TRON Nile' });
    expect(request).toHaveBeenCalledWith({ method: 'tron_requestAccounts' });
  });

  it('rejects lookalike TRON RPC hostnames', async () => {
    const tronWeb = { defaultAddress: { base58: 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA' }, fullNode: { host: 'https://nile.trongrid.io.attacker.test' } };
    setWindow({ tronLink: { request: vi.fn().mockResolvedValue({ code: 200 }), tronWeb } });
    await expect(connectTron()).rejects.toThrow('官方 Nile 或 Shasta');
  });

  it('accepts only the exact official TRON mainnet hostname in mainnet mode', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x2b6653dc' : { code: 200 });
    const tronWeb = { defaultAddress: { base58: 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA' }, fullNode: { host: 'https://api.trongrid.io' } };
    setWindow({ tron: { request, tronWeb } });
    await expect(connectTron('TronLink', 'mainnet')).resolves.toMatchObject({
      family: 'TRON', network: 'TRON Mainnet', mode: 'mainnet', chainId: '0x2b6653dc', readOnly: true,
    });
  });

  it('rejects a TRON address with a valid shape but an invalid Base58Check checksum', async () => {
    const tronWeb = { defaultAddress: { base58: 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEB' }, fullNode: { host: 'https://nile.trongrid.io' } };
    setWindow({ tronLink: { request: vi.fn().mockResolvedValue({ code: 200 }), tronWeb } });
    await expect(connectTron()).rejects.toThrow('Base58Check');
  });
});

describe('wallet self-test receipt validation', () => {
  it('stops an EVM self-test before signing when the active account changes', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId'
      ? '0xaa36a7' : method === 'eth_accounts' ? ['0x0000000000000000000000000000000000000002'] : null);
    const wallet: ConnectedWallet = { name: 'MetaMask', family: 'EVM', address: '0x0000000000000000000000000000000000000001', network: 'Sepolia', mode: 'testnet', chainId: '0xaa36a7', readOnly: false, provider: { request } };
    await expect(broadcastSelfTest(wallet)).rejects.toThrow('账户已变化');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
  });

  it('does not record a failed Solana confirmation as successful', async () => {
    const address = Keypair.generate().publicKey.toBase58();
    const wallet: ConnectedWallet = {
      name: 'Phantom', family: 'SOL', address, network: 'Solana Devnet', mode: 'testnet', chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', readOnly: false,
      provider: { signAndSendTransaction: vi.fn().mockResolvedValue({ signature: 'failed-solana-signature' }) },
    };
    const connection = {
      getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),
      getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 10 }),
      confirmTransaction: vi.fn().mockResolvedValue({ value: { err: { InstructionError: [0, 'Custom'] } } }),
    };
    await expect(broadcastSelfTest(wallet, connection as never)).rejects.toThrow('Solana Devnet 交易执行失败');
  });

  it('does not record a failed TRON receipt as successful', async () => {
    const address = 'TPxqxJiNbT5XNbQFuC1LNX2pyEztrJcJEA';
    const tronWeb = {
      defaultAddress: { base58: address }, fullNode: { host: 'https://api.shasta.trongrid.io' },
      transactionBuilder: { sendTrx: vi.fn().mockResolvedValue({ txID: 'unsigned' }) },
      trx: {
        signMessageV2: vi.fn(), sign: vi.fn().mockResolvedValue({ txID: 'signed' }),
        sendRawTransaction: vi.fn().mockResolvedValue({ result: true, txid: 'failed-tron-id' }),
        getTransactionInfo: vi.fn().mockResolvedValue({ id: 'failed-tron-id', receipt: { result: 'FAILED' } }),
      },
    };
    const wallet: ConnectedWallet = { name: 'TronLink', family: 'TRON', address, network: 'TRON Shasta', mode: 'testnet', chainId: '0x94a9059e', readOnly: false, provider: tronWeb };
    await expect(broadcastSelfTest(wallet)).rejects.toThrow('TRON 测试网交易执行失败');
    expect(JSON.stringify(tronWeb.trx.sign.mock.calls)).not.toMatch(/privateKey|mnemonic|seedPhrase/i);
  });

  it('blocks every mainnet self-test before requesting a transaction', async () => {
    const request = vi.fn();
    const wallet: ConnectedWallet = {
      name: 'MetaMask', family: 'EVM', address: '0x0000000000000000000000000000000000000001',
      network: 'Ethereum Mainnet', mode: 'mainnet', chainId: '0x1', readOnly: true, provider: { request },
    };
    await expect(broadcastSelfTest(wallet)).rejects.toThrow('钱包中心不执行主网自测交易');
    expect(request).not.toHaveBeenCalled();
  });

  it('invalidates a connected EVM session as soon as the chain changes', () => {
    const source = new EventTarget();
    const eventProvider = {
      on: (event: string, listener: (...args: unknown[]) => void) => source.addEventListener(event, detail => listener((detail as CustomEvent).detail)),
    };
    const wallet: ConnectedWallet = {
      name: 'MetaMask', family: 'EVM', address: '0x0000000000000000000000000000000000000001',
      network: 'Ethereum Mainnet', mode: 'mainnet', chainId: '0x1', readOnly: true,
      provider: { request: vi.fn() }, eventProvider,
    };
    const invalidated = vi.fn();
    subscribeWalletSession(wallet, invalidated);
    source.dispatchEvent(new CustomEvent('chainChanged', { detail: '0xaa36a7' }));
    expect(invalidated).toHaveBeenCalledWith('EVM 钱包网络已变化，连接已安全断开');
  });

  it('keeps one mainnet EVM session while a module switches between supported production chains', () => {
    const source = new EventTarget();
    const eventProvider = {
      on: (event: string, listener: (...args: unknown[]) => void) => source.addEventListener(event, detail => listener((detail as CustomEvent).detail)),
    };
    const wallet: ConnectedWallet = {
      name: 'MetaMask', family: 'EVM', address: '0x0000000000000000000000000000000000000001',
      network: 'Ethereum Mainnet', mode: 'mainnet', chainId: '0x1', readOnly: true,
      provider: { request: vi.fn() }, eventProvider,
    };
    const invalidated = vi.fn(), changed = vi.fn();
    subscribeWalletSession(wallet, invalidated, changed);
    source.dispatchEvent(new CustomEvent('chainChanged', { detail: '0xa4b1' }));
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ chainId: '0xa4b1', network: 'Arbitrum', address: wallet.address }));
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('invalidates when the connected address remains authorized but is no longer the active EVM account', () => {
    const source = new EventTarget();
    const eventProvider = {
      on: (event: string, listener: (...args: unknown[]) => void) => source.addEventListener(event, detail => listener((detail as CustomEvent).detail)),
    };
    const wallet: ConnectedWallet = {
      name: 'MetaMask', family: 'EVM', address: '0x0000000000000000000000000000000000000001',
      network: 'Ethereum Mainnet', mode: 'mainnet', chainId: '0x1', readOnly: true,
      provider: { request: vi.fn() }, eventProvider,
    };
    const invalidated = vi.fn();
    subscribeWalletSession(wallet, invalidated);
    source.dispatchEvent(new CustomEvent('accountsChanged', { detail: ['0x0000000000000000000000000000000000000002', wallet.address] }));
    expect(invalidated).toHaveBeenCalledWith('EVM 钱包活动账户已变化，连接已安全断开');
  });
});
