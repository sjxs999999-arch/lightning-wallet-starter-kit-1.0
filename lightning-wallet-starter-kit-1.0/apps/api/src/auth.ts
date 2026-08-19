import { scryptSync, timingSafeEqual } from 'node:crypto';

const HASH_BYTES = 32;
const PROD_SESSION_COOKIE = '__Host-lightning-session';
const DEV_SESSION_COOKIE = 'lightning-session';

export function sessionCookieName(production: boolean): string {
  return production ? PROD_SESSION_COOKIE : DEV_SESSION_COOKIE;
}

export function readSessionCookie(cookieHeader: string | undefined, production: boolean): string {
  const name = sessionCookieName(production);
  for (const part of (cookieHeader ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return ''; }
  }
  return '';
}

export function sessionCookie(token: string, production: boolean, maxAgeSeconds = 8 * 60 * 60): string {
  const secure = production ? '; Secure' : '';
  return `${sessionCookieName(production)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(production: boolean): string {
  const secure = production ? '; Secure' : '';
  return `${sessionCookieName(production)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

export function isStateChangingRequest(method: string | undefined): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes((method ?? 'GET').toUpperCase());
}

export function csrfRequestAllowed(input: { method?: string; csrfHeader?: string; origin?: string; host?: string }): boolean {
  if (!isStateChangingRequest(input.method)) return true;
  if (input.csrfHeader === '1') return true;
  if (!input.origin || !input.host) return false;
  try { return new URL(input.origin).host === input.host; }
  catch { return false; }
}

const PUBLIC_API_ROUTES = new Set([
  'GET chains',
  'GET solana/latest-blockhash',
  'GET gasfree/status',
  'GET swap/status',
  'GET integrations/flash-loan/health',
  'GET projects',
  'GET market/search',
  'GET market/token',
  'GET market/history',
  'GET market/trades',
  'GET system/capabilities',
  'POST swap/quotes',
  'POST swap/solana-transaction',
  'POST integrations/flash-loan/session',
  'POST gasfree/estimate',
  'POST gasfree/sponsor',
  'POST launchpad/validate',
  'POST bridge/quotes',
  'POST risk/token',
  'POST lp/positions',
  'POST auth/login',
  'POST wallets/batch-generate',
  'POST collections/plan',
]);

export function apiRouteRequiresAuth(method: string | undefined, requestUrl: string): boolean {
  const path = new URL(requestUrl, 'http://lightning.local').pathname;
  if (!path.startsWith('/api/v1/')) return false;
  const route = path.slice('/api/v1/'.length).replace(/^\/+|\/+$/g, '');
  if ((method ?? 'GET').toUpperCase() === 'OPTIONS') return false;
  const normalizedMethod = (method ?? 'GET').toUpperCase();
  if (normalizedMethod === 'GET' && /^projects\/[^/]+$/.test(route)) return false;
  return !PUBLIC_API_ROUTES.has(`${normalizedMethod} ${route}`);
}

export function verifyOperatorCredentials(
  email: string,
  password: string,
  expectedEmail: string,
  encodedHash: string,
): boolean {
  const [scheme, saltHex, digestHex, extra] = encodedHash.split('$');
  if (scheme !== 'scrypt' || extra !== undefined) return false;
  if (!/^[a-f0-9]{32}$/i.test(saltHex ?? '') || !/^[a-f0-9]{64}$/i.test(digestHex ?? '')) return false;

  const emailMatches = email.trim().toLowerCase() === expectedEmail.trim().toLowerCase();
  const expected = Buffer.from(digestHex!, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex!, 'hex'), HASH_BYTES);
  return emailMatches && timingSafeEqual(actual, expected);
}
