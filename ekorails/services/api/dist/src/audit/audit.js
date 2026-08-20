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
import { redact } from '../core/redact.js';
import { sha256Hex } from '../core/crypto.js';
/**
 * Writes one audit event. Must be called with the same `db` handle as the change it
 * records, so that both commit or neither does.
 */
export async function recordAudit(db, input) {
    const { rows } = await db.query(`INSERT INTO audit_event (
       category, action, outcome, actor_user_id, actor_role, actor_type,
       session_id, ip_hash, user_agent_hash, organization_id, entity_type, entity_id,
       transaction_id, old_values, new_values, metadata, reason, correlation_id, request_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`, [
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
    ]);
    return rows[0].id;
}
/**
 * Computes the change set between two records, for `data_update` events. Only fields
 * that actually changed are recorded — an audit trail cluttered with unchanged fields
 * is one nobody reads.
 */
export function diffRecords(before, after, ignore = ['updated_at']) {
    const oldValues = {};
    const newValues = {};
    const changedFields = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
        if (ignore.includes(key))
            continue;
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
/**
 * Verifies the audit hash chain using the database's own verification function, which
 * recomputes hashes in SQL. Deliberately not implemented in application code: if the
 * application were compromised, an application-side verifier would simply lie.
 */
export async function verifyAuditChain(db, fromSeq = 0) {
    const { rows: countRows } = await db.query('SELECT count(*)::text AS n FROM audit_event WHERE seq > $1', [fromSeq]);
    const { rows } = await db.query('SELECT * FROM verify_audit_chain($1)', [fromSeq]);
    const break_ = rows[0];
    return {
        intact: rows.length === 0,
        eventsChecked: Number(countRows[0].n),
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
export async function buildAuditExportManifest(db, rows) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const verification = await verifyAuditChain(db, 0);
    return {
        fromSeq: first ? String(first['seq']) : '0',
        toSeq: last ? String(last['seq']) : '0',
        rowCount: rows.length,
        contentDigest: sha256Hex(JSON.stringify(rows)),
        startPrevHash: first ? first['prev_hash'] : null,
        endEntryHash: last ? last['entry_hash'] : null,
        chainIntact: verification.intact,
        generatedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=audit.js.map