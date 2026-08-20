/**
 * Audit trail.
 *
 * The audit table is append-only, hash-chained, and the application role holds no
 * UPDATE or DELETE grant on it. This module is the only sanctioned way to write to it.
 *
 * Two properties matter more than convenience here:
 *
 *  - An audit write participates in the SAME transaction as the change it describes.
 *    A settlement transition that commits without its audit record, or an audit record
 *    that survives a rolled-back change, would both be worse than no audit at all.
 *
 *  - Values pass through redaction on the way in. The audit trail records that a bank
 *    account was changed and which one, not the account number.
 */

import type { Queryable } from '../db/pool.js';
import { redact } from '../core/redact.js';
import { sha256Hex } from '../core/crypto.js';

export type AuditCategory =
  | 'authentication'
  | 'authorisation'
  | 'data_read'
  | 'data_create'
  | 'data_update'
  | 'document_access'
  | 'compliance_decision'
  | 'approval'
  | 'rule_change'
  | 'limit_change'
  | 'role_change'
  | 'configuration_change'
  | 'settlement_transition'
  | 'ledger_posting'
  | 'report_export'
  | 'administrative_access'
  | 'integration'
  | 'security_check_failed'
  | 'privacy_request'
  | 'break_glass';

export interface AuditInput {
  category: AuditCategory;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  actorUserId?: string | null;
  actorRole?: string | null;
  actorType?: 'user' | 'system' | 'partner' | 'job' | 'anonymous';
  sessionId?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
  organizationId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  transactionId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  metadata?: Record<string, unknown>;
  reason?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
}

/**
 * Writes one audit event. Must be called with the same `db` handle as the change it
 * records, so that both commit or neither does.
 */
export async function recordAudit(db: Queryable, input: AuditInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO audit_event (
       category, action, outcome, actor_user_id, actor_role, actor_type,
       session_id, ip_hash, user_agent_hash, organization_id, entity_type, entity_id,
       transaction_id, old_values, new_values, metadata, reason, correlation_id, request_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      input.category,
      input.action,
      input.outcome,
      input.actorUserId ?? null,
      input.actorRole ?? null,
      input.actorType ?? 'user',
      input.sessionId ?? null,
      input.ipHash ?? null,
      input.userAgentHash ?? null,
      input.organizationId ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.transactionId ?? null,
      input.oldValues === undefined ? null : JSON.stringify(redact(input.oldValues)),
      input.newValues === undefined ? null : JSON.stringify(redact(input.newValues)),
      JSON.stringify(redact(input.metadata ?? {})),
      input.reason ?? null,
      input.correlationId ?? null,
      input.requestId ?? null,
    ],
  );
  return rows[0]!.id;
}

/**
 * Computes the change set between two records, for `data_update` events. Only fields
 * that actually changed are recorded — an audit trail cluttered with unchanged fields
 * is one nobody reads.
 */
export function diffRecords(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignore: readonly string[] = ['updated_at'],
): { old: Record<string, unknown>; new: Record<string, unknown>; changedFields: string[] } {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  const changedFields: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      oldValues[key] = a ?? null;
      newValues[key] = b ?? null;
      changedFields.push(key);
    }
  }
  return { old: oldValues, new: newValues, changedFields };
}

export interface ChainVerification {
  intact: boolean;
  eventsChecked: number;
  firstBreak: {
    seq: string;
    problem: string;
    expectedHash: string;
    storedHash: string;
  } | null;
}

/**
 * Verifies the audit hash chain using the database's own verification function, which
 * recomputes hashes in SQL. Deliberately not implemented in application code: if the
 * application were compromised, an application-side verifier would simply lie.
 */
export async function verifyAuditChain(db: Queryable, fromSeq = 0): Promise<ChainVerification> {
  const { rows: countRows } = await db.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM audit_event WHERE seq > $1', [fromSeq],
  );
  const { rows } = await db.query<{
    broken_seq: string; expected_hash: string; stored_hash: string; problem: string;
  }>('SELECT * FROM verify_audit_chain($1)', [fromSeq]);

  const break_ = rows[0];
  return {
    intact: rows.length === 0,
    eventsChecked: Number(countRows[0]!.n),
    firstBreak: break_
      ? {
          seq: break_.broken_seq,
          problem: break_.problem,
          expectedHash: break_.expected_hash,
          storedHash: break_.stored_hash,
        }
      : null,
  };
}

/**
 * Produces an export manifest for an audit extract: the range exported, a digest over
 * the exported rows, and the chain state at both ends. A regulator receiving an audit
 * export can use this to confirm they received a contiguous, unaltered range.
 */
export interface AuditExportManifest {
  fromSeq: string;
  toSeq: string;
  rowCount: number;
  contentDigest: string;
  startPrevHash: string | null;
  endEntryHash: string | null;
  chainIntact: boolean;
  generatedAt: string;
}

export async function buildAuditExportManifest(
  db: Queryable,
  rows: Array<Record<string, unknown>>,
): Promise<AuditExportManifest> {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const verification = await verifyAuditChain(db, 0);
  return {
    fromSeq: first ? String(first['seq']) : '0',
    toSeq: last ? String(last['seq']) : '0',
    rowCount: rows.length,
    contentDigest: sha256Hex(JSON.stringify(rows)),
    startPrevHash: first ? (first['prev_hash'] as string | null) : null,
    endEntryHash: last ? (last['entry_hash'] as string | null) : null,
    chainIntact: verification.intact,
    generatedAt: new Date().toISOString(),
  };
}
