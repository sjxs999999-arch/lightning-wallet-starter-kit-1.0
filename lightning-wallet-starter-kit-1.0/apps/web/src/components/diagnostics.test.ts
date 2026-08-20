import { describe, expect, it } from 'vitest';
import { buildClientCrashReport } from './diagnostics';

describe('client crash diagnostics',()=>{
  it('converts render failures to metadata without error text or stacks',async()=>{
    const error=new Error('privateKey=must-never-upload');
    const report=await buildClientCrashReport(error,'component stack with mnemonic=blocked','/batch-wallets?secret=blocked');
    expect(report).toMatchObject({name:'Error',code:'RENDER_FAILURE',route:'/batch-wallets',release:'2.21.0'});
    expect(report.fingerprint).toMatch(/^[a-f0-9]{24}$/);
    expect(JSON.stringify(report)).not.toMatch(/privateKey|mnemonic|must-never-upload|component stack/i);
  });
});
