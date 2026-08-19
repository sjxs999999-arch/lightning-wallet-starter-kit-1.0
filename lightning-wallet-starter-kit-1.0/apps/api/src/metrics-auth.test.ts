import { describe, expect, it } from 'vitest';
import { metricsAuthorizationValid } from './metrics-auth.js';

describe('metrics authorization', () => {
  const token = 'metrics-secret-with-at-least-32-characters';

  it('accepts only the exact bearer token', () => {
    expect(metricsAuthorizationValid(`Bearer ${token}`, token)).toBe(true);
    expect(metricsAuthorizationValid(`Bearer ${token}-wrong`, token)).toBe(false);
    expect(metricsAuthorizationValid(token, token)).toBe(false);
  });

  it('fails closed when the production token is missing', () => {
    expect(metricsAuthorizationValid(undefined, undefined)).toBe(false);
    expect(metricsAuthorizationValid('Bearer anything', undefined)).toBe(false);
  });
});
