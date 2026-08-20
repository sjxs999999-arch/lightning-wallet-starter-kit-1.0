import { describe, expect, it, vi } from 'vitest';
import { createDeploymentPlan, launchpadDraftSchema, persistDeploymentPlan } from './launchpad.js';

const draft = {
  chain: 'EVM', network: 'sepolia', name: 'Lightning Token', symbol: 'LGT', decimals: 18, supply: '1000000',
  description: '', website: '', socials: { x: '', telegram: '', discord: '' }, media: {},
  liquidity: { tokenAmount: '1000', quoteSymbol: 'USDC', quoteAmount: '100', lockDays: 30 }, dryRun: true,
};

describe('Launchpad plan', () => {
  it('creates a non-broadcast Dry Run plan', () => {
    expect(createDeploymentPlan(draft)).toMatchObject({ status: 'validated', broadcast: false, serverSigning: false, requiredSigner: 'user-wallet' });
  });

  it.each([
    ['EVM', 'sepolia', 18], ['EVM', 'ethereum', 18], ['EVM', 'bsc', 18], ['EVM', 'polygon', 18],
    ['EVM', 'base', 18], ['EVM', 'arbitrum', 18], ['SOL', 'solana-devnet', 9],
    ['SOL', 'solana-mainnet', 9], ['TRON', 'tron-nile', 6], ['TRON', 'tron-shasta', 6],
    ['TRON', 'tron-mainnet', 6],
  ] as const)('accepts the exact %s / %s network pair', (chain, network, decimals) => {
    expect(launchpadDraftSchema.parse({ ...draft, chain, network, decimals })).toMatchObject({ chain, network });
  });

  it.each([
    ['EVM', 'solana-mainnet'], ['SOL', 'ethereum'], ['TRON', 'sepolia'],
  ] as const)('rejects the cross-chain %s / %s network pair', (chain, network) => {
    expect(() => launchpadDraftSchema.parse({ ...draft, chain, network })).toThrow();
  });

  it('rejects zero amounts', () => {
    expect(() => launchpadDraftSchema.parse({ ...draft, supply: '00' })).toThrow();
    expect(() => launchpadDraftSchema.parse({ ...draft, liquidity: { ...draft.liquidity, quoteAmount: '0' } })).toThrow();
  });

  it('drops sensitive unknown fields', () => {
    expect(launchpadDraftSchema.parse({ ...draft, privateKey: 'blocked' })).not.toHaveProperty('privateKey');
  });

  it('persists a safe project, version, and operation in one query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'project' }] });
    const result = await persistDeploymentPlan({ query }, { ...draft, privateKey: 'blocked', mnemonic: 'blocked' });
    expect(result).toMatchObject({ projectId: expect.any(String), status: 'validated', broadcast: false, serverSigning: false });
    expect(query).toHaveBeenCalledTimes(1);
    const call = query.mock.calls[0]!;
    expect(call[0]).toContain('created_project');
    expect(JSON.stringify(call[1])).not.toMatch(/privateKey|mnemonic|blocked/);
  });
});
