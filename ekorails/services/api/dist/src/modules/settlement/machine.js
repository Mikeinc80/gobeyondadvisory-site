/**
 * The settlement state machine.
 *
 * A transaction's state is never assigned. It is transitioned, through a declared edge,
 * by an actor permitted to traverse that edge, with preconditions checked, a reason
 * recorded, an audit event written and any accounting consequence posted — all in one
 * database transaction.
 *
 * There is deliberately no "set state" function anywhere in this codebase. If an edge is
 * not declared in TRANSITIONS, it cannot happen.
 *
 * On the word "settled": `SETTLED` means the partner reported the payment as made.
 * `BENEFICIARY_CONFIRMED` means the destination confirmed receipt. Neither means
 * settlement FINALITY, which is a legal property conferred by a settlement system
 * operator and which nothing in this build can produce. See docs/07-transaction-states.md.
 */
import { one, many, maybeOne, advisoryLock, LOCK_NAMESPACE } from '../../db/pool.js';
import { recordAudit } from '../../audit/audit.js';
import { precondition, forbidden, notFound } from '../../core/errors.js';
/**
 * The complete edge list. A reviewer can read this and know every legal path a payment
 * can take through the system, including every way it can fail.
 */
export const TRANSITIONS = [
    {
        from: 'draft', to: 'pending_business_approval', event: 'submit_for_approval',
        permittedPermissions: ['txn.initiate'], permittedActorTypes: ['user'],
        preconditions: ['organisation approved', 'beneficiary approved', 'required documents linked'],
        accountingConsequence: 'none — nothing is owed until a quote is accepted',
        notifies: ['business_approver'], requiresStepUp: false,
        description: 'The person who created the payment sends it for a colleague to authorise. They cannot ' +
            'authorise it themselves; that is the maker-checker control.',
    },
    {
        from: 'pending_business_approval', to: 'pending_compliance', event: 'business_approve',
        permittedPermissions: ['txn.approve'], permittedActorTypes: ['user'],
        preconditions: ['approver is not the initiator', 'approver holds dual-authorisation permission'],
        accountingConsequence: 'none',
        notifies: ['compliance_analyst'], requiresStepUp: true,
        description: 'A second person at the customer authorises the payment. The database refuses this step if ' +
            'the approver is the same person who created it.',
    },
    {
        from: 'pending_business_approval', to: 'rejected', event: 'business_reject',
        permittedPermissions: ['txn.approve'], permittedActorTypes: ['user'],
        preconditions: ['written reason supplied'],
        accountingConsequence: 'none',
        notifies: ['initiator'], requiresStepUp: false,
        description: 'The second authoriser declines the payment. It ends here.',
    },
    {
        from: 'draft', to: 'cancelled', event: 'cancel_draft',
        permittedPermissions: ['txn.cancel'], permittedActorTypes: ['user'],
        preconditions: [],
        accountingConsequence: 'none',
        notifies: [], requiresStepUp: false,
        description: 'The customer abandons an unsubmitted payment.',
    },
    {
        from: 'pending_compliance', to: 'compliance_approved', event: 'compliance_approve',
        permittedPermissions: ['compliance.alert.clear'], permittedActorTypes: ['user'],
        preconditions: [
            'a risk assessment exists for this transaction',
            'no prohibited-severity rule is outstanding',
            'a written reason of at least 20 characters is supplied',
        ],
        accountingConsequence: 'none',
        notifies: ['treasury_operator', 'initiator'], requiresStepUp: false,
        description: 'A compliance analyst reviews the alerts the engine raised and clears the payment to proceed, ' +
            'recording why. The decision is written to an append-only table.',
    },
    {
        from: 'pending_compliance', to: 'additional_information_required', event: 'compliance_request_information',
        permittedPermissions: ['compliance.information.request'], permittedActorTypes: ['user'],
        preconditions: ['a written request is supplied'],
        accountingConsequence: 'none',
        notifies: ['initiator'], requiresStepUp: false,
        description: 'Compliance needs more from the customer before it can decide.',
    },
    {
        from: 'additional_information_required', to: 'pending_compliance', event: 'information_supplied',
        permittedPermissions: ['txn.initiate'], permittedActorTypes: ['user'],
        preconditions: ['at least one new document or message has been added'],
        accountingConsequence: 'none',
        notifies: ['compliance_analyst'], requiresStepUp: false,
        description: 'The customer supplies what compliance asked for, and the case returns to the queue.',
    },
    {
        from: 'pending_compliance', to: 'rejected', event: 'compliance_reject',
        permittedPermissions: ['compliance.alert.clear'], permittedActorTypes: ['user'],
        preconditions: ['a written reason of at least 20 characters is supplied'],
        accountingConsequence: 'none',
        notifies: ['initiator'], requiresStepUp: false,
        description: 'Compliance declines the payment. The reason is recorded permanently.',
    },
    {
        from: 'pending_compliance', to: 'under_investigation', event: 'compliance_suspend',
        permittedPermissions: ['txn.suspend'], permittedActorTypes: ['user'],
        preconditions: ['a written reason is supplied'],
        accountingConsequence: 'none',
        notifies: ['compliance_manager'], requiresStepUp: false,
        description: 'A sanctions or serious alert suspends the payment pending investigation. It does not proceed ' +
            'and it is not rejected — it waits for a decision.',
    },
    {
        from: 'under_investigation', to: 'pending_compliance', event: 'investigation_cleared',
        permittedPermissions: ['compliance.highrisk.approve'], permittedActorTypes: ['user'],
        preconditions: ['a manager decision is recorded'],
        accountingConsequence: 'none',
        notifies: ['compliance_analyst'], requiresStepUp: true,
        description: 'A manager concludes the investigation and returns the payment to the normal queue.',
    },
    {
        from: 'under_investigation', to: 'rejected', event: 'investigation_rejected',
        permittedPermissions: ['compliance.highrisk.approve'], permittedActorTypes: ['user'],
        preconditions: ['a manager decision with a written reason is recorded'],
        accountingConsequence: 'none',
        notifies: ['initiator', 'compliance_manager'], requiresStepUp: true,
        description: 'The investigation concludes that the payment must not proceed.',
    },
    {
        from: 'compliance_approved', to: 'quote_issued', event: 'quote_issue',
        permittedPermissions: ['fx.quote.issue'], permittedActorTypes: ['user', 'job'],
        preconditions: ['compliance approval is recorded', 'a rate source is available'],
        accountingConsequence: 'none — an indicative quote creates no obligation',
        notifies: ['initiator', 'business_approver'], requiresStepUp: false,
        description: 'Treasury issues a price. Until the customer accepts it, it is indicative and nothing is owed ' +
            'by anyone.',
    },
    {
        from: 'quote_issued', to: 'quote_accepted', event: 'quote_accept',
        permittedPermissions: ['fx.quote.accept'], permittedActorTypes: ['user'],
        preconditions: ['the quote has not expired'],
        accountingConsequence: 'OBLIGATION RECOGNITION: Dr customer funding receivable; Cr customer settlement payable, ' +
            'fee revenue, partner fees payable and any levy',
        notifies: ['treasury_operator', 'initiator'], requiresStepUp: true,
        description: 'The customer accepts the price. This is the moment obligations come into existence in both ' +
            'directions, and the first journal is posted.',
    },
    {
        from: 'quote_issued', to: 'expired', event: 'quote_expire',
        permittedPermissions: [], permittedActorTypes: ['job'],
        preconditions: ['the quote validity window has elapsed'],
        accountingConsequence: 'none',
        notifies: ['initiator'], requiresStepUp: false,
        description: 'Nobody accepted the price in time. A stale rate is not a price, so the payment lapses.',
    },
    {
        from: 'quote_accepted', to: 'awaiting_funding', event: 'request_funding',
        permittedPermissions: ['treasury.funding.review'], permittedActorTypes: ['user', 'job'],
        preconditions: ['an obligation journal has been posted'],
        accountingConsequence: 'none',
        notifies: ['initiator'], requiresStepUp: false,
        description: 'The customer is told where to send the funds. Note the destination is the partner institution, ' +
            'not EKORails.',
    },
    {
        from: 'awaiting_funding', to: 'funding_confirmed', event: 'funding_confirm',
        permittedPermissions: ['treasury.funding.review'], permittedActorTypes: ['user', 'partner', 'job'],
        preconditions: ['the partner reports funds received in the expected currency'],
        accountingConsequence: 'FUNDING RECEIPT: Dr partner funding account; Cr customer funding receivable',
        notifies: ['initiator', 'treasury_operator'], requiresStepUp: false,
        description: 'The funds arrive at the origin partner. The ledger records them as sitting with the partner, ' +
            'because that is where they are.',
    },
    {
        from: 'awaiting_funding', to: 'expired', event: 'funding_window_expired',
        permittedPermissions: [], permittedActorTypes: ['job'],
        preconditions: ['the funding window has elapsed without receipt'],
        accountingConsequence: 'REVERSAL of the obligation recognition journal',
        notifies: ['initiator'], requiresStepUp: false,
        description: 'The customer did not fund in time. The obligation is reversed rather than deleted, so the ' +
            'ledger shows both that it existed and that it was undone.',
    },
    {
        from: 'awaiting_funding', to: 'cancelled', event: 'cancel_before_funding',
        permittedPermissions: ['txn.cancel'], permittedActorTypes: ['user'],
        preconditions: ['no funding has been received'],
        accountingConsequence: 'REVERSAL of the obligation recognition journal',
        notifies: ['treasury_operator'], requiresStepUp: false,
        description: 'The customer withdraws before paying. The obligation is reversed.',
    },
    {
        from: 'funding_confirmed', to: 'ready_for_settlement', event: 'prepare_settlement',
        permittedPermissions: ['treasury.settlement.route'], permittedActorTypes: ['user', 'job'],
        preconditions: [
            'funding is fully received',
            'compliance approval is still valid',
            'the beneficiary is still approved',
        ],
        accountingConsequence: 'FX CONVERSION and PARTNER POSITIONING: the obligation changes currency through FX clearing, ' +
            'and liquidity moves from the origin partner to the settlement partner',
        notifies: ['treasury_operator'], requiresStepUp: false,
        description: 'Treasury converts the obligation and positions the funds. After this the FX clearing account ' +
            'should be back to zero; if it is not, we have an open position and the dashboard says so.',
    },
    {
        from: 'ready_for_settlement', to: 'submitted_to_partner', event: 'submit_to_partner',
        permittedPermissions: ['treasury.settlement.route'], permittedActorTypes: ['user', 'job'],
        preconditions: [
            'an idempotency key has been claimed for this instruction',
            'the transaction has not previously been submitted',
        ],
        accountingConsequence: 'none — instructing is not paying',
        notifies: ['treasury_operator'], requiresStepUp: true,
        description: 'The settlement instruction goes to the partner, carrying an idempotency key derived from the ' +
            'transaction reference so the same instruction can never become two payments.',
    },
    {
        from: 'submitted_to_partner', to: 'partner_processing', event: 'partner_accepted',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job'],
        preconditions: ['the partner acknowledged the instruction'],
        accountingConsequence: 'none',
        notifies: [], requiresStepUp: false,
        description: 'The partner has the instruction and is working on it.',
    },
    {
        from: 'partner_processing', to: 'settled', event: 'partner_settled',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job'],
        preconditions: ['the partner reported settlement of the full instructed amount'],
        accountingConsequence: 'SETTLEMENT PAYMENT: Dr customer settlement payable; Cr partner settlement account',
        notifies: ['initiator', 'treasury_operator'], requiresStepUp: false,
        description: 'The partner reports the payment as made. This discharges our obligation. It is not settlement ' +
            'finality, which no simulator can confer.',
    },
    {
        from: 'submitted_to_partner', to: 'settled', event: 'partner_settled_immediate',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job'],
        preconditions: ['the partner reported settlement without a separate acceptance step'],
        accountingConsequence: 'SETTLEMENT PAYMENT: Dr customer settlement payable; Cr partner settlement account',
        notifies: ['initiator', 'treasury_operator'], requiresStepUp: false,
        description: 'Some partners settle synchronously. This is the same edge without the interim state.',
    },
    {
        from: 'submitted_to_partner', to: 'under_investigation', event: 'partner_outcome_unknown',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job', 'engine'],
        preconditions: ['the partner did not respond and the outcome is genuinely unknown'],
        accountingConsequence: 'SUSPENSE POSTING: the instructed amount moves to settlement suspense until the outcome is known',
        notifies: ['treasury_operator', 'finance_analyst'], requiresStepUp: false,
        description: 'The most dangerous state in the system. We sent an instruction and never learned whether it ' +
            'was executed. It is NEVER retried automatically — a blind retry here is how a duplicate ' +
            'payment happens. A human must establish the true position with the partner first.',
    },
    {
        from: 'submitted_to_partner', to: 'failed', event: 'partner_rejected',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job'],
        preconditions: ['the partner rejected the instruction with a reason'],
        accountingConsequence: 'REVERSAL of the FX conversion and partner positioning journals',
        notifies: ['treasury_operator', 'initiator'], requiresStepUp: false,
        description: 'The partner refused the instruction — insufficient liquidity, an invalid beneficiary, or its ' +
            'own compliance decision. The positioning is unwound.',
    },
    {
        from: 'partner_processing', to: 'failed', event: 'partner_failed',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job'],
        preconditions: ['the partner reported failure after accepting'],
        accountingConsequence: 'REVERSAL of the FX conversion and partner positioning journals',
        notifies: ['treasury_operator', 'initiator'], requiresStepUp: false,
        description: 'The partner accepted and then could not complete.',
    },
    {
        from: 'partner_processing', to: 'under_investigation', event: 'partial_settlement',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job'],
        preconditions: ['the partner settled less than the instructed amount'],
        accountingConsequence: 'PARTIAL SETTLEMENT: the paid portion discharges the obligation; the shortfall goes to ' +
            'settlement suspense',
        notifies: ['treasury_operator', 'finance_analyst'], requiresStepUp: false,
        description: 'The partner paid part of the instruction. The shortfall is not written off and is not treated ' +
            'as complete; it sits in suspense with an owner until it is explained.',
    },
    {
        from: 'settled', to: 'beneficiary_confirmed', event: 'beneficiary_confirm',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job'],
        preconditions: ['the destination institution confirmed the credit'],
        accountingConsequence: 'none — the accounting completed at settlement',
        notifies: ['initiator'], requiresStepUp: false,
        description: 'The destination bank confirms the beneficiary was credited.',
    },
    {
        from: 'settled', to: 'returned', event: 'payment_returned_from_settled',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job'],
        preconditions: ['the destination institution returned the funds'],
        accountingConsequence: 'RETURN RECEIPT: Dr partner settlement account; Cr returned funds. The original settlement ' +
            'journal is NOT reversed — the payment did happen.',
        notifies: ['initiator', 'treasury_operator', 'finance_analyst'], requiresStepUp: false,
        description: 'The funds came back. The original payment is not erased: a return is a new event, and the ' +
            'ledger shows both.',
    },
    {
        from: 'beneficiary_confirmed', to: 'returned', event: 'payment_returned_after_confirmation',
        permittedPermissions: [], permittedActorTypes: ['partner', 'job'],
        preconditions: ['the destination institution returned the funds after confirming'],
        accountingConsequence: 'RETURN RECEIPT: Dr partner settlement account; Cr returned funds',
        notifies: ['initiator', 'treasury_operator', 'finance_analyst'], requiresStepUp: false,
        description: 'A return that arrives after the credit was confirmed.',
    },
    {
        from: 'beneficiary_confirmed', to: 'reconciled', event: 'reconcile',
        permittedPermissions: ['recon.run'], permittedActorTypes: ['user', 'job'],
        preconditions: ['the transaction matched cleanly to both the ledger and the partner statement'],
        accountingConsequence: 'none, where the reconciliation matched',
        notifies: [], requiresStepUp: false,
        description: 'Our records, the ledger and the partner\'s statement all agree. Only then is the payment ' +
            'considered reconciled.',
    },
    {
        from: 'settled', to: 'reconciled', event: 'reconcile_without_confirmation',
        permittedPermissions: ['recon.run'], permittedActorTypes: ['user', 'job'],
        preconditions: [
            'the transaction matched to the ledger and the partner statement',
            'the destination confirmation is not available from this partner',
        ],
        accountingConsequence: 'none, where the reconciliation matched',
        notifies: [], requiresStepUp: false,
        description: 'Some partners never send a beneficiary confirmation. Reconciliation can still complete, and ' +
            'the absence of confirmation is recorded rather than assumed away.',
    },
    {
        from: 'reconciled', to: 'completed', event: 'complete',
        permittedPermissions: ['recon.run'], permittedActorTypes: ['user', 'job'],
        preconditions: ['reconciliation is complete and no break is open against this transaction'],
        accountingConsequence: 'PARTNER FEE PAYMENT, where a partner fee was accrued',
        notifies: ['initiator'], requiresStepUp: false,
        description: 'The payment is finished: delivered, reconciled and with all fees settled.',
    },
    {
        from: 'failed', to: 'under_investigation', event: 'escalate_failure',
        permittedPermissions: ['treasury.exception.read'], permittedActorTypes: ['user'],
        preconditions: ['a written reason is supplied'],
        accountingConsequence: 'none',
        notifies: ['finance_analyst'], requiresStepUp: false,
        description: 'A failure that needs more than a retry is escalated for investigation.',
    },
    {
        from: 'under_investigation', to: 'failed', event: 'investigation_confirms_failure',
        permittedPermissions: ['treasury.exception.read'], permittedActorTypes: ['user'],
        preconditions: ['the true position has been established with the partner', 'a written reason is supplied'],
        accountingConsequence: 'REVERSAL of positioning journals, where nothing was paid',
        notifies: ['treasury_operator', 'finance_analyst'], requiresStepUp: true,
        description: 'Investigation established that no payment was made. Only now may the positioning be unwound.',
    },
    {
        from: 'under_investigation', to: 'settled', event: 'investigation_confirms_settlement',
        permittedPermissions: ['treasury.exception.read'], permittedActorTypes: ['user'],
        preconditions: ['the partner confirmed the payment was in fact made', 'a written reason is supplied'],
        accountingConsequence: 'SETTLEMENT PAYMENT, and release of any suspense balance raised for the unknown outcome',
        notifies: ['treasury_operator', 'finance_analyst'], requiresStepUp: true,
        description: 'Investigation established that the payment did go out after all. The suspense entry is cleared ' +
            'and the settlement is recorded properly.',
    },
    {
        from: 'returned', to: 'under_investigation', event: 'investigate_return',
        permittedPermissions: ['treasury.exception.read'], permittedActorTypes: ['user'],
        preconditions: ['a written reason is supplied'],
        accountingConsequence: 'none',
        notifies: ['finance_analyst'], requiresStepUp: false,
        description: 'A returned payment is investigated before the customer is refunded.',
    },
];
export class InvalidTransitionError extends Error {
    code = 'INVALID_TRANSITION';
    constructor(from, to, reference) {
        super(`No transition from "${from}" to "${to}" exists for ${reference}. ` +
            `A transaction state is never assigned directly; it is only ever moved along a declared edge.`);
        this.name = 'InvalidTransitionError';
    }
}
export function findTransition(from, event) {
    return TRANSITIONS.find((t) => t.from === from && t.event === event);
}
export function transitionsFrom(state) {
    return TRANSITIONS.filter((t) => t.from === state);
}
export const TERMINAL_STATES = [
    'completed', 'rejected', 'cancelled', 'expired',
];
/**
 * Takes an edge. Everything this function does happens inside the caller's database
 * transaction: the state change, the transition record, the audit event and any journal
 * the caller posted either all commit or none of them do.
 */
export async function transition(db, req) {
    // Serialise concurrent attempts on the same transaction. Without this, two operators
    // clicking "settle" at the same moment could both pass the state check.
    await advisoryLock(db, LOCK_NAMESPACE.transaction, req.transactionId);
    const txn = await maybeOne(db, 'SELECT id, reference, state, organization_id, initiated_by FROM transaction WHERE id = $1', [req.transactionId]);
    if (!txn)
        throw notFound('TRANSACTION_NOT_FOUND', 'Transaction not found.');
    const definition = findTransition(txn.state, req.event);
    if (!definition) {
        const available = transitionsFrom(txn.state).map((t) => t.event);
        await recordAudit(db, {
            category: 'settlement_transition', action: `transition.${req.event}`, outcome: 'denied',
            actorUserId: req.actorUserId ?? null, actorRole: req.actorRole ?? null,
            actorType: req.actorType === 'engine' ? 'system' : req.actorType,
            organizationId: txn.organization_id, transactionId: txn.id,
            entityType: 'transaction', entityId: txn.id,
            metadata: { from: txn.state, attempted_event: req.event, available_events: available },
        });
        throw precondition('INVALID_TRANSITION', `Cannot "${req.event}" a transaction in state "${txn.state}".`, { current_state: txn.state, available_events: available });
    }
    // Actor type must be permitted for this edge.
    if (!definition.permittedActorTypes.includes(req.actorType)) {
        await denyAndAudit(db, txn, req, `actor type "${req.actorType}" may not take this edge`);
        throw forbidden('ACTOR_TYPE_NOT_PERMITTED', `This step cannot be performed by a ${req.actorType}.`, `edge ${definition.from}->${definition.to} permits ${definition.permittedActorTypes.join(', ')}`);
    }
    // A user actor must hold at least one of the edge's permissions.
    if (req.actorType === 'user' && definition.permittedPermissions.length > 0) {
        const held = req.actorPermissions ?? new Set();
        const ok = definition.permittedPermissions.some((p) => held.has(p));
        if (!ok) {
            await denyAndAudit(db, txn, req, 'actor lacks the required permission');
            throw forbidden('PERMISSION_DENIED', 'You do not have permission to perform this step.', `requires one of: ${definition.permittedPermissions.join(', ')}`);
        }
    }
    // Edges flagged for step-up require a recently re-asserted second factor.
    if (definition.requiresStepUp && req.actorType === 'user' && req.stepUpValid !== true) {
        await denyAndAudit(db, txn, req, 'step-up authentication not satisfied');
        throw forbidden('STEP_UP_REQUIRED', 'Confirm your identity with your authenticator to perform this step.', `edge ${definition.event} requires step-up`);
    }
    if (req.reason.trim().length === 0) {
        throw precondition('REASON_REQUIRED', 'Every state change requires a reason.');
    }
    // Segregation of duties on the business approval edge, checked here as well as by the
    // database trigger on transaction_approval.
    if (definition.event === 'business_approve' && req.actorUserId === txn.initiated_by) {
        await denyAndAudit(db, txn, req, 'self-approval attempt');
        throw forbidden('SEGREGATION_OF_DUTIES', 'You initiated this transaction and cannot also authorise it.', 'maker-checker');
    }
    await db.query('UPDATE transaction SET state = $2 WHERE id = $1', [txn.id, definition.to]);
    if (definition.to === 'completed') {
        await db.query('UPDATE transaction SET completed_at = now() WHERE id = $1', [txn.id]);
    }
    const transitionRow = await one(db, `INSERT INTO transaction_transition (
       transaction_id, organization_id, from_state, to_state, actor_type,
       actor_user_id, actor_role, actor_partner_id, reason, evidence, journal_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     RETURNING id::text AS id`, [
        txn.id, txn.organization_id, definition.from, definition.to, req.actorType,
        req.actorUserId ?? null, req.actorRole ?? null, req.actorPartnerId ?? null,
        req.reason, JSON.stringify(req.evidence ?? {}), req.journalId ?? null,
    ]);
    await recordAudit(db, {
        category: 'settlement_transition',
        action: `transition.${definition.event}`,
        outcome: 'success',
        actorUserId: req.actorUserId ?? null,
        actorRole: req.actorRole ?? null,
        actorType: req.actorType === 'engine' ? 'system' : req.actorType,
        organizationId: txn.organization_id,
        entityType: 'transaction',
        entityId: txn.id,
        transactionId: txn.id,
        oldValues: { state: definition.from },
        newValues: { state: definition.to },
        reason: req.reason,
        metadata: {
            event: definition.event,
            accounting_consequence: definition.accountingConsequence,
            journal_id: req.journalId ?? null,
            notifies: definition.notifies,
        },
    });
    return {
        transactionId: txn.id,
        reference: txn.reference,
        from: definition.from,
        to: definition.to,
        event: definition.event,
        transitionId: transitionRow.id,
        definition,
    };
}
async function denyAndAudit(db, txn, req, detail) {
    await recordAudit(db, {
        category: 'authorisation',
        action: `transition.${req.event}`,
        outcome: 'denied',
        actorUserId: req.actorUserId ?? null,
        actorRole: req.actorRole ?? null,
        actorType: req.actorType === 'engine' ? 'system' : req.actorType,
        organizationId: txn.organization_id,
        entityType: 'transaction',
        entityId: txn.id,
        transactionId: txn.id,
        metadata: { from: txn.state, event: req.event, denial_reason: detail },
    });
}
/** The full transition history of one transaction. Powers the timeline and the walkthrough. */
export async function history(db, transactionId) {
    return many(db, `SELECT t.id::text AS id, t.from_state, t.to_state, t.actor_type, t.actor_role,
            t.reason, t.evidence, t.journal_id, t.occurred_at,
            u.full_name AS actor_name, u.display_name AS actor_display_name,
            p.display_name AS partner_name,
            j.reference AS journal_reference, j.plain_english AS journal_explanation
       FROM transaction_transition t
       LEFT JOIN app_user u ON u.id = t.actor_user_id
       LEFT JOIN partner p ON p.id = t.actor_partner_id
       LEFT JOIN journal j ON j.id = t.journal_id
      WHERE t.transaction_id = $1
      ORDER BY t.occurred_at, t.id`, [transactionId]);
}
/** Machine description for documentation, the regulator view and the Learning Center. */
export function describeStateMachine() {
    const states = new Set();
    for (const t of TRANSITIONS) {
        states.add(t.from);
        states.add(t.to);
    }
    return [...states].sort().map((state) => ({
        state,
        is_terminal: TERMINAL_STATES.includes(state),
        outbound_transitions: transitionsFrom(state).map((t) => ({
            event: t.event,
            to: t.to,
            permitted_roles_by_permission: t.permittedPermissions,
            permitted_actor_types: t.permittedActorTypes,
            preconditions: t.preconditions,
            accounting_consequence: t.accountingConsequence,
            notifies: t.notifies,
            requires_step_up: t.requiresStepUp,
            description: t.description,
        })),
    }));
}
//# sourceMappingURL=machine.js.map