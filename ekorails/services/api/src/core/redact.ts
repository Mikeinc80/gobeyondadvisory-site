/**
 * Redaction.
 *
 * Everything that leaves this process as a log line, an audit payload, an integration
 * event or an error message passes through here first. The brief's rule is absolute:
 * never log passwords, tokens, complete identification numbers, full bank credentials,
 * private keys or unmasked sensitive documents.
 *
 * The implementation is deny-by-key-name plus deny-by-value-shape. Key matching alone
 * fails the moment someone nests a secret under an unexpected name, so values that
 * *look* like credentials are caught regardless of where they sit.
 */

export const REDACTED = '[REDACTED]';

/** Key names whose values never leave the process, at any nesting depth. */
const DENIED_KEY_PATTERNS: RegExp[] = [
  /pass(word|phrase)/i,
  /secret/i,
  /token/i,
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /\bpin\b/i,
  /csrf/i,
  /mfa[_-]?secret/i,
  /recovery[_-]?code/i,
  /session[_-]?id$/i,
  /credential/i,
  /^otp$/i,
  /signature/i,
];

/** Key names that are masked to a display fragment rather than removed entirely. */
const MASKED_KEY_PATTERNS: RegExp[] = [
  /account[_-]?number/i,
  /^iban$/i,
  /^nuban$/i,
  /identifier$/i,
  /id[_-]?number/i,
  /tax[_-]?identification/i,
  /passport/i,
  /national[_-]?id/i,
  /^bvn$/i,
  /^nin$/i,
];

/** Values that look like credentials regardless of the key they arrived under. */
const DENIED_VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,   // JWT
  /^Bearer\s+\S{16,}/i,
  /^Basic\s+[A-Za-z0-9+/=]{16,}/i,
];

const MAX_DEPTH = 12;
const MAX_STRING = 4096;

/** Masks a value to its last four characters: 4111********1111 -> ****1111. */
export function maskTail(value: string, keep = 4): string {
  const s = String(value);
  if (s.length <= keep) return '*'.repeat(s.length);
  return '*'.repeat(Math.min(s.length - keep, 12)) + s.slice(-keep);
}

/** Masks an email to a shape that is still recognisable but not a contactable address. */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return maskTail(value);
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const head = local.slice(0, 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot === -1 ? '' : domain.slice(dot);
  return `${head}${'*'.repeat(Math.max(local.length - 1, 1))}@${'*'.repeat(Math.max(dot, 1))}${tld}`;
}

function keyIsDenied(key: string): boolean {
  return DENIED_KEY_PATTERNS.some((p) => p.test(key));
}

function keyIsMasked(key: string): boolean {
  return MASKED_KEY_PATTERNS.some((p) => p.test(key));
}

function valueIsDenied(value: string): boolean {
  return DENIED_VALUE_PATTERNS.some((p) => p.test(value));
}

/**
 * Returns a structurally identical copy with sensitive content removed or masked.
 * Never mutates the input.
 */
export function redact(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    if (valueIsDenied(input)) return REDACTED;
    return input.length > MAX_STRING ? input.slice(0, MAX_STRING) + '…[TRUNCATED]' : input;
  }
  if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
    return typeof input === 'bigint' ? input.toString() : input;
  }
  if (input instanceof Date) return input.toISOString();
  if (input instanceof Error) {
    return { name: input.name, message: redact(input.message, depth + 1) };
  }
  if (Array.isArray(input)) {
    return input.slice(0, 200).map((v) => redact(v, depth + 1));
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (keyIsDenied(key)) {
        out[key] = REDACTED;
      } else if (keyIsMasked(key)) {
        out[key] = typeof value === 'string' || typeof value === 'number'
          ? maskTail(String(value))
          : REDACTED;
      } else if (/email/i.test(key) && typeof value === 'string') {
        out[key] = maskEmail(value);
      } else {
        out[key] = redact(value, depth + 1);
      }
    }
    return out;
  }
  return '[UNSERIALISABLE]';
}

/**
 * Removes structures that are positively identifiable as safe before leak scanning.
 *
 * Without this the "long digit run" heuristic fires on every monetary amount and on any
 * hash that happens to contain ten consecutive digits — and a detector that cries wolf on
 * `5000000000.000000` is a detector nobody will keep running. Each exclusion below is a
 * value whose shape we can positively recognise, not a general loosening of the check.
 */
function stripKnownSafeStructures(input: string): string {
  return input
    // SHA-256 / SHA-1 hex digests. Not personal data and not credentials.
    .replace(/\b[0-9a-f]{40}\b/gi, 'HEX40')
    .replace(/\b[0-9a-f]{64}\b/gi, 'HEX64')
    // UUIDs.
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'UUID')
    // Fixed-precision monetary amounts, which always carry a decimal point in this system.
    .replace(/\b\d+\.\d{1,18}\b/g, 'AMOUNT')
    // ISO timestamps.
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?\b/g, 'TIMESTAMP')
    // Already-masked fragments, e.g. ****1111.
    .replace(/\*{2,}\d{0,6}/g, 'MASKED');
}

/**
 * Test helper and CI guard: scans a serialised payload for anything that should
 * never have survived redaction. Used by the "PII in logs" test case.
 */
export function findLeaks(rawInput: string): string[] {
  const serialised = stripKnownSafeStructures(rawInput);
  const leaks: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
    ['bearer token', /Bearer\s+\S{16,}/i],
    ['scrypt hash', /\$?scrypt[$:]/i],
    // A 10-digit Nigerian NUBAN or a 16-digit card-like run of digits.
    ['unmasked long account identifier', /(?<![\d*.\-])\d{10,19}(?![\d*.\-])/],
    ['IBAN', /\b[A-Z]{2}\d{2}[A-Z0-9]{12,30}\b/],
    ['password field with a value', /"pass(word|phrase)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i],
    ['token field with a value', /"[a-z_]*token"\s*:\s*"(?!\[REDACTED\])[^"]{8,}"/i],
    ['secret field with a value', /"[a-z_]*secret[a-z_]*"\s*:\s*"(?!\[REDACTED\])[^"]{8,}"/i],
  ];
  for (const [label, pattern] of checks) {
    if (pattern.test(serialised)) leaks.push(label);
  }
  return leaks;
}
