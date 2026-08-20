import { describe, expect, it } from 'vitest';
import { clientCrashReportQuerySchema, clientCrashReportSchema, ensureClientDiagnosticsSchema, listClientCrashReports, pruneClientCrashReports, recordClientCrashReport } from './diagnostics.js';

describe('privacy-safe client diagnostics',()=>{
  const safe={name:'TypeError',code:'RENDER_FAILURE',route:'/batch-wallets',fingerprint:'0123456789abcdef01234567',release:'2.22.0'};
  it('accepts metadata-only crash reports',()=>expect(clientCrashReportSchema.parse(safe)).toEqual(safe));
  it('rejects error text, stacks and sensitive fields',()=>{
    for(const field of ['message','stack','privateKey','mnemonic'])expect(()=>clientCrashReportSchema.parse({...safe,[field]:'must-not-leave-browser'})).toThrow();
  });

  it('aggregates only validated metadata and never stores error text',async()=>{
    const calls:Array<{text:string;values?:unknown[]}>=[];
    const now='2026-08-20T00:00:00.000Z';
    const db={query:async(text:string,values?:unknown[])=>{calls.push({text,values});return{rows:[{...safe,occurrences:'2',firstSeen:now,lastSeen:now}]}}};
    const result=await recordClientCrashReport(db,safe);
    expect(result).toMatchObject({...safe,occurrences:2,firstSeen:now,lastSeen:now});
    expect(calls[0]?.text).toContain('ON CONFLICT');
    expect(calls[0]?.values).toEqual([safe.fingerprint,safe.release,safe.route,safe.name,safe.code]);
    expect(JSON.stringify(calls)).not.toMatch(/message|stack|privateKey|mnemonic/i);
  });

  it('creates, lists and prunes the bounded aggregate store',async()=>{
    const calls:string[]=[];
    const now='2026-08-20T00:00:00.000Z';
    const db={query:async(text:string)=>{calls.push(text);return{rows:text.startsWith('SELECT')?[{...safe,occurrences:3,firstSeen:now,lastSeen:now}]:[]}}};
    await ensureClientDiagnosticsSchema(db);
    expect(await listClientCrashReports(db,{limit:'10'})).toHaveLength(1);
    await pruneClientCrashReports(db);
    expect(calls.join('\n')).toContain('90 days');
    expect(()=>clientCrashReportQuerySchema.parse({limit:101})).toThrow();
  });
});
