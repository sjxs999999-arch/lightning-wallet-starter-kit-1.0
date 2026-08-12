import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(new URL('../public/vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

describe('production browser security headers', () => {
  it('ships a strict script policy and standard response protections', () => {
    const values = new Map(config.headers[0]!.headers.map(item => [item.key, item.value]));
    const csp = values.get('Content-Security-Policy') ?? '';
    expect(config.headers[0]!.source).toBe('/(.*)');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(values.get('X-Content-Type-Options')).toBe('nosniff');
    expect(values.get('Referrer-Policy')).toBe('no-referrer');
    expect(values.get('Permissions-Policy')).toContain('camera=()');
  });

  it('allows only the exact embedded FlashForge bridge script in its opaque sandbox', () => {
    const html = readFileSync(new URL('../public/flashforge/index.html', import.meta.url), 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const csp = new Map(config.headers[0]!.headers.map(item => [item.key, item.value])).get('Content-Security-Policy') ?? '';
    expect(script).toContain('FLASH_LOAN_READY');
    expect(script).toContain('new URL(location.href).origin');
    expect(script).not.toContain('document.referrer');
    expect(csp).toContain(`'sha256-${createHash('sha256').update(script!).digest('base64')}'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
