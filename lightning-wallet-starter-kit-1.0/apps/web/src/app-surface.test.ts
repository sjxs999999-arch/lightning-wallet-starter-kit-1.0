import { describe, expect, it } from 'vitest';
import { adminLoginUrl, resolveAppSurface } from './app-surface';

const clientPaths = new Set(['/', '/wallets', '/chat', '/batch-wallets', '/vanity']);

describe('application surface routing', () => {
  it('keeps the public domain client-only', () => {
    expect(resolveAppSurface({ hostname: 'lightingwallet.com', pathname: '/login', clientPaths })).toBe('client');
    expect(resolveAppSurface({ hostname: 'www.lightingwallet.com', pathname: '/dashboard', clientPaths })).toBe('client');
  });

  it('keeps the admin subdomain on the authenticated operator surface', () => {
    expect(resolveAppSurface({ hostname: 'admin.lightingwallet.com', pathname: '/wallets', clientPaths })).toBe('admin');
    expect(resolveAppSurface({ hostname: 'admin.lightingwallet.com', pathname: '/login', clientPaths })).toBe('admin');
  });

  it('supports local development and explicit preview overrides', () => {
    expect(resolveAppSurface({ hostname: 'localhost', pathname: '/wallets', clientPaths })).toBe('client');
    expect(resolveAppSurface({ hostname: 'localhost', pathname: '/dashboard', clientPaths })).toBe('admin');
    expect(resolveAppSurface({ hostname: 'preview.vercel.app', pathname: '/dashboard', clientPaths, override: 'admin' })).toBe('admin');
  });

  it('links production clients to the isolated admin hostname', () => {
    expect(adminLoginUrl('lightingwallet.com')).toBe('https://admin.lightingwallet.com/login');
    expect(adminLoginUrl('localhost')).toBe('/login');
  });
});
