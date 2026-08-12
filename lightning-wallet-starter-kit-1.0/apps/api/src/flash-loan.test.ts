import { describe, expect, it, vi } from 'vitest';
import { flashLoanHistorySchema, flashLoanSessionClaims, listFlashLoanHistory, recordFlashLoanHistory } from './flash-loan.js';

const history = {
  id: '00000000-0000-4000-8000-000000000001',
  createdAt: new Date(0).toISOString(),
  network: 'sepolia' as const,
  walletAddress: '0x1111111111111111111111111111111111111111',
  status: 'dry-run' as const,
  protocol: 'FlashForge',
  asset: 'ETH',
  amount: '0',
};

describe('flash loan integration session and audit history', () => {
  it('creates only a five-minute-compatible Sepolia metadata scope', () => {
    expect(flashLoanSessionClaims({ network: 'sepolia', dryRun: true }, { sub: 'operator@example.com', role: 'operator' })).toEqual({ sub: 'operator@example.com', aud: 'flash-loan', scope: ['wallet:public', 'history:metadata'], network: 'sepolia', dryRun: true });
  });

  it('rejects mainnet, non-dry-run, invalid identities and signing material', () => {
    expect(() => flashLoanSessionClaims({ network: 'mainnet', dryRun: true }, { sub: 'operator', role: 'operator' })).toThrow();
    expect(() => flashLoanSessionClaims({ network: 'sepolia', dryRun: false }, { sub: 'operator', role: 'operator' })).toThrow();
    expect(() => flashLoanSessionClaims({ network: 'sepolia', dryRun: true }, { sub: 'integration' })).toThrow();
    expect(() => flashLoanSessionClaims({ network: 'sepolia', dryRun: true, privateKey: 'blocked' }, { sub: 'operator', role: 'operator' })).toThrow();
  });

  it('accepts only non-broadcast Dry Run history metadata', () => {
    expect(flashLoanHistorySchema.parse(history)).toMatchObject({ status: 'dry-run', network: 'sepolia' });
    expect(() => flashLoanHistorySchema.parse({ ...history, status: 'submitted' })).toThrow();
    expect(() => flashLoanHistorySchema.parse({ ...history, transactionHash: `0x${'ab'.repeat(32)}` })).toThrow();
    expect(() => flashLoanHistorySchema.parse({ ...history, mnemonic: 'blocked' })).toThrow();
  });

  it('persists metadata idempotently without keys or transaction hashes', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'job', kind: 'flash-loan', status: 'completed' }] });
    const job = await recordFlashLoanHistory({ query }, history);
    expect(job).toMatchObject({ id: 'job', payload: { dryRun: true, protocol: 'FlashForge' }, result: { broadcast: false, serverSigning: false, serverBroadcast: false, transactionHash: null } });
    expect(query.mock.calls[0]?.[0]).toContain('ON CONFLICT(idempotency_key)');
    expect(JSON.stringify(query.mock.calls[0])).not.toMatch(/private|mnemonic|secret/i);
  });

  it('maps failed simulations to failed audit jobs', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'failed-job', status: 'failed' }] });
    const job = await recordFlashLoanHistory({ query }, { ...history, status: 'failed' });
    expect(job).toMatchObject({ id: 'failed-job', result: { status: 'failed', broadcast: false } });
    expect(query.mock.calls[0]?.[1]?.[1]).toBe('failed');
  });

  it('lists only FlashForge jobs with a bounded limit', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'job' }] });
    await expect(listFlashLoanHistory({ query }, { limit: 30 })).resolves.toEqual([{ id: 'job' }]);
    expect(query.mock.calls[0]?.[0]).toContain("kind='flash-loan'");
    expect(query.mock.calls[0]?.[1]).toEqual([30]);
  });
});
