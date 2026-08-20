import bs58 from 'bs58';
import { formatAtomic } from '../amount';
import type { TransferChain } from '../batch-transfer/types';
import type { ScanInput, ScannedAsset } from './types';

export type ScanProfile = 'configured' | 'local-testnet';
type RpcSet = Record<TransferChain, string[]>;

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const TRON_TESTNET_HOSTS = new Set(['nile.trongrid.io', 'api.nileex.io', 'api.shasta.trongrid.io']);
const endpoints = (primary: string, fallbacks = '') => [primary, ...fallbacks.split(',')]
  .map(value => value.trim().replace(/\/$/, ''))
  .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
const evmPrimary = import.meta.env.VITE_EVM_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const configuredRpc: RpcSet = {
  EVM: endpoints(evmPrimary, import.meta.env.VITE_EVM_RPC_FALLBACK_URLS || (evmPrimary.includes('sepolia') ? 'https://rpc.sepolia.org' : 'https://eth.llamarpc.com')),
  SOL: endpoints(import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com', import.meta.env.VITE_SOLANA_RPC_FALLBACK_URLS || 'https://solana-rpc.publicnode.com,https://solana.drpc.org'),
  TRON: endpoints(import.meta.env.VITE_TRON_RPC_URL || 'https://nile.trongrid.io', import.meta.env.VITE_TRON_RPC_FALLBACK_URLS || ''),
};
const localTestnetRpc: RpcSet = {
  EVM: endpoints(import.meta.env.VITE_LOCAL_EVM_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'),
  SOL: endpoints(import.meta.env.VITE_LOCAL_SOLANA_RPC_URL || 'https://api.devnet.solana.com'),
  TRON: endpoints(import.meta.env.VITE_LOCAL_TRON_RPC_URL || 'https://nile.trongrid.io'),
};

function profileRpc(profile: ScanProfile) { return profile === 'local-testnet' ? localTestnetRpc : configuredRpc; }
function tron(urls: string[], path: string) { return urls.map(endpoint => `${endpoint}${path}`); }

async function json(urls: string[], body: unknown) {
  let lastError = 'RPC 扫描失败';
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message ?? 'RPC 返回错误');
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error.name === 'AbortError' ? 'RPC timeout' : error.message : lastError;
      if (/429|too many|rate limit/i.test(lastError)) await new Promise(resolve => setTimeout(resolve, 250));
    } finally { clearTimeout(timer); }
  }
  throw new Error(lastError);
}

export async function assertLocalTestnetScanProfile(chain: TransferChain) {
  if (chain === 'EVM') {
    const result = await json(localTestnetRpc.EVM, { jsonrpc: '2.0', id: 90_001, method: 'eth_chainId', params: [] });
    if (String(result.result).toLowerCase() !== '0xaa36a7') throw new Error('本地钱包归集扫描 RPC 不是 Sepolia，已停止扫描');
    return;
  }
  if (chain === 'SOL') {
    const result = await json(localTestnetRpc.SOL, { jsonrpc: '2.0', id: 90_002, method: 'getGenesisHash', params: [] });
    if (result.result !== DEVNET_GENESIS) throw new Error('本地钱包归集扫描 RPC 不是 Solana Devnet，已停止扫描');
    return;
  }
  const valid = localTestnetRpc.TRON.every(value => {
    try { return TRON_TESTNET_HOSTS.has(new URL(value).hostname.toLowerCase()); }
    catch { return false; }
  });
  if (!valid) throw new Error('本地钱包归集扫描只允许 TRON Nile 或 Shasta 官方 RPC');
}

const evmGasPricePromises = new Map<string, Promise<bigint>>();
async function evmGasPrice(index: number, urls: string[]) {
  const key = urls.join('|');
  if (!evmGasPricePromises.has(key)) evmGasPricePromises.set(key, json(urls, { jsonrpc: '2.0', id: index + 10_000, method: 'eth_gasPrice', params: [] }).then(result => BigInt(result.result)));
  try { return await evmGasPricePromises.get(key)!; }
  catch (error) { evmGasPricePromises.delete(key);throw error; }
}

function tokenDecimals(detected: number, provided?: number) {
  if (!Number.isInteger(detected) || detected < 0 || detected > 30) throw new Error('Token decimals 无效');
  if (provided !== undefined && provided !== detected) throw new Error(`CSV decimals ${provided} 与链上 decimals ${detected} 不一致`);
  return detected;
}

export async function scanAsset(chain: TransferChain, input: ScanInput, index: number, profile: ScanProfile = 'configured'): Promise<ScannedAsset> {
  const id = `${chain}-${index}-${input.address}`;
  const asset = input.token ? 'token' : 'native';
  const rpc = profileRpc(profile);
  try {
    if (chain === 'EVM') {
      const data = input.token ? `0x70a08231000000000000000000000000${input.address.slice(2).toLowerCase()}` : undefined;
      const [balanceResult, decimalsResult] = await Promise.all([
        json(rpc.EVM, { jsonrpc: '2.0', id: index, method: input.token ? 'eth_call' : 'eth_getBalance', params: input.token ? [{ to: input.token, data }, 'latest'] : [input.address, 'latest'] }),
        input.token ? json(rpc.EVM, { jsonrpc: '2.0', id: index + 30_000, method: 'eth_call', params: [{ to: input.token, data: '0x313ce567' }, 'latest'] }) : Promise.resolve(undefined),
      ]);
      const decimals = input.token ? tokenDecimals(Number(BigInt(decimalsResult.result)), input.decimals) : 18;
      const fee = (await evmGasPrice(index, rpc.EVM)) * BigInt(input.token ? 65000 : 21000);
      return { ...input, id, chain, asset, symbol: input.token ? 'ERC-20' : 'ETH', decimals, balance: formatAtomic(BigInt(balanceResult.result), decimals), estimatedFee: formatAtomic(fee, 18), status: 'ready' };
    }
    if (chain === 'SOL') {
      if (input.token) {
        const [result, supply] = await Promise.all([
          json(rpc.SOL, { jsonrpc: '2.0', id: index, method: 'getTokenAccountsByOwner', params: [input.address, { mint: input.token }, { encoding: 'jsonParsed' }] }),
          json(rpc.SOL, { jsonrpc: '2.0', id: index + 30_000, method: 'getTokenSupply', params: [input.token] }),
        ]);
        const accounts = result.result.value as { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[];
        const decimals = tokenDecimals(Number(supply.result.value.decimals), input.decimals);
        const amount = accounts.reduce((sum, item) => sum + BigInt(item.account.data.parsed.info.tokenAmount.amount), 0n);
        return { ...input, id, chain, asset, symbol: 'SPL', decimals, balance: formatAtomic(amount, decimals), estimatedFee: '0.00001', status: 'ready' };
      }
      const result = await json(rpc.SOL, { jsonrpc: '2.0', id: index, method: 'getBalance', params: [input.address] });
      return { ...input, id, chain, asset, symbol: 'SOL', balance: formatAtomic(BigInt(result.result.value), 9), estimatedFee: '0.000005', status: 'ready' };
    }
    const addressHex = Array.from(bs58.decode(input.address).slice(0, 21), byte => byte.toString(16).padStart(2, '0')).join('');
    if (input.token) {
      const parameter = addressHex.padStart(64, '0');
      const [balanceResult, decimalsResult] = await Promise.all([
        json(tron(rpc.TRON, '/wallet/triggerconstantcontract'), { owner_address: input.address, contract_address: input.token, function_selector: 'balanceOf(address)', parameter, visible: true }),
        json(tron(rpc.TRON, '/wallet/triggerconstantcontract'), { owner_address: input.address, contract_address: input.token, function_selector: 'decimals()', parameter: '', visible: true }),
      ]);
      const raw = BigInt(`0x${balanceResult.constant_result?.[0] ?? '0'}`);
      const decimals = tokenDecimals(Number(BigInt(`0x${decimalsResult.constant_result?.[0] ?? '0'}`)), input.decimals);
      return { ...input, id, chain, asset, symbol: 'TRC-20', decimals, balance: formatAtomic(raw, decimals), estimatedFee: '15', status: 'ready' };
    }
    const result = await json(tron(rpc.TRON, '/wallet/getaccount'), { address: input.address, visible: true });
    return { ...input, id, chain, asset, symbol: 'TRX', balance: formatAtomic(BigInt(result.balance ?? 0), 6), estimatedFee: '1.1', status: 'ready' };
  } catch (error) {
    return { ...input, id, chain, asset, symbol: input.token ? 'Token' : 'Native', balance: '0', estimatedFee: '0', status: 'failed', error: error instanceof Error ? error.message : 'RPC 扫描失败' };
  }
}

type ParsedSolanaAccount = { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } };
async function discoverSolanaTokens(input: ScanInput, index: number, profile: ScanProfile): Promise<ScannedAsset[]> {
  const programs = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
  const rpc = profileRpc(profile);
  const responses = await Promise.all(programs.map((program, offset) => json(rpc.SOL, { jsonrpc: '2.0', id: index + 20_000 + offset, method: 'getTokenAccountsByOwner', params: [input.address, { programId: program }, { encoding: 'jsonParsed' }] })));
  const balances = new Map<string, { raw: bigint; decimals: number }>();
  for (const response of responses) for (const item of response.result.value as ParsedSolanaAccount[]) {
    const info = item.account.data.parsed.info;
    const current = balances.get(info.mint) ?? { raw: 0n, decimals: info.tokenAmount.decimals };
    balances.set(info.mint, { raw: current.raw + BigInt(info.tokenAmount.amount), decimals: info.tokenAmount.decimals });
  }
  return [...balances.entries()].filter(([, value]) => value.raw > 0n).map(([token, value], offset) => ({ id: `SOL-${index}-token-${offset}-${input.address}`, chain: 'SOL', asset: 'token', symbol: `SPL·${token.slice(0, 4)}`, address: input.address, token, decimals: value.decimals, balance: formatAtomic(value.raw, value.decimals), estimatedFee: '0.00001', status: 'ready' }));
}

export async function scanWalletAssets(chain: TransferChain, input: ScanInput, index: number, profile: ScanProfile = 'configured'): Promise<ScannedAsset[]> {
  if (input.token) return [await scanAsset(chain, input, index, profile)];
  const native = await scanAsset(chain, input, index, profile);
  if (chain !== 'SOL' || native.status === 'failed') return [native];
  try { return [native, ...await discoverSolanaTokens(input, index, profile)]; }
  catch (error) { return [native, { id: `SOL-${index}-tokens-${input.address}`, chain: 'SOL', asset: 'token', symbol: 'SPL', address: input.address, balance: '0', estimatedFee: '0', status: 'failed', error: error instanceof Error ? `Token 扫描失败：${error.message}` : 'Token 扫描失败' }]; }
}
