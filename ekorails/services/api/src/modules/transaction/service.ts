/**
 * Transaction initiation and maker-checker approval.
 *
 * The invariants this module owns:
 *   - A transaction reference is generated once, at creation, and is immutable thereafter
 *     (enforced again by a database trigger).
 *   - Amount, currency and beneficiary are fixed once the transaction leaves draft.
 *   - The person who creates a transaction can never provide its dual authorisation.
 *   - An idempotency key scoped to the organisation makes a repeated create return the
 *     original transaction rather than a second one.
 */

import type { Queryable } from '../../db/pool.js';
import { one, maybeOne, many } from '../../db/pool.js';
import { Decimal } from '../../core/money.js';
import { nextReference } from '../../core/ids.js';
import { fingerprint, canonicalHash } from '../../core/crypto.js';
import { recordAudit } from '../../audit/audit.js';
import { invalid, precondition, notFound, forbidden, conflict } from '../../core/errors.js';
import { transition } from '../settlement/machine.js';
import { evaluate, buildTransactionInput } from '../compliance/engine.js';
import { queueNotification } from '../notification/notify.js';
import type { Permission } from '../../auth/rbac.js';

export interface CreateTransactionInput {
  organizationId: string;
  beneficiaryId: string;
  corridorId: string;
  sendAmount: string;
  sendCurrency: string;
  receiveCurrency: string;
  purpose: string;
  sourceOfFunds: string;
  requestedSettlementDate?: string | null;
  invoiceNumber?: string | null;
  documentLinks?: Array<{ documentId: string; role: string }>;
  initiatedBy: string;
  idempotencyKey?: string | null;
}

export interface CreatedTransaction {
  id: string;
  reference: string;
  state: string;
  wasExisting: boolean;
}

/**
 * Fingerprint used for duplicate-invoice detection. Deliberately covers the invoice
 * number, the beneficiary, the amount and the currency together: the same invoice number
 * to a different supplier is not a duplicate, and the same amount to the same supplier
 * with a different invoice number usually is not either.
 */
export function invoiceFingerprint(input: {
  invoiceNumber: string; beneficiaryId: string; amount: string; currency: string;
}): string {
  return fingerprint(
    canonicalHash({
      invoice: input.invoiceNumber.trim().toUpperCase(),
      beneficiary: input.beneficiaryId,
      amount: input.amount,
      currency: input.currency,
    }),
    'invoice',
  );
}

export async function createTransaction(
  db: Queryable, input: CreateTransactionInput,
): Promise<CreatedTransaction> {
  const amount = Decimal.fromString(input.sendAmount);
  if (!amount.isPositive()) {
    throw invalid('INVALID_AMOUNT', 'The amount must be greater than zero.');
  }
  if (input.purpose.trim().length < 5) {
    throw invalid('PURPOSE_REQUIRED', 'State the purpose of the payment.');
  }
  if (input.sourceOfFunds.trim().length < 20) {
    throw invalid(
      'SOURCE_OF_FUNDS_REQUIRED',
      'Describe the source of funds in at least 20 characters. This is a due-diligence requirement, ' +
      'not a formality.',
    );
  }

  // Idempotency: a repeated create with the same key returns the original.
  if (input.idempotencyKey) {
    const existing = await maybeOne<{ id: string; reference: string; state: string }>(
      db,
      'SELECT id, reference, state FROM transaction WHERE organization_id = $1 AND idempotency_key = $2',
      [input.organizationId, input.idempotencyKey],
    );
    if (existing) {
      return { ...existing, wasExisting: true };
    }
  }

  // The organisation must be approved and unsuspended. Checked here so a suspended
  // customer gets a clear refusal rather than a compliance rejection three steps later.
  const org = await one<{ onboarding_status: string; suspended_at: Date | null; legal_name: string }>(
    db,
    'SELECT onboarding_status, suspended_at, legal_name FROM organization WHERE id = $1',
    [input.organizationId],
  );
  if (org.suspended_at !== null) {
    await recordAudit(db, {
      category: 'authorisation', action: 'transaction.create', outcome: 'denied',
      actorUserId: input.initiatedBy, organizationId: input.organizationId,
      metadata: { denial_reason: 'organisation_suspended' },
    });
    throw forbidden(
      'ORGANISATION_SUSPENDED',
      'This organisation is suspended and cannot initiate transactions.',
      'suspended_at is set',
    );
  }
  if (org.onboarding_status !== 'approved') {
    await recordAudit(db, {
      category: 'authorisation', action: 'transaction.create', outcome: 'denied',
      actorUserId: input.initiatedBy, organizationId: input.organizationId,
      metadata: { denial_reason: `onboarding_status_${org.onboarding_status}` },
    });
    throw forbidden(
      'ORGANISATION_NOT_APPROVED',
      `This organisation is "${org.onboarding_status}" and cannot initiate transactions until onboarding is approved.`,
    );
  }

  const beneficiary = await maybeOne<{ id: string; organization_id: string; status: string }>(
    db, 'SELECT id, organization_id, status FROM beneficiary WHERE id = $1', [input.beneficiaryId],
  );
  // Row-level security already prevents reading another organisation's beneficiary, but
  // this check makes the failure explicit and returns "not found" rather than leaking
  // that the record exists elsewhere.
  if (!beneficiary || beneficiary.organization_id !== input.organizationId) {
    throw notFound('BENEFICIARY_NOT_FOUND', 'Beneficiary not found.');
  }

  const reference = await nextReference(db, 'transaction');
  const fp = input.invoiceNumber
    ? invoiceFingerprint({
        invoiceNumber: input.invoiceNumber,
        beneficiaryId: input.beneficiaryId,
        amount: amount.toString(),
        currency: input.sendCurrency,
      })
    : null;

  let created;
  try {
    created = await one<{ id: string; state: string }>(
      db,
      `INSERT INTO transaction (
         reference, organization_id, beneficiary_id, corridor_id, send_currency, receive_currency,
         send_amount, purpose, source_of_funds, requested_settlement_date, invoice_number,
         invoice_fingerprint, initiated_by, idempotency_key, state
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft')
       RETURNING id, state`,
      [
        reference, input.organizationId, input.beneficiaryId, input.corridorId,
        input.sendCurrency, input.receiveCurrency, amount.toString(),
        input.purpose, input.sourceOfFunds, input.requestedSettlementDate ?? null,
        input.invoiceNumber ?? null, fp, input.initiatedBy, input.idempotencyKey ?? null,
      ],
    );
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError.code === '23505') {
      throw conflict(
        'DUPLICATE_IDEMPOTENCY_KEY',
        'A transaction with this idempotency key already exists for your organisation.',
      );
    }
    throw error;
  }

  for (const link of input.documentLinks ?? []) {
    const doc = await maybeOne<{ organization_id: string; malware_scan_status: string }>(
      db, 'SELECT organization_id, malware_scan_status FROM document WHERE id = $1', [link.documentId],
    );
    if (!doc || doc.organization_id !== input.organizationId) {
      throw notFound('DOCUMENT_NOT_FOUND', 'Document not found.');
    }
    if (doc.malware_scan_status !== 'clean' && doc.malware_scan_status !== 'skipped_unsupported_type') {
      throw precondition(
        'DOCUMENT_NOT_SCANNED',
        `Document ${link.documentId} has scan status "${doc.malware_scan_status}" and cannot be linked ` +
        `to a transaction until it is clean.`,
      );
    }
    await db.query(
      `INSERT INTO transaction_document (transaction_id, document_id, role, linked_by)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [created.id, link.documentId, link.role, input.initiatedBy],
    );
  }

  await recordAudit(db, {
    category: 'data_create',
    action: 'transaction.create',
    outcome: 'success',
    actorUserId: input.initiatedBy,
    organizationId: input.organizationId,
    entityType: 'transaction',
    entityId: created.id,
    transactionId: created.id,
    newValues: {
      reference, send_amount: amount.toString(), send_currency: input.sendCurrency,
      receive_currency: input.receiveCurrency, beneficiary_id: input.beneficiaryId,
      purpose: input.purpose, invoice_number: input.invoiceNumber ?? null,
    },
  });

  return { id: created.id, reference, state: created.state, wasExisting: false };
}

export interface ApprovalActor {
  userId: string;
  role: string;
  permissions: Set<Permission>;
  sessionId: string;
  stepUpValid: boolean;
}

/** Submits a draft for a colleague's authorisation. */
export async function submitForApproval(
  db: Queryable, transactionId: string, actor: ApprovalActor,
): Promise<{ state: string }> {
  const txn = await one<{ organization_id: string; reference: string; initiated_by: string }>(
    db, 'SELECT organization_id, reference, initiated_by FROM transaction WHERE id = $1', [transactionId],
  );

  const result = await transition(db, {
    transactionId,
    event: 'submit_for_approval',
    actorType: 'user',
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorPermissions: actor.permissions,
    stepUpValid: actor.stepUpValid,
    reason: 'Submitted by the initiator for dual authorisation.',
  });

  await queueNotification(db, {
    organizationId: txn.organization_id,
    recipientRole: 'business_approver',
    channel: 'in_app',
    eventType: 'transaction_awaiting_approval',
    subject: `${txn.reference} awaits your authorisation`,
    body: `Transaction ${txn.reference} has been submitted and needs a second authorisation. Sign in to review it.`,
    actionUrl: `/transactions/${transactionId}`,
    transactionId,
  });

  return { state: result.to };
}

/**
 * The dual-authorisation step. Three independent controls stop a self-approval here:
 * this check, the state machine's own check, and a database trigger on
 * transaction_approval. Test case 18 exercises all three.
 */
export async function businessApprove(
  db: Queryable,
  input: { transactionId: string; actor: ApprovalActor; approve: boolean; reason: string },
): Promise<{ state: string; riskOutcome?: string; complianceCase?: string | null }> {
  const txn = await one<{
    organization_id: string; reference: string; initiated_by: string; state: string;
  }>(
    db,
    'SELECT organization_id, reference, initiated_by, state FROM transaction WHERE id = $1',
    [input.transactionId],
  );

  if (input.actor.userId === txn.initiated_by) {
    await recordAudit(db, {
      category: 'authorisation', action: 'transaction.business_approve', outcome: 'denied',
      actorUserId: input.actor.userId, actorRole: input.actor.role,
      organizationId: txn.organization_id, transactionId: input.transactionId,
      entityType: 'transaction', entityId: input.transactionId,
      metadata: { denial_reason: 'self_approval', control: 'maker-checker' },
    });
    throw forbidden(
      'SEGREGATION_OF_DUTIES',
      'You initiated this transaction and cannot also authorise it. A second person must approve.',
      'maker-checker on business_dual_authorisation',
    );
  }

  if (!input.approve) {
    await db.query(
      `INSERT INTO transaction_approval (
         transaction_id, organization_id, approval_type, decision, decided_by, decided_by_role,
         reason, session_id, step_up_verified
       ) VALUES ($1,$2,'business_dual_authorisation','rejected',$3,$4,$5,$6,$7)`,
      [
        input.transactionId, txn.organization_id, input.actor.userId, input.actor.role,
        input.reason, input.actor.sessionId, input.actor.stepUpValid,
      ],
    );
    const result = await transition(db, {
      transactionId: input.transactionId,
      event: 'business_reject',
      actorType: 'user',
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      actorPermissions: input.actor.permissions,
      stepUpValid: input.actor.stepUpValid,
      reason: input.reason,
    });
    await queueNotification(db, {
      organizationId: txn.organization_id,
      recipientUserId: txn.initiated_by,
      channel: 'in_app',
      eventType: 'transaction_awaiting_approval',
      subject: `${txn.reference} was not authorised`,
      body: `Transaction ${txn.reference} was declined by the authoriser. Sign in to see the reason.`,
      actionUrl: `/transactions/${input.transactionId}`,
      transactionId: input.transactionId,
    });
    return { state: result.to };
  }

  await db.query(
    `INSERT INTO transaction_approval (
       transaction_id, organization_id, approval_type, decision, decided_by, decided_by_role,
       reason, session_id, step_up_verified
     ) VALUES ($1,$2,'business_dual_authorisation','approved',$3,$4,$5,$6,$7)`,
    [
      input.transactionId, txn.organization_id, input.actor.userId, input.actor.role,
      input.reason, input.actor.sessionId, input.actor.stepUpValid,
    ],
  );
  await db.query(
    'UPDATE transaction SET approved_by = $2, approved_at = now() WHERE id = $1',
    [input.transactionId, input.actor.userId],
  );

  const result = await transition(db, {
    transactionId: input.transactionId,
    event: 'business_approve',
    actorType: 'user',
    actorUserId: input.actor.userId,
    actorRole: input.actor.role,
    actorPermissions: input.actor.permissions,
    stepUpValid: input.actor.stepUpValid,
    reason: input.reason || 'Authorised by a second business user.',
  });

  // Run the compliance engine immediately on entering pending_compliance, so an analyst
  // opens a case that already has its assessment attached.
  const complianceInput = await buildTransactionInput(db, input.transactionId);
  const assessment = await evaluate(
    db, complianceInput,
    { type: 'transaction', id: input.transactionId, organizationId: txn.organization_id },
    { userId: null, role: null },
  );

  await db.query(
    'UPDATE transaction SET risk_rating = $2, latest_risk_assessment_id = $3 WHERE id = $1',
    [input.transactionId, assessment.outcome, assessment.riskAssessmentId],
  );

  if (assessment.recommendedAction !== 'auto_continue') {
    await queueNotification(db, {
      organizationId: txn.organization_id,
      recipientRole: 'compliance_analyst',
      channel: 'in_app',
      eventType: 'compliance_review_required',
      subject: `${txn.reference} requires compliance review (${assessment.outcome})`,
      body:
        `Transaction ${txn.reference} raised ${assessment.triggered.length} rule(s) and needs review. ` +
        `Case ${assessment.complianceCaseReference ?? 'pending'}.`,
      actionUrl: `/compliance/cases/${assessment.complianceCaseReference}`,
      transactionId: input.transactionId,
    });
  }

  return {
    state: result.to,
    riskOutcome: assessment.outcome,
    complianceCase: assessment.complianceCaseReference,
  };
}

/** Compliance clears or declines the transaction. */
export async function complianceDecide(
  db: Queryable,
  input: {
    transactionId: string;
    actor: ApprovalActor;
    decision: 'approve' | 'reject' | 'request_information' | 'suspend';
    reason: string;
  },
): Promise<{ state: string }> {
  if (input.reason.trim().length < 20) {
    throw invalid(
      'REASON_TOO_SHORT',
      'A compliance decision requires a written reason of at least 20 characters.',
    );
  }

  const txn = await one<{ organization_id: string; reference: string; initiated_by: string }>(
    db, 'SELECT organization_id, reference, initiated_by FROM transaction WHERE id = $1',
    [input.transactionId],
  );

  const EVENT: Record<string, string> = {
    approve: 'compliance_approve',
    reject: 'compliance_reject',
    request_information: 'compliance_request_information',
    suspend: 'compliance_suspend',
  };

  const result = await transition(db, {
    transactionId: input.transactionId,
    event: EVENT[input.decision]!,
    actorType: 'user',
    actorUserId: input.actor.userId,
    actorRole: input.actor.role,
    actorPermissions: input.actor.permissions,
    stepUpValid: input.actor.stepUpValid,
    reason: input.reason,
  });

  await db.query(
    `INSERT INTO transaction_approval (
       transaction_id, organization_id, approval_type, decision, decided_by, decided_by_role,
       reason, session_id, step_up_verified
     ) VALUES ($1,$2,'compliance',$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING`,
    [
      input.transactionId, txn.organization_id,
      input.decision === 'approve' ? 'approved' : 'rejected',
      input.actor.userId, input.actor.role, input.reason,
      input.actor.sessionId, input.actor.stepUpValid,
    ],
  );

  // Close any open compliance case attached to this transaction.
  await db.query(
    `UPDATE compliance_case
        SET status = $2, closed_at = CASE WHEN $2 LIKE 'closed%' THEN now() ELSE NULL END,
            first_touched_at = COALESCE(first_touched_at, now())
      WHERE subject_type = 'transaction' AND subject_id = $1
        AND status NOT LIKE 'closed%'`,
    [
      input.transactionId,
      input.decision === 'approve' ? 'closed_cleared'
        : input.decision === 'reject' ? 'closed_rejected'
        : input.decision === 'suspend' ? 'escalated' : 'awaiting_information',
    ],
  );

  await queueNotification(db, {
    organizationId: txn.organization_id,
    recipientUserId: txn.initiated_by,
    channel: 'in_app',
    eventType: input.decision === 'request_information'
      ? 'additional_information_required' : 'compliance_review_required',
    subject: `${txn.reference}: compliance ${input.decision.replace(/_/g, ' ')}`,
    body: `Transaction ${txn.reference} has a compliance update. Sign in to see the detail.`,
    actionUrl: `/transactions/${input.transactionId}`,
    transactionId: input.transactionId,
  });

  return { state: result.to };
}

export async function listTransactions(
  db: Queryable,
  filter: {
    organizationId?: string | null; state?: string | null;
    from?: string | null; to?: string | null; limit?: number; offset?: number;
  } = {},
): Promise<Array<Record<string, unknown>>> {
  return many<Record<string, unknown>>(
    db,
    `SELECT t.id, t.reference, t.state, t.send_amount::text AS send_amount, t.send_currency,
            t.receive_currency, t.expected_receive_amount::text AS expected_receive_amount,
            t.actual_receive_amount::text AS actual_receive_amount,
            t.risk_rating, t.purpose, t.invoice_number, t.created_at, t.completed_at,
            o.legal_name AS organization_name, o.display_code AS organization_code,
            b.legal_name AS beneficiary_name, b.country AS beneficiary_country,
            c.code AS corridor_code,
            iu.display_name AS initiated_by_name, au.display_name AS approved_by_name
       FROM transaction t
       JOIN organization o ON o.id = t.organization_id
       JOIN beneficiary b ON b.id = t.beneficiary_id
       JOIN corridor c ON c.id = t.corridor_id
       LEFT JOIN app_user iu ON iu.id = t.initiated_by
       LEFT JOIN app_user au ON au.id = t.approved_by
      WHERE ($1::uuid IS NULL OR t.organization_id = $1)
        AND ($2::text IS NULL OR t.state = $2)
        AND ($3::timestamptz IS NULL OR t.created_at >= $3)
        AND ($4::timestamptz IS NULL OR t.created_at < $4)
      ORDER BY t.created_at DESC
      LIMIT $5 OFFSET $6`,
    [
      filter.organizationId ?? null, filter.state ?? null,
      filter.from ?? null, filter.to ?? null,
      Math.min(filter.limit ?? 50, 500), filter.offset ?? 0,
    ],
  );
}

export async function getTransaction(
  db: Queryable, transactionId: string,
): Promise<Record<string, unknown> | null> {
  return maybeOne<Record<string, unknown>>(
    db,
    `SELECT t.*, t.send_amount::text AS send_amount,
            t.expected_receive_amount::text AS expected_receive_amount,
            t.actual_receive_amount::text AS actual_receive_amount,
            o.legal_name AS organization_name, b.legal_name AS beneficiary_name,
            c.code AS corridor_code, c.is_placeholder AS corridor_is_placeholder
       FROM transaction t
       JOIN organization o ON o.id = t.organization_id
       JOIN beneficiary b ON b.id = t.beneficiary_id
       JOIN corridor c ON c.id = t.corridor_id
      WHERE t.id = $1`,
    [transactionId],
  );
}

/** Transactions waiting on the current user's action. Drives the business dashboard. */
export async function requiringAction(
  db: Queryable, organizationId: string, userId: string, permissions: Set<Permission>,
): Promise<Array<Record<string, unknown>>> {
  const states: string[] = [];
  if (permissions.has('txn.approve')) states.push('pending_business_approval');
  if (permissions.has('txn.initiate')) states.push('draft', 'additional_information_required');
  if (permissions.has('fx.quote.accept')) states.push('quote_issued');
  if (states.length === 0) return [];

  return many<Record<string, unknown>>(
    db,
    `SELECT t.id, t.reference, t.state, t.send_amount::text AS send_amount, t.send_currency,
            b.legal_name AS beneficiary_name, t.created_at, t.initiated_by,
            (t.initiated_by = $3) AS initiated_by_me
       FROM transaction t JOIN beneficiary b ON b.id = t.beneficiary_id
      WHERE t.organization_id = $1 AND t.state = ANY($2::text[])
      ORDER BY t.created_at DESC LIMIT 50`,
    [organizationId, states, userId],
  );
}
