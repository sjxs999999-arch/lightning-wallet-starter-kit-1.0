import { createPublicKey, verify as verifySignature } from 'node:crypto';

const MASK_64 = (1n << 64n) - 1n;
const KECCAK_RATE = 136;
const ROTATION = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

function rotate64(value: bigint, shift: number) {
  if (shift === 0) return value & MASK_64;
  const amount = BigInt(shift);
  return ((value << amount) | (value >> (64n - amount))) & MASK_64;
}

function keccakPermutation(state: bigint[]) {
  for (const roundConstant of ROUND_CONSTANTS) {
    const columns = new Array<bigint>(5).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) columns[x] = columns[x]! ^ state[x + 5 * y]!;
    }
    for (let x = 0; x < 5; x++) {
      const delta = columns[(x + 4) % 5]! ^ rotate64(columns[(x + 1) % 5]!, 1);
      for (let y = 0; y < 5; y++) state[x + 5 * y] = state[x + 5 * y]! ^ delta;
    }

    const rotated = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const newX = y;
        const newY = (2 * x + 3 * y) % 5;
        rotated[newX + 5 * newY] = rotate64(state[x + 5 * y]!, ROTATION[x + 5 * y]!);
      }
    }

    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const index = x + 5 * y;
        state[index] = rotated[index]! ^ ((~rotated[(x + 1) % 5 + 5 * y]! & MASK_64) & rotated[(x + 2) % 5 + 5 * y]!);
      }
    }
    state[0] = state[0]! ^ roundConstant;
  }
}

export function keccak256(input: Uint8Array) {
  const state = new Array<bigint>(25).fill(0n);
  const blockCount = Math.ceil((input.length + 1) / KECCAK_RATE);
  const padded = new Uint8Array(blockCount * KECCAK_RATE);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] = padded[padded.length - 1]! | 0x80;
  for (let offset = 0; offset < padded.length; offset += KECCAK_RATE) {
    for (let index = 0; index < KECCAK_RATE; index++) {
      state[Math.floor(index / 8)] = state[Math.floor(index / 8)]! ^ (BigInt(padded[offset + index]!) << BigInt((index % 8) * 8));
    }
    keccakPermutation(state);
  }
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index++) output[index] = Number((state[Math.floor(index / 8)]! >> BigInt((index % 8) * 8)) & 0xffn);
  return output;
}

const SECP_P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const SECP_G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};
type Point = { x: bigint; y: bigint } | null;

const mod = (value: bigint, modulus: bigint) => ((value % modulus) + modulus) % modulus;
function modPow(base: bigint, exponent: bigint, modulus: bigint) {
  let value = mod(base, modulus);
  let power = exponent;
  let result = 1n;
  while (power > 0n) {
    if (power & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    power >>= 1n;
  }
  return result;
}
function inverse(value: bigint, modulus: bigint) {
  if (mod(value, modulus) === 0n) throw new Error('INVALID_SIGNATURE');
  return modPow(mod(value, modulus), modulus - 2n, modulus);
}
function pointAdd(left: Point, right: Point): Point {
  if (!left) return right;
  if (!right) return left;
  if (left.x === right.x && mod(left.y + right.y, SECP_P) === 0n) return null;
  const slope = left.x === right.x && left.y === right.y
    ? mod(3n * left.x * left.x * inverse(2n * left.y, SECP_P), SECP_P)
    : mod((right.y - left.y) * inverse(right.x - left.x, SECP_P), SECP_P);
  const x = mod(slope * slope - left.x - right.x, SECP_P);
  return { x, y: mod(slope * (left.x - x) - left.y, SECP_P) };
}
function scalarMultiply(scalar: bigint, point: Point): Point {
  let multiple = point;
  let result: Point = null;
  let value = mod(scalar, SECP_N);
  while (value > 0n) {
    if (value & 1n) result = pointAdd(result, multiple);
    multiple = pointAdd(multiple, multiple);
    value >>= 1n;
  }
  return result;
}
function bytesToBigInt(value: Uint8Array) {
  let result = 0n;
  for (const byte of value) result = (result << 8n) | BigInt(byte);
  return result;
}
function bigIntBytes(value: bigint, length: number) {
  const output = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index--) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}
function hexBytes(value: string) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('INVALID_SIGNATURE');
  return Uint8Array.from(value.match(/.{2}/g)!, byte => Number.parseInt(byte, 16));
}
function concat(...values: Uint8Array[]) {
  const output = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of values) { output.set(value, offset); offset += value.length; }
  return output;
}

function recoverEthereumAddress(digest: Uint8Array, signature: string) {
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error('INVALID_SIGNATURE');
  const bytes = hexBytes(signature.slice(2));
  const r = bytesToBigInt(bytes.slice(0, 32));
  const s = bytesToBigInt(bytes.slice(32, 64));
  let recovery = bytes[64]!;
  if (recovery >= 27) recovery -= 27;
  if (r <= 0n || r >= SECP_N || s <= 0n || s >= SECP_N || recovery > 3) throw new Error('INVALID_SIGNATURE');
  const x = r + BigInt(recovery >> 1) * SECP_N;
  if (x >= SECP_P) throw new Error('INVALID_SIGNATURE');
  const alpha = mod(x * x * x + 7n, SECP_P);
  let y = modPow(alpha, (SECP_P + 1n) / 4n, SECP_P);
  if (mod(y * y, SECP_P) !== alpha) throw new Error('INVALID_SIGNATURE');
  if (Number(y & 1n) !== (recovery & 1)) y = SECP_P - y;
  const recoveredPoint: Point = { x, y };
  if (scalarMultiply(SECP_N, recoveredPoint) !== null) throw new Error('INVALID_SIGNATURE');
  const e = bytesToBigInt(digest);
  const publicKey = scalarMultiply(inverse(r, SECP_N), pointAdd(scalarMultiply(s, recoveredPoint), scalarMultiply(-e, SECP_G)));
  if (!publicKey) throw new Error('INVALID_SIGNATURE');
  const uncompressed = concat(bigIntBytes(publicKey.x, 32), bigIntBytes(publicKey.y, 32));
  return `0x${Buffer.from(keccak256(uncompressed).slice(-20)).toString('hex')}`;
}

export function verifyEvmPersonalSignature(address: string, message: string, signature: string) {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const prefix = new TextEncoder().encode(`\u0019Ethereum Signed Message:\n${messageBytes.length}`);
    return recoverEthereumAddress(keccak256(concat(prefix, messageBytes)), signature).toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
export function decodeBase58(value: string) {
  if (!value || value.length > 200) throw new Error('INVALID_BASE58');
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) throw new Error('INVALID_BASE58');
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) { bytes.push(Number(number & 0xffn)); number >>= 8n; }
  for (const character of value) { if (character === '1') bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

function strictBase64(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error('INVALID_BASE64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('INVALID_BASE64');
  return new Uint8Array(bytes);
}

function solanaSignatureBytes(value: string) {
  try {
    const decoded = decodeBase58(value);
    if (decoded.length === 64) return decoded;
  } catch { /* base64 is accepted below */ }
  const decoded = strictBase64(value);
  if (decoded.length !== 64) throw new Error('INVALID_SIGNATURE');
  return decoded;
}

export function verifySolanaSignature(address: string, message: string, signature: string) {
  try {
    const publicKey = decodeBase58(address);
    if (publicKey.length !== 32) return false;
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const key = createPublicKey({ key: Buffer.concat([derPrefix, publicKey]), format: 'der', type: 'spki' });
    return verifySignature(null, Buffer.from(message, 'utf8'), key, solanaSignatureBytes(signature));
  } catch {
    return false;
  }
}

export function decodeStrictBase64(value: string, minimumBytes: number, maximumBytes: number) {
  const decoded = strictBase64(value);
  if (decoded.length < minimumBytes || decoded.length > maximumBytes) throw new Error('INVALID_BASE64_LENGTH');
  return decoded;
}
