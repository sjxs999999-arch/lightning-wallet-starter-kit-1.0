import bs58 from 'bs58';

export type SwapTokenChain = 'EVM' | 'SOL' | 'TRON';

export interface SwapTokenMetadataInput {
  chain: SwapTokenChain;
  chainId?: number;
  token: string;
}

export interface SwapTokenMetadata {
  chain: SwapTokenChain;
  chainId?: number;
  token: string;
  decimals: number;
  symbol?: string;
  source: 'EVM RPC' | 'Solana RPC' | 'TRON RPC';
  verifiedAt: string;
}

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const SUPPORTED_EVM_CHAIN_IDS = new Set([1, 56, 137, 8453, 42161]);
const DEFAULT_EVM_RPC_URLS: Record<number, string[]> = {
  1: ['https://ethereum-rpc.publicnode.com'],
  56: ['https://bsc-rpc.publicnode.com'],
  137: ['https://polygon-bor-rpc.publicnode.com'],
  8453: ['https://base-rpc.publicnode.com'],
  42161: ['https://arbitrum-one-rpc.publicnode.com'],
};
const EVM_NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const EVM_NATIVE_SYMBOLS: Record<number, string> = { 1: 'ETH', 56: 'BNB', 137: 'POL', 8453: 'ETH', 42161: 'ETH' };
const TRON_NATIVE_TOKEN = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const metadataCache = new Map<string, { expiresAt: number; value: SwapTokenMetadata }>();

const record = (value: unknown): JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const validDecimals = (value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 30 ? Number(value) : null;
const validSymbol = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9._-]{1,24}$/.test(value) ? value : undefined;
const evmAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);
const tronAddress = (value: string) => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
const solanaAddress = (value: string) => {
  try { return bs58.decode(value).length === 32; }
  catch { return false; }
};

async function json(response: Response) {
  const body = await response.json() as JsonRecord;
  if (!response.ok) throw new Error(`TOKEN_METADATA_HTTP_${response.status}`);
  return body;
}

function decodeAbiString(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const hex = value.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return undefined;
  try {
    let data = hex;
    if (hex.length >= 128 && BigInt(`0x${hex.slice(0, 64)}`) === 32n) {
      const length = Number(BigInt(`0x${hex.slice(64, 128)}`));
      if (!Number.isSafeInteger(length) || length < 1 || length > 24 || hex.length < 128 + length * 2) return undefined;
      data = hex.slice(128, 128 + length * 2);
    } else if (hex.length === 64) data = hex.replace(/(?:00)+$/, '');
    else return undefined;
    return validSymbol(new TextDecoder().decode(Uint8Array.from(data.match(/../g) ?? [], byte => Number.parseInt(byte, 16))));
  } catch { return undefined; }
}

async function evmCall(fetcher: FetchLike, endpoint: string, token: string, data: string) {
  const body = await json(await fetcher(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: token, data }, 'latest'] }),
    signal: AbortSignal.timeout(8_000),
  }));
  if (body.error || typeof body.result !== 'string') throw new Error('TOKEN_METADATA_EVM_RPC_INVALID');
  return body.result;
}

async function evmMetadata(input: SwapTokenMetadataInput, fetcher: FetchLike, rpcUrls?: string[]): Promise<SwapTokenMetadata> {
  if (!input.chainId || !SUPPORTED_EVM_CHAIN_IDS.has(input.chainId) || !evmAddress(input.token)) throw new Error('TOKEN_METADATA_EVM_INPUT_INVALID');
  if (input.token.toLowerCase() === EVM_NATIVE_TOKEN) return { chain: 'EVM', chainId: input.chainId, token: input.token, decimals: 18, symbol: EVM_NATIVE_SYMBOLS[input.chainId], source: 'EVM RPC', verifiedAt: new Date().toISOString() };
  let lastError = 'TOKEN_METADATA_EVM_UNAVAILABLE';
  for (const endpoint of rpcUrls?.length ? rpcUrls : DEFAULT_EVM_RPC_URLS[input.chainId] ?? []) {
    try {
      const encoded = await evmCall(fetcher, endpoint, input.token, '0x313ce567');
      if (!/^0x[0-9a-fA-F]{64}$/.test(encoded)) throw new Error('TOKEN_METADATA_EVM_DECIMALS_INVALID');
      const parsed = BigInt(encoded), decimals = parsed <= 30n ? Number(parsed) : null;
      if (decimals === null) throw new Error('TOKEN_METADATA_EVM_DECIMALS_INVALID');
      let symbol: string | undefined;
      try { symbol = decodeAbiString(await evmCall(fetcher, endpoint, input.token, '0x95d89b41')); }
      catch { /* Symbol is optional; never substitute aggregator-controlled metadata. */ }
      return { chain: 'EVM', chainId: input.chainId, token: input.token, decimals, symbol, source: 'EVM RPC', verifiedAt: new Date().toISOString() };
    } catch (error) { lastError = error instanceof Error ? error.message : lastError; }
  }
  throw new Error(lastError);
}

async function solanaMetadata(input: SwapTokenMetadataInput, fetcher: FetchLike, rpcUrls: string[]): Promise<SwapTokenMetadata> {
  if (!solanaAddress(input.token)) throw new Error('TOKEN_METADATA_SOLANA_INPUT_INVALID');
  let lastError = 'TOKEN_METADATA_SOLANA_UNAVAILABLE';
  for (const endpoint of rpcUrls) {
    try {
      const body = await json(await fetcher(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenSupply', params: [input.token, { commitment: 'confirmed' }] }),
        signal: AbortSignal.timeout(8_000),
      }));
      const decimals = validDecimals(record(record(body.result).value).decimals);
      if (decimals === null || body.error) throw new Error('TOKEN_METADATA_SOLANA_RESPONSE_INVALID');
      return { chain: 'SOL', token: input.token, decimals, source: 'Solana RPC', verifiedAt: new Date().toISOString() };
    } catch (error) { lastError = error instanceof Error ? error.message : lastError; }
  }
  throw new Error(lastError);
}

async function tronMetadata(input: SwapTokenMetadataInput, fetcher: FetchLike, rpcUrl: string, tronGridApiKey?: string): Promise<SwapTokenMetadata> {
  if (!tronAddress(input.token)) throw new Error('TOKEN_METADATA_TRON_INPUT_INVALID');
  if (input.token === TRON_NATIVE_TOKEN) return { chain: 'TRON', token: input.token, decimals: 6, symbol: 'TRX', source: 'TRON RPC', verifiedAt: new Date().toISOString() };
  const call = async (functionSelector: string) => json(await fetcher(`${rpcUrl.replace(/\/$/, '')}/wallet/triggerconstantcontract`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(tronGridApiKey ? { 'TRON-PRO-API-KEY': tronGridApiKey } : {}) },
    body: JSON.stringify({ owner_address: TRON_NATIVE_TOKEN, contract_address: input.token, function_selector: functionSelector, visible: true }), signal: AbortSignal.timeout(8_000),
  }));
  const body = await call('decimals()');
  const result = record(body.result), encoded = Array.isArray(body.constant_result) ? body.constant_result[0] : undefined;
  if (result.result !== true || typeof encoded !== 'string' || !/^[0-9a-fA-F]{64}$/.test(encoded)) throw new Error('TOKEN_METADATA_TRON_RESPONSE_INVALID');
  const parsed = BigInt(`0x${encoded}`), decimals = parsed <= 30n ? Number(parsed) : null;
  if (decimals === null) throw new Error('TOKEN_METADATA_TRON_DECIMALS_INVALID');
  let symbol: string | undefined;
  try { const symbolBody = await call('symbol()'); symbol = decodeAbiString(Array.isArray(symbolBody.constant_result) ? symbolBody.constant_result[0] : undefined); }
  catch { /* Symbol is optional and must never come from the quote provider. */ }
  return { chain: 'TRON', token: input.token, decimals, symbol, source: 'TRON RPC', verifiedAt: new Date().toISOString() };
}

export async function resolveSwapTokenMetadata(input: SwapTokenMetadataInput, options: {
  fetcher?: FetchLike;
  evmRpcUrls?: string[];
  solanaRpcUrls?: string[];
  tronRpcUrl?: string;
  tronGridApiKey?: string;
} = {}): Promise<SwapTokenMetadata> {
  const fetcher = options.fetcher ?? fetch;
  if (input.chain === 'EVM') return evmMetadata(input, fetcher, options.evmRpcUrls);
  if (input.chain === 'SOL') return solanaMetadata(input, fetcher, options.solanaRpcUrls?.length ? options.solanaRpcUrls : ['https://api.mainnet-beta.solana.com']);
  return tronMetadata(input, fetcher, options.tronRpcUrl ?? 'https://api.trongrid.io', options.tronGridApiKey);
}

export async function cachedSwapTokenMetadata(input: SwapTokenMetadataInput, options: Parameters<typeof resolveSwapTokenMetadata>[1] = {}) {
  const tokenKey = input.chain === 'EVM' ? input.token.toLowerCase() : input.token;
  const key = `${input.chain}:${input.chainId ?? ''}:${tokenKey}`, now = Date.now(), cached = metadataCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await resolveSwapTokenMetadata(input, options);
  if (metadataCache.size >= 500) metadataCache.delete(metadataCache.keys().next().value!);
  metadataCache.set(key, { value, expiresAt: now + (value.symbol ? 15 * 60_000 : 30_000) });
  return value;
}
