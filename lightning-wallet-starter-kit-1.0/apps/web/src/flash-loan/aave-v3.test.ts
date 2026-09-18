import { describe, expect, it } from 'vitest';
import { Interface } from 'ethers';
import {
  AAVE_V3_SEPOLIA,
  buildAaveV3FlashLoanPlan,
  flashLoanPreflightEnabled,
  parseReceiverAllowlist,
  preflightAaveV3FlashLoan,
} from './aave-v3';

const account = '0x1111111111111111111111111111111111111111';
const receiver = '0x2222222222222222222222222222222222222222';
const receiverInterface = new Interface([
  'function POOL() view returns (address)',
  'function ADDRESSES_PROVIDER() view returns (address)',
]);

function plan() {
  return buildAaveV3FlashLoanPlan({
    enabled: true,
    chainId: '0xaa36a7',
    account,
    receiver,
    receiverAllowlist: [receiver],
    asset: 'USDC',
    amount: '250.5',
  });
}

describe('Aave V3 flash-loan preflight', () => {
  it('stays disabled unless the exact build flag is enabled', () => {
    expect(flashLoanPreflightEnabled('true')).toBe(true);
    expect(flashLoanPreflightEnabled('TRUE')).toBe(true);
    expect(flashLoanPreflightEnabled('1')).toBe(false);
    expect(flashLoanPreflightEnabled(undefined)).toBe(false);
    expect(() => buildAaveV3FlashLoanPlan({ enabled: false, chainId: '0xaa36a7', account, receiver, receiverAllowlist: [receiver], asset: 'USDC', amount: '1' })).toThrow('AAVE_PREFLIGHT_DISABLED');
  });

  it('parses only valid, unique receiver addresses', () => {
    expect(parseReceiverAllowlist(`${receiver},bad,${receiver.toUpperCase().replace('0X', '0x')}`)).toEqual([receiver]);
    expect(parseReceiverAllowlist(undefined)).toEqual([]);
  });

  it('builds exact Aave Pool calldata without requesting a signature', () => {
    const value = plan();
    expect(value.pool).toBe(AAVE_V3_SEPOLIA.pool);
    expect(value.assetAddress).toBe(AAVE_V3_SEPOLIA.assets.USDC.address);
    expect(value.amountUnits).toBe(250_500_000n);
    expect(value.data).toMatch(/^0x42b0b77c/);
    expect(value.transaction).toEqual({ from: account, to: AAVE_V3_SEPOLIA.pool, data: value.data, value: '0x0' });
  });

  it('rejects the wrong chain, unapproved receivers, unsafe amounts and malformed params', () => {
    const base = { enabled: true, chainId: '0xaa36a7', account, receiver, receiverAllowlist: [receiver], asset: 'USDC' as const, amount: '1' };
    expect(() => buildAaveV3FlashLoanPlan({ ...base, chainId: '0x1' })).toThrow('AAVE_SEPOLIA_ONLY');
    expect(() => buildAaveV3FlashLoanPlan({ ...base, receiverAllowlist: [] })).toThrow('AAVE_RECEIVER_NOT_ALLOWLISTED');
    expect(() => buildAaveV3FlashLoanPlan({ ...base, amount: '100001' })).toThrow('AAVE_AMOUNT_OVER_SAFETY_CAP');
    expect(() => buildAaveV3FlashLoanPlan({ ...base, params: 'not-hex' })).toThrow('AAVE_PARAMS_INVALID');
  });

  it('verifies contracts, receiver bindings, simulation, gas and current premium', async () => {
    const calls: string[] = [];
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        calls.push(method);
        if (method === 'eth_chainId') return '0xaa36a7';
        if (method === 'eth_accounts') return [account];
        if (method === 'eth_getCode') return '0x6001600055';
        if (method === 'eth_estimateGas') return '0x30d40';
        if (method === 'eth_gasPrice') return '0x3b9aca00';
        if (method === 'eth_call') {
          const transaction = params?.[0] as { to?: string; data?: string } | undefined;
          if (transaction?.to?.toLowerCase() === receiver.toLowerCase() && transaction.data === receiverInterface.encodeFunctionData('POOL')) {
            return receiverInterface.encodeFunctionResult('POOL', [AAVE_V3_SEPOLIA.pool]);
          }
          if (transaction?.to?.toLowerCase() === receiver.toLowerCase() && transaction.data === receiverInterface.encodeFunctionData('ADDRESSES_PROVIDER')) {
            return receiverInterface.encodeFunctionResult('ADDRESSES_PROVIDER', [AAVE_V3_SEPOLIA.poolAddressesProvider]);
          }
          if (transaction?.data === '0x074b2e43') return `0x${5n.toString(16).padStart(64, '0')}`;
          return '0x';
        }
        throw new Error(`unexpected ${method}`);
      },
    };
    const result = await preflightAaveV3FlashLoan(provider, plan());
    expect(result).toEqual(expect.objectContaining({ simulation: 'passed', premiumBps: 5, premiumAmount: '0.12525', gasLimit: 200_000n, estimatedGasCostWei: 200_000_000_000_000n, requiresWalletSignature: true, broadcast: false }));
    expect(calls).not.toContain('eth_sendTransaction');
    expect(calls).not.toContain('personal_sign');
  });

  it('fails closed when the receiver is not bound to the configured Pool', async () => {
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_chainId') return '0xaa36a7';
        if (method === 'eth_accounts') return [account];
        if (method === 'eth_getCode') return '0x6000';
        if (method === 'eth_call') {
          const transaction = params?.[0] as { to?: string; data?: string } | undefined;
          if (transaction?.to?.toLowerCase() === receiver.toLowerCase() && transaction.data === receiverInterface.encodeFunctionData('POOL')) return receiverInterface.encodeFunctionResult('POOL', [account]);
          if (transaction?.to?.toLowerCase() === receiver.toLowerCase()) return receiverInterface.encodeFunctionResult('ADDRESSES_PROVIDER', [AAVE_V3_SEPOLIA.poolAddressesProvider]);
          return `0x${5n.toString(16).padStart(64, '0')}`;
        }
        throw new Error('unexpected');
      },
    };
    await expect(preflightAaveV3FlashLoan(provider, plan())).rejects.toThrow('AAVE_RECEIVER_POOL_MISMATCH');
  });

  it('does not estimate or broadcast when eth_call simulation reverts', async () => {
    const methods: string[] = [];
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        methods.push(method);
        if (method === 'eth_chainId') return '0xaa36a7';
        if (method === 'eth_accounts') return [account];
        if (method === 'eth_getCode') return '0x6000';
        if (method === 'eth_call') {
          const transaction = params?.[0] as { to?: string; data?: string } | undefined;
          if (transaction?.to?.toLowerCase() === receiver.toLowerCase() && transaction.data === receiverInterface.encodeFunctionData('POOL')) return receiverInterface.encodeFunctionResult('POOL', [AAVE_V3_SEPOLIA.pool]);
          if (transaction?.to?.toLowerCase() === receiver.toLowerCase()) return receiverInterface.encodeFunctionResult('ADDRESSES_PROVIDER', [AAVE_V3_SEPOLIA.poolAddressesProvider]);
          if (transaction?.data === '0x074b2e43') return `0x${5n.toString(16).padStart(64, '0')}`;
          throw new Error('execution reverted: premium missing');
        }
        throw new Error('unexpected');
      },
    };
    await expect(preflightAaveV3FlashLoan(provider, plan())).rejects.toThrow(/AAVE_SIMULATION_REVERTED/);
    expect(methods).not.toContain('eth_estimateGas');
    expect(methods).not.toContain('eth_sendTransaction');
  });
});
