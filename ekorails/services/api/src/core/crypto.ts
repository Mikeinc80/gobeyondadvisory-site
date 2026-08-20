/**
 * Cryptographic primitives.
 *
 * Uses only Node's built-in `crypto`. No third-party cryptography is pulled in: the
 * dependency surface of a settlement system is part of its attack surface, and every
 * primitive needed here is in the standard library.
 *
 * Field encryption is envelope-shaped: a data key is derived per key-id from the master
 * key, and each ciphertext records which key-id produced it so keys can be rotated
 * without a bulk re-encryption outage.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  hkdfSync,
} from 'node:crypto';

// scrypt parameters. N=32768 costs roughly 100ms per hash on commodity hardware,
// which is the point: it makes offline cracking expensive.
const SCRYPT_N = 32768;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_KEYLEN = 64;
const PASSWORD_ALGO = 'scrypt-n32768-r8-p1';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function masterKey(): Buffer {
  const raw = process.env['EKORAILS_MASTER_KEY'];
  if (raw && raw.length >= 32) return createHash('sha256').update(raw).digest();
  const mode = process.env['EKORAILS_ENV_MODE'];
  if (mode === 'PRODUCTION' || mode === 'CONTROLLED_PILOT') {
    throw new Error(
      'EKORAILS_MASTER_KEY is not set. Refusing to fall back to a development key outside ' +
      'DEMO/SANDBOX. In a real deployment this value comes from the secrets manager, never ' +
      'from source control.',
    );
  }
  // Development-only deterministic key. Clearly labelled so it cannot be mistaken for a
  // production secret, and unusable outside DEMO/SANDBOX by the check above.
  return createHash('sha256').update('EKORAILS-DEV-ONLY-NOT-A-SECRET').digest();
}

function fingerprintKey(): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey(), Buffer.alloc(0), Buffer.from('ekorails/fingerprint'), 32),
  );
}

function dataKey(keyId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey(), Buffer.alloc(0), Buffer.from(`ekorails/field/${keyId}`), 32),
  );
}

/**
 * Keyed fingerprint. Used where we need to detect that two records share a value (the
 * same bank account, the same identity document) without being able to recover the
 * value, and without allowing an offline dictionary attack over a small domain.
 */
export function fingerprint(value: string, domain: string): string {
  return createHmac('sha256', fingerprintKey())
    .update(domain).update(' ').update(value)
    .digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}

/** Constant-time comparison. Never use === on a secret. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still perform a comparison so the timing does not reveal the length mismatch.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize('NFKC'), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: 128 * SCRYPT_N * SCRYPT_r * 2,
  });
  return `${PASSWORD_ALGO}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== PASSWORD_ALGO) return false;
  const salt = Buffer.from(parts[1]!, 'base64');
  const expected = Buffer.from(parts[2]!, 'base64');
  const derived = scryptSync(password.normalize('NFKC'), salt, expected.length, {
    N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: 128 * SCRYPT_N * SCRYPT_r * 2,
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Password policy. Length is weighted far above composition rules, in line with
 * current guidance: a long passphrase beats a short string with a symbol in it.
 */
export interface PasswordPolicyResult {
  acceptable: boolean;
  failures: string[];
}

export function checkPasswordPolicy(
  password: string,
  context: { email?: string; fullName?: string } = {},
): PasswordPolicyResult {
  const failures: string[] = [];
  if (password.length < 12) failures.push('Must be at least 12 characters long.');
  if (password.length > 256) failures.push('Must be at most 256 characters long.');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    failures.push('Must contain both lower-case and upper-case letters.');
  }
  if (!/\d/.test(password)) failures.push('Must contain at least one digit.');
  if (/^(.)\1+$/.test(password)) failures.push('Must not be a single repeated character.');

  const lowered = password.toLowerCase();
  const localPart = context.email ? context.email.split('@')[0]!.toLowerCase() : '';
  if (localPart.length >= 4 && lowered.includes(localPart)) {
    failures.push('Must not contain your email address.');
  }
  for (const part of (context.fullName ?? '').toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lowered.includes(part)) {
      failures.push('Must not contain your name.');
      break;
    }
  }
  const banned = [
    'password', 'passw0rd', 'qwerty', 'letmein', '123456', 'admin123',
    'welcome1', 'ekorails', 'settlement', 'changeme',
  ];
  if (banned.some((b) => lowered.includes(b))) {
    failures.push('Must not contain a commonly used or guessable word.');
  }
  return { acceptable: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// Field-level encryption (AES-256-GCM)
// ---------------------------------------------------------------------------

export const CURRENT_KEY_ID = 'k1';

/** Returns `v1.<keyId>.<iv>.<tag>.<ciphertext>`, each segment base64url. */
export function encryptField(plaintext: string, keyId: string = CURRENT_KEY_ID): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey(keyId), iv);
  // The key id is authenticated, so a ciphertext cannot be replayed under another key.
  cipher.setAAD(Buffer.from(keyId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1', keyId,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptField(encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') {
    throw new Error('Malformed encrypted field');
  }
  const [, keyId, ivB64, tagB64, ctB64] = parts as [string, string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', dataKey(keyId), Buffer.from(ivB64, 'base64url'));
  decipher.setAAD(Buffer.from(keyId, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) - implemented directly so MFA carries no third-party dependency
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCodeForStep(secretBase32: string, step: number): string {
  const key = base32Decode(secretBase32);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

export interface TotpVerification {
  valid: boolean;
  /** The step that matched. Stored so the same code cannot be replayed. */
  step: number | null;
  reason?: string;
}

/**
 * Verifies a TOTP code with a one-step window either side for clock drift, and refuses
 * any step at or below `lastUsedStep`. Without that refusal an attacker who observes a
 * code has a full period in which to reuse it.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  lastUsedStep: number | null,
  atMs: number = Date.now(),
): TotpVerification {
  const normalised = code.replace(/\D/g, '');
  if (normalised.length !== TOTP_DIGITS) return { valid: false, step: null, reason: 'malformed' };
  const current = totpStep(atMs);
  for (const step of [current, current - 1, current + 1]) {
    if (safeEqual(totpCodeForStep(secretBase32, step), normalised)) {
      if (lastUsedStep !== null && step <= lastUsedStep) {
        return { valid: false, step, reason: 'replayed' };
      }
      return { valid: true, step };
    }
  }
  return { valid: false, step: null, reason: 'mismatch' };
}

export function totpProvisioningUri(secretBase32: string, account: string, issuer = 'EKORails'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** Signs an outbound webhook payload. Receivers verify with the shared secret. */
export function signPayload(payload: string, secret: string, timestamp: number): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** Short-lived signed URL for document download. Every mint is audited by the caller. */
export function signStorageUrl(storageKey: string, expiresAtMs: number): string {
  const sig = createHmac('sha256', masterKey())
    .update(`${storageKey}.${expiresAtMs}`).digest('base64url');
  return `${storageKey}?expires=${expiresAtMs}&sig=${sig}`;
}

export function verifyStorageUrl(storageKey: string, expiresAtMs: number, signature: string): boolean {
  if (Date.now() > expiresAtMs) return false;
  const expected = createHmac('sha256', masterKey())
    .update(`${storageKey}.${expiresAtMs}`).digest('base64url');
  return safeEqual(expected, signature);
}

/**
 * Canonical JSON: stable key ordering so that a hash over a payload is reproducible.
 * Used for idempotency request hashes and for the compliance engine's input hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',') + '}';
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
