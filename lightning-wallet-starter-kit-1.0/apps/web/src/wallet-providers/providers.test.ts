import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { broadcastSelfTest, connectEvm, connectSol, connectTron, discoverEvmProviders } from './providers';
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
    const wallet: ConnectedWallet = { name: 'MetaMask', family: 'EVM', address: '0x0000000000000000000000000000000000000001', network: 'Sepolia', provider: { request } };
    await expect(broadcastSelfTest(wallet)).rejects.toThrow('账户已变化');
    expect(request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
  });

  it('does not record a failed Solana confirmation as successful', async () => {
    const address = Keypair.generate().publicKey.toBase58();
    const wallet: ConnectedWallet = {
      name: 'Phantom', family: 'SOL', address, network: 'Solana Devnet',
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
    const wallet: ConnectedWallet = { name: 'TronLink', family: 'TRON', address, network: 'TRON Shasta', provider: tronWeb };
    await expect(broadcastSelfTest(wallet)).rejects.toThrow('TRON 测试网交易执行失败');
    expect(JSON.stringify(tronWeb.trx.sign.mock.calls)).not.toMatch(/privateKey|mnemonic|seedPhrase/i);
  });
});
