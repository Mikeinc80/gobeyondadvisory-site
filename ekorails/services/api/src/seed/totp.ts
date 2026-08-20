/**
 * Prints the current TOTP code for a demonstration account.
 *
 * This exists so a reviewer can actually sign in to the demonstration environment and
 * exercise MFA rather than having it disabled for convenience. It reads the encrypted
 * secret from the database and refuses to run outside DEMO or SANDBOX — a tool that
 * prints a live second factor has no business existing anywhere else.
 */

import { withReadOnlyContext, closePool, maybeOne, useDeploymentCredentials } from '../db/pool.js';
import { environment } from '../core/env.js';
import { decryptField, totpCodeForStep, totpStep, TOTP_PERIOD_SECONDS } from '../core/crypto.js';

async function main(): Promise<void> {
  const mode = environment().mode;
  if (mode !== 'DEMO' && mode !== 'SANDBOX') {
    throw new Error(`REFUSED: this tool prints a live second factor and will not run in ${mode}.`);
  }

  useDeploymentCredentials();

  const email = process.argv[2];
  if (!email) {
    process.stderr.write('Usage: node dist/seed/totp.js <email>\n');
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

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
