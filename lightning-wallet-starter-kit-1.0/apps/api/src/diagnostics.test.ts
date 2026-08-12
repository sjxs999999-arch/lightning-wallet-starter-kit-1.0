import { describe, expect, it } from 'vitest';
import { clientCrashReportSchema } from './diagnostics.js';

describe('privacy-safe client diagnostics',()=>{
  const safe={name:'TypeError',code:'RENDER_FAILURE',route:'/batch-wallets',fingerprint:'0123456789abcdef01234567',release:'2.16.0'};
  it('accepts metadata-only crash reports',()=>expect(clientCrashReportSchema.parse(safe)).toEqual(safe));
  it('rejects error text, stacks and sensitive fields',()=>{
    for(const field of ['message','stack','privateKey','mnemonic'])expect(()=>clientCrashReportSchema.parse({...safe,[field]:'must-not-leave-browser'})).toThrow();
  });
});
