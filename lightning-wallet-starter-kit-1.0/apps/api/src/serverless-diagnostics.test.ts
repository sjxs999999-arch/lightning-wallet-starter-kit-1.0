import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error The Vercel fallback policy is intentionally plain ESM JavaScript.
import { routeRequiresAuth } from '../../web/public/api/v1/route-policy.js';

describe('Vercel client diagnostics parity',()=>{
  it('accepts only the anonymous write while keeping report reads operator-only',()=>{
    expect(routeRequiresAuth('POST','errors/report')).toBe(false);
    expect(routeRequiresAuth('GET','errors/reports')).toBe(true);
  });

  it('aggregates strict metadata instead of storing error messages or stacks',()=>{
    const source=readFileSync(new URL('../../web/public/api/v1/[...path].js',import.meta.url),'utf8');
    const route=source.slice(source.indexOf("if(method==='POST'&&route==='errors/report')"),source.indexOf("if(method==='GET'&&route==='errors/reports')"));
    expect(route).toContain('clientCrashReportInput');
    expect(route).toContain("interval '1 minute'");
    expect(route).toContain('ON CONFLICT(fingerprint,release,route)');
    expect(route).not.toContain('requireAuth');
    expect(route).not.toMatch(/message|stack|privateKey|mnemonic/i);
  });
});
