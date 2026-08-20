/**
 * Database access.
 *
 * Three rules this module exists to enforce:
 *
 * 1. Every unit of work runs inside an explicit transaction with an explicit security
 *    context. `withContext` sets the row-level-security GUCs with `set_config(..., true)`
 *    so they are transaction-local and cannot leak between pooled connections.
 *
 * 2. The application never connects as a superuser or as the schema owner. It connects
 *    as `ekorails_app`, which lacks UPDATE and DELETE on the audit and ledger tables and
 *    is subject to row-level security. A bug in the application layer therefore cannot
 *    produce a cross-organisation read or an audit rewrite.
 *
 * 3. Parameterised queries only. There is no string interpolation of user input into
 *    SQL anywhere in this codebase; identifiers that must be dynamic are whitelisted.
 */

import pg from 'pg';
import { logger } from '../core/logger.js';
import { internal } from '../core/errors.js';

const { Pool, types } = pg;

// NUMERIC must arrive as a string. pg's default parser would hand us a JavaScript
// number and silently destroy precision on large or fractional monetary values.
types.setTypeParser(1700, (value: string) => value);
// int8 (BIGINT) likewise: beyond 2^53 a JS number is lossy.
types.setTypeParser(20, (value: string) => value);

export interface QueryResultLike<R> {
  rows: R[];
  rowCount: number | null;
}

export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<QueryResultLike<R>>;
}

/**
 * The security context a unit of work runs under.
 *
 *   scope 'org'    - a business user; row-level security confines them to organizationId
 *   scope 'global' - EKORails back-office or an auditor; may read across organisations
 *   scope 'system' - internal jobs, seeding and migrations
 *   scope 'none'   - unauthenticated; sees nothing that is organisation-scoped
 */
export interface SecurityContext {
  scope: 'org' | 'global' | 'system' | 'none';
  organizationId?: string | null;
  userId?: string | null;
  requestId?: string;
  correlationId?: string;
}

export const SYSTEM_CONTEXT: SecurityContext = { scope: 'system' };
export const ANONYMOUS_CONTEXT: SecurityContext = { scope: 'none' };

let pool: pg.Pool | null = null;
let deploymentCredentials = false;

/**
 * Switches the pool to the schema-owner role.
 *
 * Used ONLY by migrations and by the seeder, which are deployment operations rather than
 * application operations. Seeding writes reference data (roles, permissions, rule
 * definitions) that the running application must never be able to write — the fact that
 * the seeder needs elevated credentials is the least-privilege model working, not a
 * limitation to route around.
 *
 * Must be called before the first getPool(). Refuses outside DEMO, SANDBOX and TEST.
 */
export function useDeploymentCredentials(): void {
  const mode = process.env['EKORAILS_ENV_MODE'] ?? 'DEMO';
  if (!['DEMO', 'SANDBOX', 'TEST'].includes(mode)) {
    throw new Error(
      `REFUSED: deployment credentials cannot be used with EKORAILS_ENV_MODE=${mode}. ` +
      'In a controlled pilot or production, migrations run as a separate operational step with ' +
      'credentials the application process never holds.',
    );
  }
  if (pool !== null) {
    throw new Error('useDeploymentCredentials() must be called before the pool is opened.');
  }
  deploymentCredentials = true;
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  pool = new Pool({
    host: process.env['EKORAILS_DB_HOST'] ?? '127.0.0.1',
    port: Number(process.env['EKORAILS_DB_PORT'] ?? 5432),
    database: process.env['EKORAILS_DB_NAME'] ?? 'ekorails',
    user: deploymentCredentials
      ? (process.env['EKORAILS_DB_OWNER'] ?? 'ekorails_owner')
      : (process.env['EKORAILS_DB_USER'] ?? 'ekorails_app'),
    password: deploymentCredentials
      ? (process.env['EKORAILS_DB_OWNER_PASSWORD'] ?? 'ekorails_owner_dev')
      : (process.env['EKORAILS_DB_PASSWORD'] ?? 'ekorails_app_dev'),
    max: Number(process.env['EKORAILS_DB_POOL_MAX'] ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Fail fast rather than hanging a settlement operation behind a stuck query.
    statement_timeout: Number(process.env['EKORAILS_DB_STATEMENT_TIMEOUT_MS'] ?? 15_000),
    application_name: deploymentCredentials ? 'ekorails-deploy' : 'ekorails-api',
  });
  pool.on('error', (err) => {
    logger.error('Idle database client error', { error: err.message });
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Runs `fn` inside a single transaction with the security context applied.
 *
 * Rolls back on any thrown error. There is no "partial success": a settlement step that
 * posts a journal, writes a transition and emits an audit event either does all three or
 * none of them, because a ledger entry without its audit record is worse than no ledger
 * entry at all.
 */
export async function withContext<T>(
  context: SecurityContext,
  fn: (db: Queryable) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // set_config with is_local = true scopes these to the transaction. When the
    // transaction ends the settings revert, so a pooled connection cannot carry one
    // organisation's context into the next request.
    await client.query('SELECT set_config($1, $2, true)', ['ekorails.scope', context.scope]);
    await client.query('SELECT set_config($1, $2, true)', [
      'ekorails.org_id', context.organizationId ?? '',
    ]);
    await client.query('SELECT set_config($1, $2, true)', [
      'ekorails.user_id', context.userId ?? '',
    ]);

    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('Rollback failed', {
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Read-only variant. Opens a genuinely read-only transaction so that a reporting or
 * auditor query cannot write, even if it is handed a statement that would.
 */
export async function withReadOnlyContext<T>(
  context: SecurityContext,
  fn: (db: Queryable) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SELECT set_config($1, $2, true)', ['ekorails.scope', context.scope]);
    await client.query('SELECT set_config($1, $2, true)', [
      'ekorails.org_id', context.organizationId ?? '',
    ]);
    await client.query('SELECT set_config($1, $2, true)', [
      'ekorails.user_id', context.userId ?? '',
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection is being discarded */ }
    throw error;
  } finally {
    client.release();
  }
}

/** Exactly one row, or a thrown error. Use where absence is a bug, not a 404. */
export async function one<R>(
  db: Queryable, text: string, params: readonly unknown[] = [],
): Promise<R> {
  const { rows } = await db.query<R>(text, params);
  if (rows.length !== 1) {
    throw internal(
      'UNEXPECTED_ROW_COUNT',
      `Expected exactly 1 row, received ${rows.length}. Query: ${text.slice(0, 200)}`,
    );
  }
  return rows[0]!;
}

/** At most one row. Returns null where a record legitimately may not exist. */
export async function maybeOne<R>(
  db: Queryable, text: string, params: readonly unknown[] = [],
): Promise<R | null> {
  const { rows } = await db.query<R>(text, params);
  if (rows.length > 1) {
    throw internal('UNEXPECTED_ROW_COUNT', `Expected at most 1 row, received ${rows.length}.`);
  }
  return rows[0] ?? null;
}

export async function many<R>(
  db: Queryable, text: string, params: readonly unknown[] = [],
): Promise<R[]> {
  const { rows } = await db.query<R>(text, params);
  return rows;
}

/**
 * Maps a PostgreSQL error raised by one of the integrity guards into an application
 * error with a stable code. These are not incidental failures: each one is a control
 * doing its job, and the code is what the tests assert on.
 */
export function mapDatabaseError(error: unknown): Error {
  if (!(error instanceof Error)) return internal('DB_ERROR', String(error));
  const message = error.message;
  const pgError = error as Error & { code?: string; constraint?: string };

  const guards: Array<[RegExp, string, string]> = [
    [/APPEND_ONLY_VIOLATION/, 'APPEND_ONLY_VIOLATION',
      'This record is append-only and cannot be modified or deleted.'],
    [/RETENTION_VIOLATION/, 'RETENTION_VIOLATION',
      'This record is retention-bound and cannot be deleted.'],
    [/JOURNAL_IMBALANCE/, 'JOURNAL_IMBALANCE',
      'The journal does not balance. Debits must equal credits in every currency.'],
    [/JOURNAL_INCOMPLETE/, 'JOURNAL_INCOMPLETE',
      'A journal requires at least two entries.'],
    [/CURRENCY_MISMATCH/, 'LEDGER_CURRENCY_MISMATCH',
      'A journal entry must be posted in its account currency.'],
    [/SEGREGATION_OF_DUTIES/, 'SEGREGATION_OF_DUTIES',
      'The user who initiated this transaction cannot also approve it.'],
    [/IMMUTABLE_REFERENCE/, 'IMMUTABLE_REFERENCE',
      'A transaction reference cannot be changed.'],
    [/IMMUTABLE_OWNER/, 'IMMUTABLE_OWNER',
      'A transaction cannot be moved between organisations.'],
    [/IMMUTABLE_INITIATOR/, 'IMMUTABLE_INITIATOR',
      'The initiating user of a transaction cannot be rewritten.'],
    [/IMMUTABLE_ECONOMICS/, 'IMMUTABLE_ECONOMICS',
      'Amount, currency and beneficiary are fixed once a transaction leaves draft.'],
    [/RULE_IMMUTABLE/, 'RULE_IMMUTABLE',
      'A published rule cannot be edited. Publish a new version instead.'],
    [/CONFIG_IMMUTABLE/, 'CONFIG_IMMUTABLE',
      'A configuration value cannot be edited in place. Propose a new version.'],
    [/FLAG_IMMUTABLE/, 'FLAG_IMMUTABLE',
      'This feature flag is set by deployment configuration and cannot be toggled at runtime.'],
    [/ALREADY_REVERSED/, 'ALREADY_REVERSED',
      'This journal has already been reversed.'],
  ];

  for (const [pattern, code, friendly] of guards) {
    if (pattern.test(message)) {
      const mapped = new Error(friendly) as Error & { code: string; guardMessage: string };
      mapped.name = 'IntegrityGuardError';
      mapped.code = code;
      mapped.guardMessage = message;
      return mapped;
    }
  }

  if (pgError.code === '23505') {
    const dup = new Error('A record with these details already exists.') as Error & { code: string };
    dup.name = 'UniqueViolation';
    dup.code = 'UNIQUE_VIOLATION';
    return dup;
  }
  if (pgError.code === '42501') {
    const denied = new Error(
      'The application database role is not permitted to perform this operation.',
    ) as Error & { code: string };
    denied.name = 'InsufficientPrivilege';
    denied.code = 'DB_PRIVILEGE_DENIED';
    return denied;
  }
  return error;
}

/** Sets a per-transaction advisory lock. Used to serialise settlement on one transaction. */
export async function advisoryLock(db: Queryable, namespace: number, key: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [namespace, key]);
}

export const LOCK_NAMESPACE = {
  transaction: 1,
  reconciliation: 2,
  velocity: 3,
  settlement: 4,
} as const;
