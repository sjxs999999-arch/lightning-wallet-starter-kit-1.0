import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

export function metricsAuthorizationValid(authorization: string | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken) return false;
  const prefix = 'Bearer ';
  if (!authorization?.startsWith(prefix)) return false;
  return timingSafeEqual(digest(authorization.slice(prefix.length)), digest(expectedToken));
}
