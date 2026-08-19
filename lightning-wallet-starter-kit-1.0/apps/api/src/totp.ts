import { createHmac, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Bytes(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, '').replace(/[\s-]/g, '');
  if (!normalized || [...normalized].some(character => !ALPHABET.includes(character))) throw new Error('Invalid TOTP secret');
  let bits = '';
  for (const character of normalized) bits += ALPHABET.indexOf(character).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, timeMs = Date.now(), digits = 6): string {
  const counter = BigInt(Math.floor(timeMs / 30_000));
  const message = Buffer.alloc(8); message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', base32Bytes(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 15;
  const value = ((digest[offset]! & 127) << 24 | digest[offset + 1]! << 16 | digest[offset + 2]! << 8 | digest[offset + 3]!) % 10 ** digits;
  return value.toString().padStart(digits, '0');
}

export function verifyTotp(code: string | undefined, secret: string | undefined, timeMs = Date.now()): boolean {
  if (!secret) return true;
  if (!code || !/^\d{6}$/.test(code)) return false;
  const provided = Buffer.from(code);
  return [-1, 0, 1].some(window => timingSafeEqual(provided, Buffer.from(totpCode(secret, timeMs + window * 30_000))));
}
