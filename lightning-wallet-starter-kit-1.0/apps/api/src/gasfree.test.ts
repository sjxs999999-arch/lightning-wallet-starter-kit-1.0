import { describe, expect, it, vi } from 'vitest';
import {
  evaluateVipPolicy,
  gasEstimateSchema,
  listGasJobs,
  recordGasEstimate,
  recordGasSponsor,
  sponsorRequestSchema,
} from './gasfree.js';

const request = {
  chainId: 11155111 as const,
  sender: '0x1111111111111111111111111111111111111111',
  userOperationHash: `0x${'ab'.repeat(32)}`,
  estimatedCostWei: '1000000000000000',
  vipTier: 'silver' as const,
  dryRun: true,
};
const estimateInput = {
  from: request.sender,
  to: '0x2222222222222222222222222222222222222222',
  value: '0',
  data: '0x',
  audit: true,
};
const estimate = {
  chainId: 11155111,
  network: 'Sepolia',
  balanceWei: '2000000000000000',
  gasLimit: '21000',
  gasPriceWei: '1000000000',
  estimatedCostWei: '21000000000000',
  sufficient: true,
};

describe('GasFree policy and audit history', () => {
  it('accepts only strict Sepolia sponsor metadata without keys', () => {
    expect(sponsorRequestSchema.parse(request)).toMatchObject({ chainId: 11155111, dryRun: true });
    expect(() => sponsorRequestSchema.parse({ ...request, privateKey: 'blocked' })).toThrow();
    expect(() => gasEstimateSchema.parse({ ...estimateInput, mnemonic: 'blocked' })).toThrow();
  });

  it('approves eligible VIP cost', () => expect(evaluateVipPolicy(request)).toMatchObject({ eligible: true, reason: 'ELIGIBLE' }));

  it('rejects standard and over-limit requests', () => {
    expect(evaluateVipPolicy({ ...request, vipTier: 'standard' }).eligible).toBe(false);
    expect(evaluateVipPolicy({ ...request, estimatedCostWei: '6000000000000000' }).eligible).toBe(false);
  });

  it('rejects mainnet and oversized calldata', () => {
    expect(() => sponsorRequestSchema.parse({ ...request, chainId: 1 })).toThrow();
    expect(() => gasEstimateSchema.parse({ ...estimateInput, data: `0x${'ab'.repeat(9000)}` })).toThrow();
  });

  it('persists a safe estimate without calldata or key material', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'estimate-job', kind: 'gas-estimate', status: 'completed' }] });
    const job = await recordGasEstimate({ query }, estimateInput, estimate);
    expect(job).toMatchObject({ id: 'estimate-job', payload: { dataBytes: 0, dryRun: true }, result: { serverSigning: false, serverBroadcast: false } });
    expect(JSON.stringify(query.mock.calls[0])).not.toMatch(/private|mnemonic|secret/i);
    expect(JSON.stringify(query.mock.calls[0])).not.toContain('"data":"0x"');
  });

  it('persists a redacted sponsor decision without paymaster data', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'sponsor-job', kind: 'gas-sponsor', status: 'completed' }] });
    const job = await recordGasSponsor({ query }, request, { ...evaluateVipPolicy(request), provider: 'provider', paymasterData: 'secret-provider-payload', dryRun: true, signatureRequired: true, broadcast: false });
    expect(job).toMatchObject({ id: 'sponsor-job', result: { eligible: true, provider: 'provider', broadcast: false } });
    expect(JSON.stringify(query.mock.calls[0])).not.toMatch(/secret-provider-payload|paymasterData/);
  });

  it('lists only GasFree audit jobs with a bounded limit', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'job' }] });
    await expect(listGasJobs({ query }, { limit: 25 })).resolves.toEqual([{ id: 'job' }]);
    expect(query.mock.calls[0]?.[0]).toContain("kind IN ('gas-estimate','gas-sponsor')");
    expect(query.mock.calls[0]?.[1]).toEqual([25]);
  });
});
