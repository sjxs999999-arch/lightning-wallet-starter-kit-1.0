import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('local wallet client session isolation', () => {
  it('keeps only a non-extractable CryptoKey in memory and locks on page exit', () => {
    const source = fs.readFileSync(new URL('./LocalWalletSession.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bapi\s*\(/);
    expect(source).not.toContain('console.');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toMatch(/setItem\([^)]*password/i);
    expect(source).toContain("window.addEventListener('pagehide', lock)");
    expect(source).toContain('setVaultKey(null)');
    expect(source).toContain('vaultKeyRef.current = null');
    expect(source).toContain('vaultKeyRef.current === key');
    expect(source).toContain('AUTO_LOCK_MS = 15 * 60_000');
  });

  it('wraps only the public client surface with the wallet session provider', () => {
    const source = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(source).toContain('if(client)return <LocalWalletSessionProvider><ClientShell/></LocalWalletSessionProvider>');
  });
});
