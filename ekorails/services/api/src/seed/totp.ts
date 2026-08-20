/**
 * Prints the current TOTP code for a demonstration account.
 *
 * This exists so a reviewer can actually sign in to the demonstration environment and
 * exercise MFA rather than having it disabled for convenience. It reads the encrypted
 * secret from the database and refuses to run outside DEMO or SANDBOX — a tool that
 * prints a live second factor has no business existing anywhere else.
 */

import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withReadOnlyContext, closePool, maybeOne, useDeploymentCredentials } from '../db/pool.js';
import { environment } from '../core/env.js';
import { decryptField, totpCodeForStep, totpStep, TOTP_PERIOD_SECONDS } from '../core/crypto.js';

/**
 * The command that runs this file, as a path relative to where the user is standing.
 *
 * Derived rather than written down. Both places that printed this instruction said
 * `node dist/seed/totp.js`, and the built file is at `dist/src/seed/totp.js` — so a
 * founder following the seeder's own output got MODULE_NOT_FOUND. Small, and exactly the
 * kind of friction that makes somebody doubt the rest of what they are told.
 */
export function totpCommand(): string {
  return `node ${relative(process.cwd(), fileURLToPath(import.meta.url))}`;
}

async function main(): Promise<void> {
  const mode = environment().mode;
  if (mode !== 'DEMO' && mode !== 'SANDBOX') {
    throw new Error(`REFUSED: this tool prints a live second factor and will not run in ${mode}.`);
  }

  useDeploymentCredentials();

  const email = process.argv[2];
  if (!email) {
    process.stderr.write(`Usage: ${totpCommand()} <email>\n`);
    process.exit(2);
  }

  const row = await withReadOnlyContext({ scope: 'system' }, (db) =>
    maybeOne<{ full_name: string; mfa_secret_encrypted: string | null; mfa_enrolled: boolean }>(
      db,
      'SELECT full_name, mfa_secret_encrypted, mfa_enrolled FROM app_user WHERE email_normalised = $1',
      [email.trim().toLowerCase()],
    ),
  );

  if (!row) {
    process.stderr.write(`No account found for ${email}\n`);
    process.exit(1);
  }
  if (!row.mfa_secret_encrypted || !row.mfa_enrolled) {
    process.stderr.write(`${email} has no MFA secret enrolled.\n`);
    process.exit(1);
  }

  const secret = decryptField(row.mfa_secret_encrypted);
  const step = totpStep();
  const code = totpCodeForStep(secret, step);
  const secondsRemaining = TOTP_PERIOD_SECONDS - Math.floor((Date.now() / 1000) % TOTP_PERIOD_SECONDS);

  process.stdout.write(
    `\n  ${row.full_name}\n  ${email}\n\n  Code: ${code}    (valid for ${secondsRemaining}s)\n\n`,
  );
}

// Runs only when this file IS the program, not when something imports it for
// totpCommand(). Without the guard, the seeder importing that one helper executed this
// tool's entry point mid-seed and exited the process — a module that runs its main() on
// import is a trap for whoever imports it next, whatever they wanted from it.
const isEntryPoint = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntryPoint) {
  main()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
