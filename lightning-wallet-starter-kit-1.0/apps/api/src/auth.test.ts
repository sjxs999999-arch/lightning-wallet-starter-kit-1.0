import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { apiRouteRequiresAuth, clearSessionCookie, csrfRequestAllowed, readSessionCookie, sessionCookie, verifyOperatorCredentials } from './auth.js';

function encoded(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 32).toString('hex')}`;
}

describe('operator credentials', () => {
  it('accepts only the configured email and password', () => {
    const hash = encoded('a-strong-production-password');
    expect(verifyOperatorCredentials('ops@example.com', 'a-strong-production-password', 'ops@example.com', hash)).toBe(true);
    expect(verifyOperatorCredentials('attacker@example.com', 'a-strong-production-password', 'ops@example.com', hash)).toBe(false);
    expect(verifyOperatorCredentials('ops@example.com', 'wrong-password', 'ops@example.com', hash)).toBe(false);
  });

  it('rejects malformed hashes', () => {
    expect(verifyOperatorCredentials('ops@example.com', 'password', 'ops@example.com', 'invalid')).toBe(false);
  });

  it('serializes production sessions as host-only HttpOnly cookies', () => {
    const value = sessionCookie('header.payload.signature', true, 300);
    expect(value).toContain('__Host-lightning-session=header.payload.signature');
    expect(value).toContain('Path=/');
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Strict');
    expect(value).toContain('Secure');
    expect(value).toContain('Max-Age=300');
    expect(value).not.toMatch(/Domain=/i);
    expect(readSessionCookie(`theme=dark; ${value}`, true)).toBe('header.payload.signature');
    expect(clearSessionCookie(true)).toContain('Max-Age=0');
  });

  it('allows safe reads and protects state-changing requests', () => {
    expect(csrfRequestAllowed({ method: 'GET' })).toBe(true);
    expect(csrfRequestAllowed({ method: 'POST', csrfHeader: '1' })).toBe(true);
    expect(csrfRequestAllowed({ method: 'PATCH', origin: 'https://lightning-wallet.vercel.app', host: 'lightning-wallet.vercel.app' })).toBe(true);
    expect(csrfRequestAllowed({ method: 'POST', origin: 'https://attacker.example', host: 'lightning-wallet.vercel.app' })).toBe(false);
    expect(csrfRequestAllowed({ method: 'DELETE' })).toBe(false);
  });

  it('defaults API routes to authenticated and keeps a narrow public allowlist', () => {
    expect(apiRouteRequiresAuth('GET', '/health')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/auth/login')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/errors/report')).toBe(false);
    expect(apiRouteRequiresAuth('GET', '/api/v1/errors/reports')).toBe(true);
    expect(apiRouteRequiresAuth('GET', '/api/v1/chains')).toBe(false);
    expect(apiRouteRequiresAuth('GET', '/api/v1/solana/latest-blockhash')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/swap/quotes')).toBe(false);
    expect(apiRouteRequiresAuth('GET', '/api/v1/swap/status')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/swap/solana-transaction')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/integrations/flash-loan/session')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/gasfree/estimate')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/gasfree/sponsor')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/launchpad/validate')).toBe(false);
    expect(apiRouteRequiresAuth('GET', '/api/v1/projects')).toBe(false);
    expect(apiRouteRequiresAuth('GET', '/api/v1/projects/project-id')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/projects')).toBe(true);
    expect(apiRouteRequiresAuth('GET', '/api/v1/market/search?q=solana')).toBe(false);
    expect(apiRouteRequiresAuth('GET', '/api/v1/system/capabilities')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/bridge/quotes')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/risk/token')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/lp/positions')).toBe(false);
    expect(apiRouteRequiresAuth('POST', '/api/v1/solana/send-signed-batch')).toBe(true);
    expect(apiRouteRequiresAuth('GET', '/api/v1/integrations/flash-loan')).toBe(true);
    expect(apiRouteRequiresAuth('POST', '/api/v1/future-sensitive-route')).toBe(true);
  });
});
