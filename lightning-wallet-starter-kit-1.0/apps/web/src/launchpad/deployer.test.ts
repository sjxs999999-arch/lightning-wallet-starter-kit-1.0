import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { assertMainnetLaunchpadEnabled, assertSolanaLaunchNetwork, createFixedSupplySolanaInstructions, deployLaunchToken, launchpadSolanaRpcUrl, prepareLaunchDeployment } from './deployer';
import { isMainnetLaunchNetwork, launchNetworkMatchesChain } from './types';
import type { LaunchDraft } from './types';
import tronArtifact from './artifacts/LightningFixedSupplyToken.tron.json';
import evmArtifact from './artifacts/LightningFixedSupplyToken.json';

const draft: LaunchDraft = {
  chain: 'TRON', network: 'tron-nile', name: 'Lightning Test', symbol: 'LTEST', decimals: 6, supply: '1000000',
  description: 'testnet token', website: '', socials: { x: '', telegram: '', discord: '' }, media: {},
  liquidity: { tokenAmount: '1000', quoteSymbol: 'USDT', quoteAmount: '100', lockDays: 30 }, dryRun: false,
};

describe('client-side Launchpad deployment', () => {
  beforeEach(() => { Object.defineProperty(globalThis, 'window', { value: {}, writable: true, configurable: true }); });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects any broadcast while Dry Run is enabled', async () => {
    await expect(deployLaunchToken({ ...draft, dryRun: true })).rejects.toThrow('Dry Run');
    await expect(prepareLaunchDeployment({ ...draft, dryRun: true })).rejects.toThrow('Dry Run');
  });

  it('ships fixed-supply artifacts without a public mint function', () => {
    for (const candidate of [evmArtifact, tronArtifact]) {
      expect(candidate.abi.filter(item => item.type === 'function').map(item => 'name' in item ? item.name : '')).not.toContain('mint');
    }
  });

  it('rejects TRON Mainnet before accessing a wallet while either production gate is closed', async () => {
    const createSmartContract = vi.fn();
    Object.assign(window, { tronWeb: { defaultAddress: { base58: 'TMainnet' }, fullNode: { host: 'https://api.trongrid.io' }, transactionBuilder: { createSmartContract } } });
    await expect(prepareLaunchDeployment({ ...draft, network: 'tron-mainnet' })).rejects.toThrow('双重生产开关');
    expect(createSmartContract).not.toHaveBeenCalled();
  });

  it('rejects every Mainnet network unless both production gates are enabled', () => {
    for (const network of ['ethereum', 'bsc', 'polygon', 'base', 'arbitrum', 'solana-mainnet', 'tron-mainnet'] as const) {
      expect(() => assertMainnetLaunchpadEnabled(network)).toThrow('双重生产开关');
    }
    expect(() => assertMainnetLaunchpadEnabled('sepolia')).not.toThrow();
    expect(() => assertMainnetLaunchpadEnabled('solana-devnet')).not.toThrow();
    expect(() => assertMainnetLaunchpadEnabled('tron-nile')).not.toThrow();
  });

  it('does not request an EVM account when the Mainnet production gates are closed', async () => {
    const request = vi.fn();
    Object.assign(window, { ethereum: { request } });
    await expect(prepareLaunchDeployment({ ...draft, chain: 'EVM', network: 'ethereum', decimals: 18 })).rejects.toThrow('双重生产开关');
    expect(request).not.toHaveBeenCalled();
  });

  it('constructs SPL Token initialize, ATA, mint and irreversible mint-authority revoke instructions', () => {
    const owner = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const token = createFixedSupplySolanaInstructions(owner, mint, 123_456_789n, 9);
    expect(token.instructions).toHaveLength(4);
    expect([...token.instructions[0]!.data]).toEqual([20, 9, ...owner.toBytes(), 0]);
    expect(token.instructions[1]!.data).toHaveLength(0);
    expect([...token.instructions[2]!.data]).toEqual([7, 21, 205, 91, 7, 0, 0, 0, 0]);
    expect([...token.instructions[3]!.data]).toEqual([6, 0, 0]);
  });

  it('keeps Launchpad Devnet RPC isolated from the Mainnet transaction RPC', () => {
    vi.stubEnv('VITE_SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com');
    vi.stubEnv('VITE_LAUNCHPAD_SOLANA_RPC_URL', 'https://api.devnet.solana.com');
    expect(launchpadSolanaRpcUrl()).toBe('https://api.devnet.solana.com');
    expect(launchpadSolanaRpcUrl('solana-mainnet')).toBe('https://api.mainnet-beta.solana.com');
  });

  it('accepts the full official Solana genesis hashes and rejects a wrong network', async () => {
    const devnet = { getGenesisHash: vi.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') };
    const mainnet = { getGenesisHash: vi.fn().mockResolvedValue('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') };
    await expect(assertSolanaLaunchNetwork(devnet, 'solana-devnet')).resolves.toBeUndefined();
    await expect(assertSolanaLaunchNetwork(mainnet, 'solana-mainnet')).resolves.toBeUndefined();
    await expect(assertSolanaLaunchNetwork(devnet, 'solana-mainnet')).rejects.toThrow('Solana Mainnet');
  });

  it.each([
    ['EVM', 'ethereum', true], ['EVM', 'solana-mainnet', false], ['SOL', 'solana-mainnet', true],
    ['SOL', 'tron-mainnet', false], ['TRON', 'tron-shasta', true], ['TRON', 'sepolia', false],
  ] as const)('matches %s / %s to its exact chain', (chain, network, expected) => {
    expect(launchNetworkMatchesChain(chain, network)).toBe(expected);
    expect(isMainnetLaunchNetwork(network)).toBe(network.endsWith('mainnet') || ['ethereum', 'bsc', 'polygon', 'base', 'arbitrum'].includes(network));
  });

  it('builds, wallet-signs, broadcasts and confirms a Nile deployment without a server signer', async () => {
    expect(tronArtifact).toMatchObject({ compilerFamily: 'tronprotocol/solidity', compilerSha256: '59bb6f8f91793045bce0cc5bb9c6547a7425612b1ac66fd666f9ef1dad75ea46' });
    const createSmartContract = vi.fn().mockResolvedValue({ txID: 'unsigned-id', contract_address: '41abc' });
    const sign = vi.fn().mockResolvedValue({ txID: 'signed-id' });
    const sendRawTransaction = vi.fn().mockResolvedValue({ result: true, txid: 'nile-tx-id' });
    const getTransactionInfo = vi.fn().mockResolvedValue({ id: 'nile-tx-id', receipt: { result: 'SUCCESS' }, contract_address: '41abc' });
    Object.assign(window, { tronWeb: {
      defaultAddress: { base58: 'TNileWallet' }, fullNode: { host: 'https://nile.trongrid.io' }, address: { fromHex: () => 'TNileContract' },
      transactionBuilder: { createSmartContract }, trx: { sign, sendRawTransaction, getTransactionInfo },
    } });
    const estimate = await prepareLaunchDeployment(draft);
    expect(estimate).toMatchObject({ network: 'TRON Nile', walletAddress: 'TNileWallet', exact: false });
    const result = await deployLaunchToken(draft);
    expect(result).toMatchObject({ contractAddress: 'TNileContract', transactionHash: 'nile-tx-id', status: 'confirmed' });
    expect(createSmartContract).toHaveBeenCalledWith(expect.objectContaining({ feeLimit: 150_000_000, parameters: ['Lightning Test', 'LTEST', 6, '1000000000000'] }), 'TNileWallet');
    expect(sign).toHaveBeenCalledTimes(1);
    expect(sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(createSmartContract.mock.calls)).not.toMatch(/privateKey|mnemonic|seedPhrase/i);
  });

  it('recognizes Shasta and estimates without signing or broadcasting', async () => {
    const createSmartContract = vi.fn();
    const sign = vi.fn();
    const sendRawTransaction = vi.fn();
    Object.assign(window, { tronWeb: {
      defaultAddress: { base58: 'TShastaWallet' }, fullNode: { host: 'https://api.shasta.trongrid.io' },
      transactionBuilder: { createSmartContract }, trx: { sign, sendRawTransaction, getTransactionInfo: vi.fn() },
    } });
    await expect(prepareLaunchDeployment({ ...draft, network: 'tron-shasta' })).resolves.toMatchObject({ network: 'TRON Shasta', walletAddress: 'TShastaWallet' });
    expect(createSmartContract).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });

  it('allows a read-only TRON Mainnet estimate only after both production gates are enabled', async () => {
    vi.stubEnv('VITE_MAINNET_EXECUTION_ENABLED', 'true');
    vi.stubEnv('VITE_ENABLE_MAINNET_LAUNCHPAD', 'true');
    const createSmartContract = vi.fn();
    const sign = vi.fn();
    Object.assign(window, { tronWeb: {
      defaultAddress: { base58: 'TMainnetWallet' }, fullNode: { host: 'https://api.trongrid.io' },
      transactionBuilder: { createSmartContract }, trx: { sign, sendRawTransaction: vi.fn(), getTransactionInfo: vi.fn() },
    } });
    await expect(prepareLaunchDeployment({ ...draft, network: 'tron-mainnet' })).resolves.toMatchObject({ network: 'TRON Mainnet', walletAddress: 'TMainnetWallet' });
    expect(createSmartContract).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it('refuses EVM deployment when the wallet remains outside Sepolia', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_requestAccounts' ? ['0x0000000000000000000000000000000000000001'] : '0x1');
    Object.assign(window, { ethereum: { request } });
    await expect(prepareLaunchDeployment({ ...draft, chain: 'EVM', network: 'sepolia', decimals: 18 })).rejects.toThrow('Sepolia');
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'wallet_switchEthereumChain' }));
  });
});
