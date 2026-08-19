import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { verifyTotp } from './totp.js';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface MfaStore {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

type StoredMfa = {
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  recovery_code_hashes?: unknown;
  enabled?: unknown;
};

function encryptionKey(encoded: string | undefined): Buffer | null {
  if (!encoded) return null;
  const value = encoded.trim();
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  return key.length === 32 ? key : null;
}

export function validMfaEncryptionKey(encoded: string | undefined): boolean {
  return !encoded || Boolean(encryptionKey(encoded));
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let offset = 0; offset < bits.length; offset += 5) {
    result += BASE32[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, '0'), 2)];
  }
  return result;
}

export function generateMfaSecret(): string {
  return base32Encode(randomBytes(20));
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(12);
    const raw = Array.from(bytes, byte => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join('');
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export function recoveryCodeHash(code: string, encodedKey: string): string {
  const key = encryptionKey(encodedKey);
  if (!key) throw new Error('MFA_KEY_UNAVAILABLE');
  return createHmac('sha256', key).update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
}

export function encryptMfaSecret(secret: string, encodedKey: string): { ciphertext: string; iv: string; tag: string } {
  const key = encryptionKey(encodedKey);
  if (!key) throw new Error('MFA_KEY_UNAVAILABLE');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptMfaSecret(value: { ciphertext: string; iv: string; tag: string }, encodedKey: string): string {
  const key = encryptionKey(encodedKey);
  if (!key) throw new Error('MFA_KEY_UNAVAILABLE');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function secretFromRow(row: StoredMfa, encodedKey: string): string {
  return decryptMfaSecret({ ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag }, encodedKey);
}

function recoveryHashes(row: StoredMfa): string[] {
  return Array.isArray(row.recovery_code_hashes) ? row.recovery_code_hashes.filter(value => typeof value === 'string') : [];
}

export async function ensureOperatorMfaSchema(db: MfaStore): Promise<void> {
  await db.query("CREATE TABLE IF NOT EXISTS operator_mfa (email text PRIMARY KEY, secret_ciphertext text NOT NULL, secret_iv text NOT NULL, secret_tag text NOT NULL, recovery_code_hashes jsonb NOT NULL DEFAULT '[]', enabled boolean NOT NULL DEFAULT false, pending_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())");
}

export async function operatorMfaStatus(db: MfaStore, email: string, encodedKey?: string, legacySecret?: string) {
  if (legacySecret) return { enabled: true, manageable: false, recoveryCodesRemaining: 0, source: 'environment' as const };
  const result = await db.query('SELECT enabled,recovery_code_hashes FROM operator_mfa WHERE email=$1 LIMIT 1', [email]);
  const row = result.rows[0] as StoredMfa | undefined;
  return {
    enabled: Boolean(row?.enabled),
    manageable: Boolean(encryptionKey(encodedKey)),
    recoveryCodesRemaining: row?.enabled ? recoveryHashes(row).length : 0,
    source: row?.enabled ? 'database' as const : 'none' as const,
  };
}

export async function beginMfaEnrollment(db: MfaStore, email: string, encodedKey: string | undefined, now = new Date()) {
  if (!encryptionKey(encodedKey)) throw new Error('MFA_KEY_UNAVAILABLE');
  const secret = generateMfaSecret();
  const encrypted = encryptMfaSecret(secret, encodedKey!);
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  const result = await db.query("INSERT INTO operator_mfa(email,secret_ciphertext,secret_iv,secret_tag,recovery_code_hashes,enabled,pending_expires_at) VALUES($1,$2,$3,$4,'[]',false,$5) ON CONFLICT(email) DO UPDATE SET secret_ciphertext=excluded.secret_ciphertext,secret_iv=excluded.secret_iv,secret_tag=excluded.secret_tag,recovery_code_hashes='[]',pending_expires_at=excluded.pending_expires_at,updated_at=now() WHERE operator_mfa.enabled=false RETURNING email", [email, encrypted.ciphertext, encrypted.iv, encrypted.tag, expiresAt]);
  if (!result.rows[0]) throw new Error('MFA_ALREADY_ENABLED');
  const label = encodeURIComponent(email);
  const issuer = encodeURIComponent('Lightning Wallet');
  return { secret, otpauthUri: `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`, expiresAt: expiresAt.toISOString() };
}

export async function confirmMfaEnrollment(db: MfaStore, email: string, code: string, encodedKey: string | undefined, timeMs = Date.now()) {
  if (!encryptionKey(encodedKey)) throw new Error('MFA_KEY_UNAVAILABLE');
  const result = await db.query('SELECT secret_ciphertext,secret_iv,secret_tag FROM operator_mfa WHERE email=$1 AND enabled=false AND pending_expires_at>now() LIMIT 1', [email]);
  const row = result.rows[0] as StoredMfa | undefined;
  if (!row) throw new Error('MFA_ENROLLMENT_EXPIRED');
  const secret = secretFromRow(row, encodedKey!);
  if (!verifyTotp(code, secret, timeMs)) throw new Error('MFA_CODE_INVALID');
  const codes = generateRecoveryCodes();
  const hashes = codes.map(value => recoveryCodeHash(value, encodedKey!));
  const updated = await db.query("UPDATE operator_mfa SET enabled=true,recovery_code_hashes=$2::jsonb,pending_expires_at=NULL,updated_at=now() WHERE email=$1 AND enabled=false RETURNING email", [email, JSON.stringify(hashes)]);
  if (!updated.rows[0]) throw new Error('MFA_ENROLLMENT_EXPIRED');
  return { enabled: true, recoveryCodes: codes };
}

export async function verifyOperatorMfa(db: MfaStore, input: { email: string; totpCode?: string; recoveryCode?: string; encodedKey?: string; legacySecret?: string; timeMs?: number }) {
  if (input.legacySecret) return { required: true, verified: verifyTotp(input.totpCode, input.legacySecret, input.timeMs), recoveryUsed: false };
  const result = await db.query('SELECT secret_ciphertext,secret_iv,secret_tag,recovery_code_hashes,enabled FROM operator_mfa WHERE email=$1 LIMIT 1', [input.email]);
  const row = result.rows[0] as StoredMfa | undefined;
  if (!row?.enabled) return { required: false, verified: true, recoveryUsed: false };
  if (!encryptionKey(input.encodedKey)) return { required: true, verified: false, recoveryUsed: false };
  if (input.totpCode) {
    const secret = secretFromRow(row, input.encodedKey!);
    return { required: true, verified: verifyTotp(input.totpCode, secret, input.timeMs), recoveryUsed: false };
  }
  if (input.recoveryCode) {
    const hash = recoveryCodeHash(input.recoveryCode, input.encodedKey!);
    const consumed = await db.query("UPDATE operator_mfa SET recovery_code_hashes=recovery_code_hashes-$2,updated_at=now() WHERE email=$1 AND enabled=true AND recovery_code_hashes ? $2 RETURNING email", [input.email, hash]);
    return { required: true, verified: Boolean(consumed.rows[0]), recoveryUsed: Boolean(consumed.rows[0]) };
  }
  return { required: true, verified: false, recoveryUsed: false };
}

export async function disableOperatorMfa(db: MfaStore, input: { email: string; totpCode?: string; recoveryCode?: string; encodedKey?: string; timeMs?: number }) {
  const verified = await verifyOperatorMfa(db, input);
  if (!verified.required) throw new Error('MFA_NOT_ENABLED');
  if (!verified.verified) throw new Error('MFA_CODE_INVALID');
  await db.query('DELETE FROM operator_mfa WHERE email=$1', [input.email]);
  return { disabled: true, recoveryUsed: verified.recoveryUsed };
}
