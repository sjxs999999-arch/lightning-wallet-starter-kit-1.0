import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('local signing isolation', () => {
  it('keeps decryption in a dedicated one-shot worker and never calls the application API', () => {
    const panel = fs.readFileSync(new URL('./LocalTransferPanel.tsx', import.meta.url), 'utf8');
    const wrapper = fs.readFileSync(new URL('./local-signer.ts', import.meta.url), 'utf8');
    const worker = fs.readFileSync(new URL('./local-signer.worker.ts', import.meta.url), 'utf8');
    const core = fs.readFileSync(new URL('./local-signer-core.ts', import.meta.url), 'utf8');
    const batch = fs.readFileSync(new URL('../batch-transfer/local-vault-executor.ts', import.meta.url), 'utf8');
    expect(panel).not.toMatch(/decryptBytes|decryptValue|privateKey|mnemonic|\bapi\s*\(/);
    expect(wrapper).toContain("new Worker(new URL('./local-signer.worker.ts'");
    expect(worker).toContain('self.close()');
    expect(core).toContain('decryptBytes');
    expect(`${panel}${wrapper}${worker}${core}`).not.toContain('console.log');
    expect(`${panel}${wrapper}${worker}${core}`).not.toMatch(/fetch\(|\bapi\s*\(/);
    expect(batch).toContain("if (options.shouldStop()) throw new Error('本地保险库已锁定；已签名交易没有广播')");
    expect(batch).not.toMatch(/\bapi\s*\(|console\./);
  });
});
