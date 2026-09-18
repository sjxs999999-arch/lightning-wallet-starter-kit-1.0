#!/usr/bin/env node

const addressBookRoot = 'https://aave-dao.github.io/aave-address-book/api/v1/';
const rpcUrl = process.env.AAVE_SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const expected = {
  chainId: 11155111,
  pool: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
  provider: '0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A',
  assets: {
    USDC: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8',
    WETH: '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c',
    DAI: '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357',
  },
};

function sameAddress(left, right) {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
}

async function json(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

let id = 0;
async function rpc(method, params) {
  const response = await json(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  if (response.error) throw new Error(`${method}: ${response.error.message || 'RPC error'}`);
  return response.result;
}

const manifest = await json(new URL('manifest.json', addressBookRoot));
const moduleEntry = manifest.modules?.find(item => item.name === 'AaveV3Sepolia');
if (!moduleEntry?.path || moduleEntry.chainId !== expected.chainId) throw new Error('Official AaveV3Sepolia manifest entry is missing or has the wrong chain ID');
const module = await json(new URL(moduleEntry.path, addressBookRoot));
if (!sameAddress(module.POOL, expected.pool)) throw new Error('Aave Sepolia Pool address changed; review and update the release before enabling it');
if (!sameAddress(module.POOL_ADDRESSES_PROVIDER, expected.provider)) throw new Error('Aave Sepolia PoolAddressesProvider changed; review required');
for (const [symbol, address] of Object.entries(expected.assets)) {
  if (!sameAddress(module.ASSETS?.[symbol]?.UNDERLYING, address)) throw new Error(`Aave Sepolia ${symbol} address changed; review required`);
}

const chainId = Number(BigInt(await rpc('eth_chainId', [])));
if (chainId !== expected.chainId) throw new Error(`RPC is on chain ${chainId}, expected Sepolia ${expected.chainId}`);
for (const [label, address] of [['POOL', expected.pool], ...Object.entries(expected.assets)]) {
  const code = await rpc('eth_getCode', [address, 'latest']);
  if (typeof code !== 'string' || /^0x0*$/i.test(code)) throw new Error(`${label} has no contract code at the configured address`);
}
const premiumHex = await rpc('eth_call', [{ to: expected.pool, data: '0x074b2e43' }, 'latest']);
const premiumBps = Number(BigInt(premiumHex));
if (!Number.isInteger(premiumBps) || premiumBps < 0 || premiumBps > 1_000) throw new Error(`Unsafe flash-loan premium: ${premiumBps} bps`);

console.log(JSON.stringify({
  ok: true,
  network: 'sepolia',
  chainId,
  addressBookCommit: manifest.commit,
  addressBookModuleSha256: moduleEntry.sha256,
  pool: expected.pool,
  assets: expected.assets,
  premiumBps,
  readOnly: true,
  signed: false,
  broadcast: false,
}, null, 2));
