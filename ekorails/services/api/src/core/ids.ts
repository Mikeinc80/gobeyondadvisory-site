/**
 * Human-facing reference identifiers.
 *
 * These appear on receipts, in partner messages and in regulatory reports. They come
 * from a database sequence rather than a random source so that they are dense, sortable
 * and gap-detectable: a missing transaction reference in a regulatory return is
 * something a reviewer should be able to notice.
 *
 * They are NOT secrets and NOT capability tokens. Knowing a reference grants no access;
 * authorisation is always by organisation scope, never by reference obscurity.
 */

import type { Queryable } from '../db/pool.js';

const PREFIXES = {
  transaction: 'TXN',
  quote: 'FXQ',
  journal: 'JRN',
  compliance_case: 'CMP',
  support_case: 'SUP',
  exception_case: 'EXC',
  reconciliation: 'REC',
  incident: 'SEC',
  screening: 'SCR',
  data_request: 'DSR',
} as const;

export type ReferenceKind = keyof typeof PREFIXES;

const SEQUENCES: Record<ReferenceKind, string> = {
  transaction: 'ref_transaction_seq',
  quote: 'ref_quote_seq',
  journal: 'ref_journal_seq',
  compliance_case: 'ref_case_seq',
  support_case: 'ref_case_seq',
  exception_case: 'ref_recon_seq',
  reconciliation: 'ref_recon_seq',
  incident: 'ref_incident_seq',
  screening: 'ref_screening_seq',
  data_request: 'ref_case_seq',
};

/**
 * Format: PREFIX-YYYYMM-NNNNNN. The period segment makes a reference legible at a
 * glance and keeps sequence numbers meaningful across a long pilot.
 */
export async function nextReference(
  db: Queryable,
  kind: ReferenceKind,
  now: Date = new Date(),
): Promise<string> {
  const { rows } = await db.query<{ n: string }>('SELECT nextval($1) AS n', [SEQUENCES[kind]]);
  const n = rows[0]!.n;
  const period = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${PREFIXES[kind]}-${period}-${n.padStart(6, '0')}`;
}

/**
 * Idempotency key for an outbound partner call. Deterministic in the transaction
 * reference and the operation, so a crashed-and-restarted process reconstructs the
 * same key rather than minting a second one and instructing a second payment.
 */
export function outboundIdempotencyKey(transactionReference: string, operation: string): string {
  return `${transactionReference}:${operation}`;
}
