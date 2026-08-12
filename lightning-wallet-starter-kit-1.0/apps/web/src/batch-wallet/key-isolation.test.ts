import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

describe('batch wallet main-thread isolation',()=>{
  it('keeps export password checks and private-key decryption inside workers',()=>{
    const app=readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),verifier=readFileSync(new URL('./verifier.worker.ts',import.meta.url),'utf8'),keyCheck=readFileSync(new URL('./key-check.ts',import.meta.url),'utf8');
    expect(app).not.toMatch(/\bdecryptValue\b|\bdecryptBytes\b/);
    expect(app).toContain('verifyExportKeyInWorker');
    const preflight=app.indexOf('valid=await verifyExportKeyInWorker(key,wallets[0]!.encryptedPrivateKey,controller.signal)'),verifierStart=app.indexOf("new Worker(new URL('./batch-wallet/verifier.worker.ts'");
    expect(preflight).toBeGreaterThan(-1);
    expect(verifierStart).toBeGreaterThan(preflight);
    expect(app).toContain('取消验证');
    expect(keyCheck).toContain("new Worker(new URL('./key-check.worker.ts'");
    expect(keyCheck).toContain("addEventListener('abort'");
    expect(verifier).toContain('decryptBytes');
    expect(verifier).toContain('verifyWalletControlBytes');
    expect(verifier).not.toContain('decryptValue');
  });
});
