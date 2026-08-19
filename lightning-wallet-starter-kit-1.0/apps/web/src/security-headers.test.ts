import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const flashConfig = config.headers.find(item => item.source === '/flashforge/(.*)')!;
const appConfig = config.headers.find(item => item.source.includes('?!flashforge'))!;

describe('production browser security headers', () => {
  it('ships a strict script policy and standard response protections', () => {
    const values = new Map(appConfig.headers.map(item => [item.key, item.value]));
    const csp = values.get('Content-Security-Policy') ?? '';
    expect(appConfig.source).toContain('?!flashforge');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(values.get('X-Frame-Options')).toBe('DENY');
    expect(values.get('X-Content-Type-Options')).toBe('nosniff');
    expect(values.get('Referrer-Policy')).toBe('no-referrer');
    expect(values.get('Permissions-Policy')).toContain('camera=()');
  });

  it('allows only the exact embedded FlashForge bridge script in its opaque sandbox', () => {
    const html = readFileSync(new URL('../public/flashforge/index.html', import.meta.url), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const values = new Map(flashConfig.headers.map(item => [item.key, item.value]));
    const csp = values.get('Content-Security-Policy') ?? '';
    expect(script).toContain('FLASH_LOAN_READY');
    expect(script).toContain('new URL(location.href).origin');
    expect(script).not.toContain('document.referrer');
    expect(csp).toContain(`'sha256-${createHash('sha256').update(script!).digest('base64')}'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(values.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });

  it('allows the same exact bridge script in the Docker web server only under /flashforge', () => {
    const nginx = readFileSync(new URL('../../../docker/nginx-web.conf', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../public/flashforge/index.html', import.meta.url), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const hash = createHash('sha256').update(script!).digest('base64');
    expect(nginx).toContain('location /flashforge/');
    expect(nginx).toContain(`'sha256-${hash}'`);
    expect(nginx).toContain("frame-ancestors 'self'");
    expect(nginx).toContain('https://api.mainnet-beta.solana.com');
    expect(nginx).toContain('https://solana.drpc.org');
    expect(nginx).toContain('https://eth.llamarpc.com');
  });
});
