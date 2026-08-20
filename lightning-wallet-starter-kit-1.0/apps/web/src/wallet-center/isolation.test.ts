import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('wallet center isolation', () => {
  it('does not call the API or log secret material', () => {
    const source = fs.readFileSync(new URL('./LocalWalletCenter.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bapi\s*\(/);
    expect(source).not.toContain('console.log');
    expect(source).not.toContain('sessionStorage.setItem');
    expect(source).not.toContain('localStorage.setItem');
    expect(source).toContain('明文密钥不持久化');
  });
});
