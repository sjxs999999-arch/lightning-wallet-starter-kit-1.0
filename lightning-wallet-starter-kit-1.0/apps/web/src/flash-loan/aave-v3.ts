import { Interface, formatUnits, getAddress, parseUnits } from 'ethers';
import { SEPOLIA_CHAIN_ID, type FlashLoanEthereumProvider } from './bridge';

/**
 * Verified against the official Aave address-book manifest on 2026-09-18.
 * Manifest commit: 4e13aa197ca74e84c7e878bc752e519c260d6f30
 * Source: https://aave-dao.github.io/aave-address-book/api/v1/modules/AaveV3Sepolia.json
 */
export const AAVE_V3_SEPOLIA = {
  chainId: SEPOLIA_CHAIN_ID,
  pool: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
  poolAddressesProvider: '0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A',
  assets: {
    USDC: { address: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8', decimals: 6, maxAmount: '100000' },
    WETH: { address: '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c', decimals: 18, maxAmount: '100' },
    DAI: { address: '0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357', decimals: 18, maxAmount: '100000' },
  },
} as const;

export type AaveV3SepoliaAsset = keyof typeof AAVE_V3_SEPOLIA.assets;

const poolInterface = new Interface([
  'function flashLoanSimple(address receiverAddress,address asset,uint256 amount,bytes params,uint16 referralCode)',
  'function FLASHLOAN_PREMIUM_TOTAL() view returns (uint128)',
]);
const receiverInterface = new Interface([
  'function POOL() view returns (address)',
  'function ADDRESSES_PROVIDER() view returns (address)',
]);

export type AaveFlashLoanPlan = {
  chainId: typeof SEPOLIA_CHAIN_ID;
  account: string;
  pool: string;
  receiver: string;
  asset: AaveV3SepoliaAsset;
  assetAddress: string;
  amount: string;
  amountUnits: bigint;
  data: string;
  params: string;
  referralCode: 0;
  transaction: { from: string; to: string; data: string; value: '0x0' };
};

export type AaveFlashLoanPreflight = {
  simulation: 'passed';
  poolCodeVerified: true;
  receiverCodeVerified: true;
  receiverPoolVerified: true;
  receiverProviderVerified: true;
  assetCodeVerified: true;
  premiumBps: number;
  premiumAmount: string;
  gasLimit: bigint;
  gasPriceWei: bigint;
  estimatedGasCostWei: bigint;
  requiresWalletSignature: true;
  broadcast: false;
};

export function flashLoanPreflightEnabled(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true');
}

export function parseReceiverAllowlist(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const receivers: string[] = [];
  for (const raw of value.split(',')) {
    const candidate = raw.trim();
    if (!candidate) continue;
    try {
      const receiver = getAddress(candidate);
      if (!receivers.some(item => item.toLowerCase() === receiver.toLowerCase())) receivers.push(receiver);
    } catch {
      // Invalid deployment configuration is ignored so the feature remains fail-closed.
    }
  }
  return receivers.slice(0, 20);
}

function configuredAddress(value: string, code: string): string {
  try { return getAddress(value); } catch { throw new Error(code); }
}

function normalizedChainId(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('AAVE_CHAIN_UNAVAILABLE');
  return `0x${BigInt(value).toString(16)}`;
}

function hexQuantity(value: unknown, code: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error(code);
  return BigInt(value);
}

function contractCode(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]*$/i.test(value) || /^0x0*$/i.test(value)) throw new Error(code);
  return value;
}

function callResult(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]*$/i.test(value)) throw new Error(code);
  return value;
}

function flashLoanParams(value: unknown): string {
  if (value === undefined || value === '') return '0x';
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(value)) throw new Error('AAVE_PARAMS_INVALID');
  if ((value.length - 2) / 2 > 512) throw new Error('AAVE_PARAMS_TOO_LARGE');
  return value;
}

export function buildAaveV3FlashLoanPlan(input: {
  enabled: boolean;
  chainId: string;
  account: string;
  receiver: string;
  receiverAllowlist: readonly string[];
  asset: AaveV3SepoliaAsset;
  amount: string;
  params?: string;
}): AaveFlashLoanPlan {
  if (!input.enabled) throw new Error('AAVE_PREFLIGHT_DISABLED');
  if (normalizedChainId(input.chainId) !== SEPOLIA_CHAIN_ID) throw new Error('AAVE_SEPOLIA_ONLY');
  const account = configuredAddress(input.account, 'AAVE_ACCOUNT_INVALID');
  const receiver = configuredAddress(input.receiver, 'AAVE_RECEIVER_INVALID');
  const receiverAllowed = input.receiverAllowlist.some(item => {
    try { return getAddress(item).toLowerCase() === receiver.toLowerCase(); } catch { return false; }
  });
  if (!receiverAllowed) throw new Error('AAVE_RECEIVER_NOT_ALLOWLISTED');
  const asset = AAVE_V3_SEPOLIA.assets[input.asset];
  if (!asset) throw new Error('AAVE_ASSET_NOT_ALLOWLISTED');
  if (!/^\d+(?:\.\d+)?$/.test(input.amount.trim())) throw new Error('AAVE_AMOUNT_INVALID');
  let amountUnits: bigint;
  try { amountUnits = parseUnits(input.amount.trim(), asset.decimals); } catch { throw new Error('AAVE_AMOUNT_INVALID'); }
  if (amountUnits <= 0n) throw new Error('AAVE_AMOUNT_INVALID');
  if (amountUnits > parseUnits(asset.maxAmount, asset.decimals)) throw new Error('AAVE_AMOUNT_OVER_SAFETY_CAP');
  const params = flashLoanParams(input.params);
  const pool = getAddress(AAVE_V3_SEPOLIA.pool);
  const assetAddress = getAddress(asset.address);
  const data = poolInterface.encodeFunctionData('flashLoanSimple', [receiver, assetAddress, amountUnits, params, 0]);
  return {
    chainId: SEPOLIA_CHAIN_ID,
    account,
    pool,
    receiver,
    asset: input.asset,
    assetAddress,
    amount: input.amount.trim(),
    amountUnits,
    data,
    params,
    referralCode: 0,
    transaction: { from: account, to: pool, data, value: '0x0' },
  };
}

async function boundReceiverAddress(provider: FlashLoanEthereumProvider, receiver: string, signature: 'POOL' | 'ADDRESSES_PROVIDER'): Promise<string> {
  const result = callResult(await provider.request({
    method: 'eth_call',
    params: [{ to: receiver, data: receiverInterface.encodeFunctionData(signature) }, 'latest'],
  }), `AAVE_RECEIVER_${signature}_UNAVAILABLE`);
  try { return getAddress(String(receiverInterface.decodeFunctionResult(signature, result)[0])); }
  catch { throw new Error(`AAVE_RECEIVER_${signature}_INVALID`); }
}

export async function preflightAaveV3FlashLoan(provider: FlashLoanEthereumProvider, plan: AaveFlashLoanPlan): Promise<AaveFlashLoanPreflight> {
  const chainId = normalizedChainId(await provider.request({ method: 'eth_chainId' }));
  if (chainId !== plan.chainId) throw new Error('AAVE_CHAIN_CHANGED');
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== plan.account.toLowerCase()) throw new Error('AAVE_ACCOUNT_CHANGED');

  const [poolCode, receiverCode, assetCode, receiverPool, receiverProvider, premiumResult] = await Promise.all([
    provider.request({ method: 'eth_getCode', params: [plan.pool, 'latest'] }),
    provider.request({ method: 'eth_getCode', params: [plan.receiver, 'latest'] }),
    provider.request({ method: 'eth_getCode', params: [plan.assetAddress, 'latest'] }),
    boundReceiverAddress(provider, plan.receiver, 'POOL'),
    boundReceiverAddress(provider, plan.receiver, 'ADDRESSES_PROVIDER'),
    provider.request({ method: 'eth_call', params: [{ to: plan.pool, data: poolInterface.encodeFunctionData('FLASHLOAN_PREMIUM_TOTAL') }, 'latest'] }),
  ]);
  contractCode(poolCode, 'AAVE_POOL_CODE_MISSING');
  contractCode(receiverCode, 'AAVE_RECEIVER_CODE_MISSING');
  contractCode(assetCode, 'AAVE_ASSET_CODE_MISSING');
  if (receiverPool.toLowerCase() !== plan.pool.toLowerCase()) throw new Error('AAVE_RECEIVER_POOL_MISMATCH');
  if (receiverProvider.toLowerCase() !== AAVE_V3_SEPOLIA.poolAddressesProvider.toLowerCase()) throw new Error('AAVE_RECEIVER_PROVIDER_MISMATCH');

  let premiumBps: number;
  try {
    const decoded = poolInterface.decodeFunctionResult('FLASHLOAN_PREMIUM_TOTAL', callResult(premiumResult, 'AAVE_PREMIUM_UNAVAILABLE'))[0];
    premiumBps = Number(decoded);
  } catch { throw new Error('AAVE_PREMIUM_UNAVAILABLE'); }
  if (!Number.isInteger(premiumBps) || premiumBps < 0 || premiumBps > 1_000) throw new Error('AAVE_PREMIUM_UNSAFE');

  try {
    await provider.request({ method: 'eth_call', params: [plan.transaction, 'latest'] });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 240) : 'receiver execution reverted';
    throw new Error(`AAVE_SIMULATION_REVERTED: ${message}`);
  }
  const gasLimit = hexQuantity(await provider.request({ method: 'eth_estimateGas', params: [plan.transaction] }), 'AAVE_GAS_ESTIMATE_UNAVAILABLE');
  const gasPriceWei = hexQuantity(await provider.request({ method: 'eth_gasPrice' }), 'AAVE_GAS_PRICE_UNAVAILABLE');
  // Aave PercentageMath rounds half up using a 10_000 basis-point factor.
  const premiumUnits = (plan.amountUnits * BigInt(premiumBps) + 5_000n) / 10_000n;
  return {
    simulation: 'passed',
    poolCodeVerified: true,
    receiverCodeVerified: true,
    receiverPoolVerified: true,
    receiverProviderVerified: true,
    assetCodeVerified: true,
    premiumBps,
    premiumAmount: formatUnits(premiumUnits, AAVE_V3_SEPOLIA.assets[plan.asset].decimals),
    gasLimit,
    gasPriceWei,
    estimatedGasCostWei: gasLimit * gasPriceWei,
    requiresWalletSignature: true,
    broadcast: false,
  };
}
