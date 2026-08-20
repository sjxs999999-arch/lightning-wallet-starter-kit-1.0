import { describe, expect, it } from 'vitest';
// @ts-expect-error Production Vercel handler helpers are intentionally plain ESM JavaScript.
import { createLaunchpadValidation, parseLaunchpadDraft } from '../../web/public/api/v1/launchpad-lib.js';
// @ts-expect-error Production Vercel route policy is intentionally plain ESM JavaScript.
import { routeRequiresAuth } from '../../web/public/api/v1/route-policy.js';

const draft = {
  chain: 'EVM', network: 'sepolia', name: 'Lightning Token', symbol: 'LGT', decimals: 18, supply: '1000000',
  description: '', website: '', socials: { x: '', telegram: '', discord: '' }, media: {},
  liquidity: { tokenAmount: '1000', quoteSymbol: 'USDC', quoteAmount: '100', lockDays: 30 }, dryRun: true,
};

describe('production serverless Launchpad validation', () => {
  it('returns a non-signing and non-broadcast validation plan', () => {
    const parsed = parseLaunchpadDraft(draft);
    expect(parsed).not.toBeNull();
    expect(createLaunchpadValidation(parsed)).toMatchObject({ chain: 'EVM', network: 'sepolia', status: 'validated', broadcast: false, serverSigning: false, requiredSigner: 'user-wallet' });
  });

  it('exposes validation without an operator session', () => {
    expect(routeRequiresAuth('POST', 'launchpad/validate')).toBe(false);
    expect(routeRequiresAuth('POST', 'launchpad/plan')).toBe(true);
  });

  it.each([
    ['EVM', 'ethereum', 18], ['SOL', 'solana-devnet', 9], ['SOL', 'solana-mainnet', 9],
    ['TRON', 'tron-nile', 6], ['TRON', 'tron-shasta', 6], ['TRON', 'tron-mainnet', 6],
  ])('supports the exact %s / %s network pair', (chain, network, decimals) => {
    expect(parseLaunchpadDraft({ ...draft, chain, network, decimals })).not.toBeNull();
  });

  it.each([
    ['EVM', 'solana-mainnet'], ['SOL', 'ethereum'], ['TRON', 'sepolia'],
  ])('rejects the cross-chain %s / %s network pair', (chain, network) => {
    expect(parseLaunchpadDraft({ ...draft, chain, network })).toBeNull();
  });

  it('rejects sensitive and unknown fields instead of silently accepting them', () => {
    expect(parseLaunchpadDraft({ ...draft, privateKey: 'blocked' })).toBeNull();
    expect(parseLaunchpadDraft({ ...draft, mnemonic: 'blocked' })).toBeNull();
  });
});
