import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('wallet migration secret isolation', () => {
  it('decrypts and verifies only inside the dedicated one-shot worker path', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('./MigrationPanel.tsx', import.meta.url), 'utf8');
    const wrapper = readFileSync(new URL('./migration.ts', import.meta.url), 'utf8');
    const worker = readFileSync(new URL('./migration.worker.ts', import.meta.url), 'utf8');
    const core = readFileSync(new URL('./migration-core.ts', import.meta.url), 'utf8');
    const migrationUi = `${panel}\n${wrapper}`;

    expect(app).not.toMatch(/\bdecryptValue\b|\bdecryptBytes\b/);
    expect(panel).toContain('recoverMigrationSecretInWorker');
    expect(wrapper).toContain("new Worker(new URL('./migration.worker.ts'");
    expect(wrapper).toContain("addEventListener('abort'");
    expect(worker).toContain('self.close()');
    expect(worker).toContain('}, [secret]);');
    expect(core).toContain('verifyWalletControlBytes');
    expect(core).toContain('deriveWallet');
    expect(migrationUi).not.toMatch(/fetch\(|\bapi\(|localStorage|sessionStorage|indexedDB|createObjectURL|navigator\.clipboard|console\./);
  });

  it('does not persist, automatically copy or download plaintext migration secrets', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('./MigrationPanel.tsx', import.meta.url), 'utf8');
    expect(panel).not.toMatch(/setMnemonic|setPrivateKey|useState\([^)]*secret/i);
    expect(panel).toContain("secretRef.current.value = secretText");
    expect(panel).toContain("secretRef.current.value = ''");
    expect(panel).toContain('secretBytes.fill(0)');
    expect(panel).toContain('useLayoutEffect');
    expect(panel).toContain('batchRevision');
    expect(panel).toContain('latest.wallets === requestedWallets');
    expect(panel).toContain('expiresAt - Date.now()');
    expect(panel).toContain('data-1p-ignore="true"');
    expect(panel).toContain("document.visibilityState === 'hidden'");
    expect(panel).toContain("window.addEventListener('pagehide'");
    expect(app).toContain('const parentDisabled=busy||verifying||exporting||importing||migrationActive');
    expect(app).toContain('if(importEpochRef.current!==importEpoch)return');
    expect(panel).not.toMatch(/download|clipboard|writeText/);
  });
});
