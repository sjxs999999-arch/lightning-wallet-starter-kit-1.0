import { describe, expect, it } from 'vitest';
import { clearLoginAttempts, consumeLoginAttempt, newSessionId, opaqueHash, operatorSessionIsActive, sessionHash, type SecurityStore } from './operator-security.js';

function store(rows: Record<string, unknown>[] = []): SecurityStore & { calls: { text: string; values?: unknown[] }[] } {
  const calls: { text: string; values?: unknown[] }[] = [];
  return { calls, async query(text, values) { calls.push({ text, values }); return { rows }; } };
}

describe('operator security', () => {
  it('uses opaque fixed-length identifiers for sessions and networks', () => {
    expect(newSessionId()).toMatch(/^[a-f0-9]{64}$/);
    expect(opaqueHash('network')).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionHash({ jti: 'secret-session-id' })).toBe(opaqueHash('secret-session-id'));
  });

  it('enforces the tenth persistent login attempt boundary', async () => {
    expect(await consumeLoginAttempt(store([{ attempts: 10 }]), 'network', 'OPS@EXAMPLE.COM')).toEqual({ allowed: true, attempts: 10 });
    expect(await consumeLoginAttempt(store([{ attempts: 11 }]), 'network', 'ops@example.com')).toEqual({ allowed: false, attempts: 11 });
  });

  it('never stores a raw network identifier in rate-limit calls', async () => {
    const db = store();
    await clearLoginAttempts(db, '203.0.113.4', 'ops@example.com');
    expect(db.calls[0]?.values?.[0]).not.toContain('203.0.113.4');
    expect(db.calls[0]?.values?.[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('requires a live non-revoked database session', async () => {
    const claims = { sub: 'ops@example.com', role: 'operator' as const, jti: 'session' };
    expect(await operatorSessionIsActive(store([{ '?column?': 1 }]), claims)).toBe(true);
    expect(await operatorSessionIsActive(store(), claims)).toBe(false);
    expect(await operatorSessionIsActive(store([{ '?column?': 1 }]), { ...claims, jti: '' })).toBe(false);
  });
});
