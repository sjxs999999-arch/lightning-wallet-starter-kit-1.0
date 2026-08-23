import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function routeSlice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('signed transaction relay retirement', () => {
  it('keeps the Fastify API from accepting or broadcasting signed Solana payloads', () => {
    const source = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
    const route = routeSlice(source, "app.post('/api/v1/solana/send-signed-batch'", "app.post('/api/v1/auth/login'");
    expect(route).toContain("status(410)");
    expect(route).toContain("CLIENT_ONLY_BROADCAST");
    expect(route).toContain("serverBroadcast:false");
    expect(route).not.toMatch(/sendTransaction|transactions\s*:/);
  });

  it('keeps the Vercel fallback from accepting or broadcasting signed Solana payloads', () => {
    const source = readFileSync(new URL('../../web/public/api/v1/[...path].js', import.meta.url), 'utf8');
    const route = routeSlice(source, "if(method==='POST'&&route==='solana/send-signed-batch')", "if(method==='GET'&&route==='gasfree/status')");
    expect(route).toContain("send(res,410");
    expect(route).toContain("CLIENT_ONLY_BROADCAST");
    expect(route).toContain("serverBroadcast:false");
    expect(route).not.toMatch(/solanaRpc\('sendTransaction'|transactions\s*=/);
  });
});
