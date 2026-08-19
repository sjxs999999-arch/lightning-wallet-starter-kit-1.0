import { createHash, randomBytes } from 'node:crypto';

export interface SecurityStore {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export type OperatorClaims = { sub: string; role: 'operator'; jti: string; iat?: number; exp?: number };

export function opaqueHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sessionHash(claims: Pick<OperatorClaims, 'jti'>): string {
  return opaqueHash(claims.jti);
}

export function newSessionId(): string {
  return randomBytes(32).toString('hex');
}

export async function consumeLoginAttempt(db: SecurityStore, networkId: string, email: string): Promise<{ allowed: boolean; attempts: number }> {
  const bucket = opaqueHash(`${networkId}:${email.trim().toLowerCase()}`);
  const result = await db.query("INSERT INTO auth_rate_limits(bucket,attempts,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.reset_at<now() THEN 1 ELSE auth_rate_limits.attempts+1 END,reset_at=CASE WHEN auth_rate_limits.reset_at<now() THEN now()+interval '15 minutes' ELSE auth_rate_limits.reset_at END,updated_at=now() RETURNING attempts", [bucket]);
  const attempts = Number(result.rows[0]?.attempts ?? 1);
  return { allowed: attempts <= 10, attempts };
}

export async function clearLoginAttempts(db: SecurityStore, networkId: string, email: string): Promise<void> {
  await db.query('DELETE FROM auth_rate_limits WHERE bucket=$1', [opaqueHash(`${networkId}:${email.trim().toLowerCase()}`)]);
}

export async function createOperatorSession(db: SecurityStore, input: { claims: OperatorClaims; networkId: string; userAgent: string }): Promise<void> {
  await db.query('INSERT INTO auth_sessions(session_hash,email,ip_hash,user_agent,expires_at) VALUES($1,$2,$3,$4,to_timestamp($5))', [sessionHash(input.claims), input.claims.sub, opaqueHash(input.networkId || 'unknown'), input.userAgent.slice(0, 300), input.claims.exp]);
}

export async function operatorSessionIsActive(db: SecurityStore, claims: OperatorClaims): Promise<boolean> {
  if (!claims.jti || claims.role !== 'operator') return false;
  const result = await db.query('SELECT 1 FROM auth_sessions WHERE session_hash=$1 AND revoked_at IS NULL AND expires_at>now() LIMIT 1', [sessionHash(claims)]);
  return Boolean(result.rows[0]);
}

export async function revokeOperatorSession(db: SecurityStore, claims: OperatorClaims): Promise<void> {
  await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE session_hash=$1', [sessionHash(claims)]);
}

export async function revokeOtherOperatorSessions(db: SecurityStore, claims: OperatorClaims): Promise<number> {
  const result = await db.query('UPDATE auth_sessions SET revoked_at=now() WHERE email=$1 AND session_hash<>$2 AND revoked_at IS NULL AND expires_at>now() RETURNING session_hash', [claims.sub, sessionHash(claims)]);
  return result.rows.length;
}

export async function recordSecurityEvent(db: SecurityStore, action: string, resourceId: string, detail: Record<string, unknown>): Promise<void> {
  await db.query('INSERT INTO audit_logs(action,resource_type,resource_id,detail) VALUES($1,$2,$3,$4)', [action, 'session', resourceId.slice(0, 64), detail]);
}

export async function operatorSecurityOverview(db: SecurityStore, claims: OperatorClaims) {
  const [sessions, failures, events] = await Promise.all([
    db.query('SELECT count(*)::int AS count FROM auth_sessions WHERE email=$1 AND revoked_at IS NULL AND expires_at>now()', [claims.sub]),
    db.query("SELECT count(*)::int AS count FROM audit_logs WHERE action='auth.login.failed' AND created_at>now()-interval '24 hours'"),
    db.query('SELECT id,action,resource_type,resource_id,detail,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 50'),
  ]);
  return {
    currentSession: { email: claims.sub, createdAt: new Date(Number(claims.iat) * 1000).toISOString(), expiresAt: new Date(Number(claims.exp) * 1000).toISOString() },
    activeSessions: Number(sessions.rows[0]?.count ?? 0),
    failedLogins24h: Number(failures.rows[0]?.count ?? 0),
    policies: { sessionHours: 8, loginAttempts: 10, rateLimitMinutes: 15, clientKeyIsolation: true, serverSigning: false, mainnetBroadcast: false, httpOnlySession: true, csrfProtection: true, defaultDenyApi: true, contentSecurityPolicy: true, metadataOnlyDiagnostics: true, automaticSessionRecovery: true, workerOnlyExportValidation: true, zeroizedKeyBuffers: true },
    events: events.rows,
  };
}
