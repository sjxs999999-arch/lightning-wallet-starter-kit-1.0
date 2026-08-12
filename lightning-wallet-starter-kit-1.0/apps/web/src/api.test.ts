import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SESSION_EXPIRED_EVENT, api, secureRequestInit, takeLegacySessionToken } from './api';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
} });

describe('secure API requests', () => {
  beforeEach(() => values.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('uses browser-managed credentials and protects writes without bearer tokens', () => {
    const options = secureRequestInit({ method: 'POST', body: '{}' });
    const headers = options.headers as Headers;
    expect(options.credentials).toBe('include');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-lightning-csrf')).toBe('1');
    expect(headers.has('authorization')).toBe(false);
  });

  it('does not add mutation headers to safe reads', () => {
    const options = secureRequestInit();
    const headers = options.headers as Headers;
    expect(options.credentials).toBe('include');
    expect(headers.has('x-lightning-csrf')).toBe(false);
    expect(headers.has('content-type')).toBe(false);
  });

  it('takes and immediately removes a legacy browser-readable session', () => {
    localStorage.setItem('lightning-session', 'legacy-token');
    expect(takeLegacySessionToken()).toBe('legacy-token');
    expect(localStorage.getItem('lightning-session')).toBeNull();
  });

  it('emits a global session-expired event for protected 401 responses', async () => {
    const browser = new EventTarget();
    const expired = vi.fn();
    browser.addEventListener(SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal('window', browser);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'SESSION_REVOKED' }), { status: 401, headers: { 'content-type': 'application/json' } })));
    const error = await api('/dashboard').catch(cause => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
    expect(expired).toHaveBeenCalledOnce();
  });

  it('does not surface untrusted server error text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid code', message: 'privateKey=must-not-surface' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    const error = await api('/system/capabilities').catch(cause => cause);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw new Error('expected ApiError');
    expect(error).toMatchObject({ status: 503, code: 'HTTP_503' });
    expect(error.message).not.toContain('must-not-surface');
  });
});
