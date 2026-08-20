/**
 * Exception (break) management.
 *
 * A break with no owner is a break nobody fixes. Every exception opened here gets a
 * type, a priority, a service-level target and — as soon as someone touches it — a named
 * owner. Closure above the four-eyes threshold requires a second person, and the database
 * refuses a closure where the approver is the investigator.
 */
import { one, many, maybeOne } from '../../db/pool.js';
import { Decimal } from '../../core/money.js';
import { nextReference } from '../../core/ids.js';
import { recordAudit } from '../../audit/audit.js';
import { precondition, notFound, forbidden } from '../../core/errors.js';
const SLA_HOURS = { critical: 4, high: 24, normal: 72, low: 168 };
export async function openExceptionCase(db, input) {
    const reference = await nextReference(db, 'exception_case');
    const row = await one(db, `INSERT INTO exception_case (
       reference, exception_type, reconciliation_item_id, transaction_id, organization_id,
       partner_id, currency, amount, priority, owner_id, status, sla_due_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open', now() + ($11 || ' hours')::interval)
     RETURNING id`, [
        reference, input.exceptionType, input.reconciliationItemId ?? null,
        input.transactionId ?? null, input.organizationId ?? null, input.partnerId ?? null,
        input.currency ?? null, input.amount?.toString() ?? null,
        input.priority, input.ownerId ?? null, String(SLA_HOURS[input.priority]),
    ]);
    await db.query(`INSERT INTO exception_case_note (exception_case_id, author_id, body)
     VALUES ($1, (SELECT id FROM app_user WHERE email_normalised = 'system@ekorails.invalid'), $2)`, [row.id, `Opened automatically.\n\n${input.detail}`]);
    await recordAudit(db, {
        category: 'data_create',
        action: 'exception.open',
        outcome: 'success',
        actorType: 'system',
        organizationId: input.organizationId ?? null,
        transactionId: input.transactionId ?? null,
        entityType: 'exception_case',
        entityId: row.id,
        metadata: {
            reference, exception_type: input.exceptionType, priority: input.priority,
            amount: input.amount?.toString() ?? null, currency: input.currency ?? null,
            detail: input.detail,
        },
    });
    return { id: row.id, reference };
}
/** Amount above which closing a break requires a second person's approval. */
export const FOUR_EYES_THRESHOLD = Decimal.fromString('1000.000000');
export async function assignException(db, exceptionId, ownerId, actorUserId) {
    await db.query("UPDATE exception_case SET owner_id = $2, status = CASE WHEN status = 'open' THEN 'investigating' ELSE status END WHERE id = $1", [exceptionId, ownerId]);
    await recordAudit(db, {
        category: 'data_update', action: 'exception.assign', outcome: 'success',
        actorUserId, entityType: 'exception_case', entityId: exceptionId,
        newValues: { owner_id: ownerId },
    });
}
export async function addExceptionNote(db, input) {
    if (input.body.trim().length < 5) {
        throw precondition('NOTE_TOO_SHORT', 'An investigation note must say something.');
    }
    await db.query(`INSERT INTO exception_case_note (exception_case_id, author_id, body, evidence_refs)
     VALUES ($1,$2,$3,$4::jsonb)`, [input.exceptionId, input.authorId, input.body, JSON.stringify(input.evidenceRefs ?? [])]);
    await db.query("UPDATE exception_case SET status = 'investigating' WHERE id = $1 AND status = 'open'", [input.exceptionId]);
}
export async function proposeResolution(db, input) {
    if (input.resolution.trim().length < 20) {
        throw precondition('RESOLUTION_TOO_SHORT', 'A resolution must explain what was found and what was done, in at least 20 characters.');
    }
    const exc = await maybeOne(db, 'SELECT amount::text, currency, status FROM exception_case WHERE id = $1', [input.exceptionId]);
    if (!exc)
        throw notFound('EXCEPTION_NOT_FOUND', 'Exception case not found.');
    if (['resolved', 'written_off', 'closed_no_action'].includes(exc.status)) {
        throw precondition('EXCEPTION_ALREADY_CLOSED', 'This exception is already closed.');
    }
    const amount = exc.amount ? Decimal.fromString(exc.amount) : Decimal.zero();
    const requiresApproval = amount.greaterThanOrEqual(FOUR_EYES_THRESHOLD);
    await db.query(`UPDATE exception_case
        SET resolution = $2, resolved_by = $3, resolved_at = now(),
            resolution_journal_id = $4,
            status = CASE WHEN $5 THEN 'pending_approval' ELSE 'resolved' END,
            closed_at = CASE WHEN $5 THEN NULL ELSE now() END
      WHERE id = $1`, [
        input.exceptionId, input.resolution, input.resolvedBy,
        input.resolutionJournalId ?? null, requiresApproval,
    ]);
    await recordAudit(db, {
        category: 'data_update', action: 'exception.resolve_proposed', outcome: 'success',
        actorUserId: input.resolvedBy, entityType: 'exception_case', entityId: input.exceptionId,
        reason: input.resolution,
        metadata: {
            requires_approval: requiresApproval, amount: amount.toString(),
            four_eyes_threshold: FOUR_EYES_THRESHOLD.toString(),
        },
    });
    return { requiresApproval };
}
export async function approveResolution(db, exceptionId, approverId) {
    const exc = await maybeOne(db, 'SELECT resolved_by, status FROM exception_case WHERE id = $1', [exceptionId]);
    if (!exc)
        throw notFound('EXCEPTION_NOT_FOUND', 'Exception case not found.');
    if (exc.status !== 'pending_approval') {
        throw precondition('EXCEPTION_NOT_PENDING_APPROVAL', 'This exception is not awaiting approval.');
    }
    if (exc.resolved_by === approverId) {
        // Also enforced by a database constraint. Two places, because this is the control an
        // auditor will specifically test.
        await recordAudit(db, {
            category: 'authorisation', action: 'exception.approve', outcome: 'denied',
            actorUserId: approverId, entityType: 'exception_case', entityId: exceptionId,
            metadata: { denial_reason: 'self_approval' },
        });
        throw forbidden('SEGREGATION_OF_DUTIES', 'You investigated this break and cannot also approve its closure.', 'four-eyes on break closure');
    }
    await db.query(`UPDATE exception_case
        SET approved_by = $2, approved_at = now(), status = 'resolved', closed_at = now()
      WHERE id = $1`, [exceptionId, approverId]);
    await recordAudit(db, {
        category: 'approval', action: 'exception.approve', outcome: 'success',
        actorUserId: approverId, entityType: 'exception_case', entityId: exceptionId,
    });
}
export async function listExceptions(db, filter = {}) {
    const rows = await many(db, `SELECT e.reference, e.exception_type, e.status, e.priority, e.amount::text, e.currency,
            t.reference AS transaction_reference, u.full_name AS owner_name,
            e.opened_at, e.sla_due_at
       FROM exception_case e
       LEFT JOIN transaction t ON t.id = e.transaction_id
       LEFT JOIN app_user u ON u.id = e.owner_id
      WHERE ($1::text IS NULL OR e.status = $1)
        AND ($2::text IS NULL OR e.priority = $2)
        AND (NOT $3 OR e.status NOT IN ('resolved','written_off','closed_no_action'))
      ORDER BY
        CASE e.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        e.sla_due_at NULLS LAST, e.opened_at`, [filter.status ?? null, filter.priority ?? null, filter.openOnly ?? false]);
    const now = Date.now();
    return rows.map((r) => ({
        reference: r.reference,
        exceptionType: r.exception_type,
        status: r.status,
        priority: r.priority,
        amount: r.amount,
        currency: r.currency,
        transactionReference: r.transaction_reference,
        ownerName: r.owner_name,
        openedAt: r.opened_at.toISOString(),
        slaDueAt: r.sla_due_at ? r.sla_due_at.toISOString() : null,
        breachedSla: r.sla_due_at !== null
            && r.sla_due_at.getTime() < now
            && !['resolved', 'written_off', 'closed_no_action'].includes(r.status),
        ageHours: Math.round((now - r.opened_at.getTime()) / 3_600_000),
    }));
}
export async function getException(db, reference) {
    const exc = await maybeOne(db, `SELECT e.id, e.reference, e.exception_type, e.status, e.priority,
            e.amount::text AS amount, e.currency, e.resolution, e.opened_at, e.sla_due_at,
            e.resolved_at, e.closed_at,
            t.reference AS transaction_reference,
            o.legal_name AS organization_name,
            p.display_name AS partner_name,
            ow.full_name AS owner_name, rb.full_name AS resolved_by_name,
            ab.full_name AS approved_by_name
       FROM exception_case e
       LEFT JOIN transaction t ON t.id = e.transaction_id
       LEFT JOIN organization o ON o.id = e.organization_id
       LEFT JOIN partner p ON p.id = e.partner_id
       LEFT JOIN app_user ow ON ow.id = e.owner_id
       LEFT JOIN app_user rb ON rb.id = e.resolved_by
       LEFT JOIN app_user ab ON ab.id = e.approved_by
      WHERE e.reference = $1`, [reference]);
    if (!exc)
        return null;
    exc['notes'] = await many(db, `SELECT n.body, n.evidence_refs, n.created_at, u.full_name AS author_name
       FROM exception_case_note n LEFT JOIN app_user u ON u.id = n.author_id
      WHERE n.exception_case_id = $1 ORDER BY n.created_at`, [exc['id']]);
    return exc;
}
//# sourceMappingURL=exceptions.js.map