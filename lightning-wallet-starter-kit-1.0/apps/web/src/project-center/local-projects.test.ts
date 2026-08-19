import { describe, expect, it } from 'vitest';
import { filterLocalProjects, loadLocalProjects, localProjectFromDraft, recordLocalDeployment, saveLocalProject } from './local-projects';

const draft = { chain: 'SOL' as const, network: 'solana-devnet' as const, name: 'Lightning Token', symbol: 'LGT', decimals: 9, supply: '1000', description: 'Local draft', website: 'https://example.com', socials: { x: '', telegram: '', discord: '' }, media: {}, liquidity: { tokenAmount: '100', quoteSymbol: 'USDC', quoteAmount: '10', lockDays: 30 }, dryRun: true };

describe('browser-local project registry', () => {
  it('persists sanitized launchpad metadata and supports filters', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const project = localProjectFromDraft(draft, 'plan-1');
    saveLocalProject(project, storage);
    expect(loadLocalProjects(storage)).toEqual([project]);
    expect(filterLocalProjects([project], 'lgt', 'SOL', 'draft')).toEqual([project]);
    expect(JSON.stringify(project)).not.toMatch(/privateKey|mnemonic|seedPhrase/);
  });

  it('drops incomplete browser records', () => {
    expect(loadLocalProjects({ getItem: () => JSON.stringify([{ id: 'local-bad' }]) })).toEqual([]);
  });

  it('records only public deployment metadata and marks the project deployed', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const project = localProjectFromDraft(draft, 'plan-2');
    saveLocalProject(project, storage);
    const updated = recordLocalDeployment(project.id, { id: 'tx-1', chain: 'SOL', network: 'Solana Devnet', contract_address: 'MintAddress', transaction_hash: 'Signature', status: 'confirmed', deployed_at: '2026-08-20T00:00:00.000Z' }, storage);
    expect(updated).toMatchObject({ status: 'deployed', deployments: [{ contract_address: 'MintAddress', transaction_hash: 'Signature' }] });
    expect(values.get('lightning-client-projects-v1')).not.toMatch(/privateKey|mnemonic|seedPhrase/i);
  });
});
