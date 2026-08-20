/**
 * Settlement orchestration.
 *
 * This is where the state machine, the ledger and the partner adapters meet. Each
 * exported function does one step of the lifecycle, and each one:
 *
 *   - posts the journal the state machine declares for that edge,
 *   - takes the edge, linking the journal to the transition,
 *   - queues the notifications the edge declares,
 *
 * all inside the caller's single database transaction. If any part fails, none of it
 * happened. A transaction that has moved to `settled` without its settlement journal is
 * a discrepancy nobody would find until reconciliation, so the design refuses to allow it.
 */

import type { Queryable } from '../../db/pool.js';
import { one, maybeOne, many } from '../../db/pool.js';
import { Decimal, RATE_SCALE } from '../../core/money.js';
import { outboundIdempotencyKey } from '../../core/ids.js';
import { randomUUID } from 'node:crypto';
import { precondition, notFound, conflict } from '../../core/errors.js';
import { transition, type TransitionResult, type ActorType } from './machine.js';
import * as ledger from '../ledger/ledger.js';
import * as postings from '../ledger/postings.js';
import type { TransactionEconomics, PartnerRefs } from '../ledger/postings.js';
import {
  settlementAdapter, partnerByRole, type AdapterContext, type SettlementOutcome,
} from '../partners/adapters.js';
import { queueNotification } from '../notification/notify.js';
import { openExceptionCase } from '../recon/exceptions.js';

export interface Actor {
  type: ActorType;
  userId: string | null;
  role: string | null;
  permissions?: Set<never> | Set<string>;
  stepUpValid?: boolean;
}

interface TransactionRow {
  id: string;
  reference: string;
  organization_id: string;
  beneficiary_id: string;
  state: string;
  send_amount: string;
  send_currency: string;
  receive_currency: string;
  expected_receive_amount: string | null;
  fx_quote_id: string | null;
  initiated_by: string;
}

async function loadTransaction(db: Queryable, transactionId: string): Promise<TransactionRow> {
  const row = await maybeOne<TransactionRow>(
    db,
    `SELECT id, reference, organization_id, beneficiary_id, state, send_amount::text,
            send_currency, receive_currency, expected_receive_amount::text, fx_quote_id, initiated_by
       FROM transaction WHERE id = $1`,
    [transactionId],
  );
  if (!row) throw notFound('TRANSACTION_NOT_FOUND', 'Transaction not found.');
  return row;
}

/**
 * Assembles the economics of a transaction from its accepted quote. Every figure the
 * ledger will post comes from the quote record, not from a recomputation — recomputing
 * a fee at settlement time is how a customer ends up charged something they never saw.
 */
export async function economicsFor(db: Queryable, transactionId: string): Promise<TransactionEconomics> {
  const txn = await loadTransaction(db, transactionId);
  if (!txn.fx_quote_id) {
    throw precondition(
      'NO_ACCEPTED_QUOTE',
      'This transaction has no quote. Its economics are undefined until a quote is accepted.',
    );
  }
  const quote = await one<{
    send_amount: string; total_payable: string; expected_receivable: string;
    ekorails_fee: string; partner_fee: string; tax_or_levy: string;
    ekorails_fee_currency: string; provider_rate: string; status: string;
  }>(
    db,
    `SELECT send_amount::text, total_payable::text, expected_receivable::text,
            ekorails_fee::text, partner_fee::text, tax_or_levy::text,
            ekorails_fee_currency, provider_rate::text, status
       FROM fx_quote WHERE id = $1`,
    [txn.fx_quote_id],
  );

  return {
    transactionId: txn.id,
    transactionReference: txn.reference,
    organizationId: txn.organization_id,
    totalPayable: Decimal.fromString(quote.total_payable),
    principalSend: Decimal.fromString(quote.send_amount),
    principalReceive: Decimal.fromString(quote.expected_receivable),
    sendCurrency: txn.send_currency,
    receiveCurrency: txn.receive_currency,
    ekorailsFee: Decimal.fromString(quote.ekorails_fee),
    partnerFee: Decimal.fromString(quote.partner_fee),
    taxOrLevy: Decimal.fromString(quote.tax_or_levy),
    feeCurrency: quote.ekorails_fee_currency,
    rate: Decimal.fromString(quote.provider_rate, RATE_SCALE),
  };
}

async function resolvePartners(db: Queryable): Promise<PartnerRefs> {
  const origin = await partnerByRole(db, 'origin_bank');
  const settlement = await partnerByRole(db, 'settlement_institution');
  if (!origin || !settlement) {
    throw precondition(
      'PARTNER_NOT_CONFIGURED',
      'No origin or settlement partner is configured. Settlement cannot be routed without both.',
    );
  }
  return { originPartnerId: origin.id, settlementPartnerId: settlement.id };
}

async function notifyEdge(
  db: Queryable, result: TransitionResult, transactionId: string, organizationId: string,
): Promise<void> {
  const EVENT_BY_EDGE: Record<string, string> = {
    submit_for_approval: 'transaction_awaiting_approval',
    business_approve: 'compliance_review_required',
    compliance_request_information: 'additional_information_required',
    quote_issue: 'quote_issued',
    quote_accept: 'quote_issued',
    request_funding: 'quote_issued',
    funding_confirm: 'funding_confirmed',
    submit_to_partner: 'settlement_submitted',
    partner_settled: 'settlement_completed',
    partner_settled_immediate: 'settlement_completed',
    partner_rejected: 'settlement_failed',
    partner_failed: 'settlement_failed',
    partner_outcome_unknown: 'settlement_failed',
    partial_settlement: 'reconciliation_exception',
    payment_returned_from_settled: 'settlement_failed',
    payment_returned_after_confirmation: 'settlement_failed',
  };
  const eventType = EVENT_BY_EDGE[result.event];
  if (!eventType) return;

  for (const roleCode of result.definition.notifies) {
    await queueNotification(db, {
      organizationId,
      recipientRole: roleCode === 'initiator' ? null : roleCode,
      recipientUserId: roleCode === 'initiator'
        ? (await one<{ initiated_by: string }>(
            db, 'SELECT initiated_by FROM transaction WHERE id = $1', [transactionId],
          )).initiated_by
        : null,
      channel: 'in_app',
      eventType: eventType as never,
      transactionId,
      subject: `${result.reference}: ${result.to.replace(/_/g, ' ')}`,
      // Deliberately reference-only. No amounts, no beneficiary, no account details.
      body:
        `Transaction ${result.reference} moved to "${result.to.replace(/_/g, ' ')}". ` +
        `Sign in to view the detail.`,
      actionUrl: `/transactions/${transactionId}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle steps
// ---------------------------------------------------------------------------

/** Quote acceptance. Posts the obligation-recognition journal. */
export async function acceptQuoteAndRecogniseObligation(
  db: Queryable, transactionId: string, actor: Actor,
): Promise<{ transition: TransitionResult; journalReference: string }> {
  const econ = await economicsFor(db, transactionId);
  const journal = await postings.postObligationRecognition(db, econ, actor.userId);

  const result = await transition(db, {
    transactionId,
    event: 'quote_accept',
    actorType: actor.type,
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorPermissions: actor.permissions as never,
    stepUpValid: actor.stepUpValid ?? false,
    reason: `Quote accepted; obligation recognised in journal ${journal.reference}.`,
    evidence: {
      total_payable: econ.totalPayable.toString(),
      principal: econ.principalSend.toString(),
      expected_receivable: econ.principalReceive.toString(),
      rate: econ.rate.toString(),
    },
    journalId: journal.journalId,
  });

  await notifyEdge(db, result, transactionId, econ.organizationId);
  return { transition: result, journalReference: journal.reference };
}

/** Creates the funding instruction and moves to awaiting funding. */
export async function requestFunding(
  db: Queryable, transactionId: string, actor: Actor,
): Promise<TransitionResult> {
  const econ = await economicsFor(db, transactionId);
  const partners = await resolvePartners(db);

  await db.query(
    `INSERT INTO funding_instruction (
       transaction_id, organization_id, receiving_partner_id,
       expected_amount, expected_currency, payment_reference, status, is_simulated
     ) VALUES ($1,$2,$3,$4,$5,$6,'awaiting',true)
     ON CONFLICT DO NOTHING`,
    [
      transactionId, econ.organizationId, partners.originPartnerId,
      econ.totalPayable.toString(), econ.sendCurrency,
      `FUND-${econ.transactionReference}`,
    ],
  );

  const result = await transition(db, {
    transactionId,
    event: 'request_funding',
    actorType: actor.type,
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorPermissions: actor.permissions as never,
    stepUpValid: actor.stepUpValid ?? false,
    reason:
      `Funding instruction issued for ${econ.totalPayable.toString()} ${econ.sendCurrency}. ` +
      `Funds are payable to the origin partner institution, not to EKORails.`,
    evidence: { payment_reference: `FUND-${econ.transactionReference}` },
  });

  await notifyEdge(db, result, transactionId, econ.organizationId);
  return result;
}

/** Confirms funding through the partner adapter and posts the funding-receipt journal. */
export async function confirmFunding(
  db: Queryable, transactionId: string, actor: Actor,
): Promise<{ transition: TransitionResult | null; status: string; journalReference: string | null }> {
  const econ = await economicsFor(db, transactionId);
  const partners = await resolvePartners(db);
  const partner = await one<{ adapter_key: string }>(
    db, 'SELECT adapter_key FROM partner WHERE id = $1', [partners.originPartnerId],
  );

  const ctx: AdapterContext = {
    db, partnerId: partners.originPartnerId, transactionId,
    organizationId: econ.organizationId, correlationId: randomUUID(),
  };
  const adapter = settlementAdapter(partner.adapter_key);
  const confirmation = await adapter.confirmFunding(
    ctx, econ.totalPayable, econ.sendCurrency, `FUND-${econ.transactionReference}`,
  );

  if (confirmation.status === 'awaiting') {
    // Delayed funding is not a failure; it is a wait. The transaction stays where it is.
    await db.query(
      "UPDATE funding_instruction SET status = 'awaiting' WHERE transaction_id = $1", [transactionId],
    );
    return { transition: null, status: 'awaiting', journalReference: null };
  }

  const received = confirmation.receivedAmount ?? Decimal.zero();
  const isShort = received.lessThan(econ.totalPayable);

  await db.query(
    `UPDATE funding_instruction
        SET status = $2, received_amount = $3, received_currency = $4,
            confirmed_at = now(), confirmed_by = $5
      WHERE transaction_id = $1`,
    [
      transactionId, isShort ? 'short_funded' : 'confirmed',
      received.toString(), econ.sendCurrency, actor.userId,
    ],
  );

  const journal = await postings.postFundingReceipt(db, econ, partners, received, actor.userId);

  if (isShort) {
    // Short funding does not proceed. The receipt is recorded honestly and an exception
    // is raised, rather than settling an amount the customer did not fund.
    await openExceptionCase(db, {
      exceptionType: 'funding_discrepancy',
      transactionId,
      organizationId: econ.organizationId,
      partnerId: partners.originPartnerId,
      currency: econ.sendCurrency,
      amount: econ.totalPayable.subtract(received),
      priority: 'high',
      detail:
        `Expected ${econ.totalPayable.toString()} ${econ.sendCurrency}, received ${received.toString()}. ` +
        `Shortfall ${econ.totalPayable.subtract(received).toString()}. Settlement is not released on ` +
        `partial funding.`,
    });
    return { transition: null, status: 'short_funded', journalReference: journal.reference };
  }

  const result = await transition(db, {
    transactionId,
    event: 'funding_confirm',
    actorType: actor.type,
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorPermissions: actor.permissions as never,
    stepUpValid: actor.stepUpValid ?? false,
    reason: `Funding of ${received.toString()} ${econ.sendCurrency} confirmed at the origin partner (simulated).`,
    evidence: {
      partner_reference: confirmation.partnerReference,
      simulated: confirmation.isSimulated, scenario: confirmation.scenario,
    },
    journalId: journal.journalId,
  });

  await notifyEdge(db, result, transactionId, econ.organizationId);
  return { transition: result, status: 'confirmed', journalReference: journal.reference };
}

/**
 * Converts the obligation and positions liquidity. Two journals, both inside the same
 * database transaction as the state change.
 */
export async function prepareSettlement(
  db: Queryable, transactionId: string, actor: Actor,
): Promise<{ transition: TransitionResult; journalReferences: string[] }> {
  const econ = await economicsFor(db, transactionId);
  const partners = await resolvePartners(db);

  // Re-check compliance and beneficiary status: an approval given yesterday may have
  // been withdrawn since, and this is the last point before money moves.
  const guard = await one<{ compliance_ok: boolean; beneficiary_ok: boolean; org_ok: boolean }>(
    db,
    `SELECT
       EXISTS (SELECT 1 FROM transaction_transition tt
                WHERE tt.transaction_id = $1 AND tt.to_state = 'compliance_approved') AS compliance_ok,
       (SELECT b.status = 'approved' AND NOT b.requires_rereview
          FROM beneficiary b JOIN transaction t ON t.beneficiary_id = b.id
         WHERE t.id = $1) AS beneficiary_ok,
       (SELECT o.suspended_at IS NULL AND o.onboarding_status = 'approved'
          FROM organization o JOIN transaction t ON t.organization_id = o.id
         WHERE t.id = $1) AS org_ok`,
    [transactionId],
  );

  if (!guard.compliance_ok) {
    throw precondition('COMPLIANCE_APPROVAL_MISSING', 'This transaction has no recorded compliance approval.');
  }
  if (!guard.beneficiary_ok) {
    throw precondition(
      'BENEFICIARY_NO_LONGER_APPROVED',
      'The beneficiary is no longer approved or has been changed since approval. Settlement is blocked.',
    );
  }
  if (!guard.org_ok) {
    throw precondition(
      'ORGANISATION_NOT_ELIGIBLE',
      'The organisation is suspended or is no longer approved. Settlement is blocked.',
    );
  }

  const conversion = await postings.postFxConversion(db, econ, actor.userId);
  const positioning = await postings.postPartnerPositioning(db, econ, partners, actor.userId);

  await db.query(
    `INSERT INTO settlement_instruction (
       transaction_id, organization_id, partner_id, idempotency_key,
       instructed_amount, instructed_currency, status, is_simulated
     ) VALUES ($1,$2,$3,$4,$5,$6,'created',true)
     ON CONFLICT (partner_id, idempotency_key) DO NOTHING`,
    [
      transactionId, econ.organizationId, partners.settlementPartnerId,
      outboundIdempotencyKey(econ.transactionReference, 'settlement.submit'),
      econ.principalReceive.toString(), econ.receiveCurrency,
    ],
  );

  const result = await transition(db, {
    transactionId,
    event: 'prepare_settlement',
    actorType: actor.type,
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorPermissions: actor.permissions as never,
    stepUpValid: actor.stepUpValid ?? false,
    reason:
      `Obligation converted at ${econ.rate.toString()} and liquidity positioned with the settlement ` +
      `partner (simulated).`,
    evidence: {
      conversion_journal: conversion.reference,
      positioning_journal: positioning.reference,
      rate: econ.rate.toString(),
    },
    journalId: conversion.journalId,
  });

  await notifyEdge(db, result, transactionId, econ.organizationId);
  return { transition: result, journalReferences: [conversion.reference, positioning.reference] };
}

export interface SettlementSubmissionResult {
  outcome: SettlementOutcome;
  finalState: string;
  journalReferences: string[];
  exceptionReference: string | null;
}

/**
 * Submits the settlement instruction and applies whatever the partner reports.
 *
 * This function is where every partner failure mode is handled, and it is deliberately
 * long: each branch is a distinct real-world outcome with distinct accounting, and
 * collapsing them would hide the differences that matter.
 */
export async function submitSettlement(
  db: Queryable, transactionId: string, actor: Actor,
): Promise<SettlementSubmissionResult> {
  const econ = await economicsFor(db, transactionId);
  const partners = await resolvePartners(db);
  const journalReferences: string[] = [];
  let exceptionReference: string | null = null;

  const beneficiary = await one<{
    legal_name: string; country: string; last4: string; purpose: string;
  }>(
    db,
    `SELECT b.legal_name, b.country, a.identifier_last4 AS last4, b.payment_purpose AS purpose
       FROM beneficiary b JOIN bank_account a ON a.id = b.bank_account_id
       JOIN transaction t ON t.beneficiary_id = b.id
      WHERE t.id = $1`,
    [transactionId],
  );

  const partner = await one<{ adapter_key: string; display_name: string }>(
    db, 'SELECT adapter_key, display_name FROM partner WHERE id = $1', [partners.settlementPartnerId],
  );

  const idempotencyKey = outboundIdempotencyKey(econ.transactionReference, 'settlement.submit');

  // Take the submit edge BEFORE calling the partner. If we called first and then failed
  // to record the submission, a retry would send a second instruction.
  await transition(db, {
    transactionId,
    event: 'submit_to_partner',
    actorType: actor.type,
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorPermissions: actor.permissions as never,
    stepUpValid: actor.stepUpValid ?? false,
    reason: `Settlement instruction submitted to ${partner.display_name} (simulated) under key ${idempotencyKey}.`,
    evidence: { idempotency_key: idempotencyKey, partner: partner.display_name },
  });

  await db.query(
    `UPDATE settlement_instruction SET status = 'submitted', submitted_at = now(), released_by = $2
      WHERE transaction_id = $1 AND idempotency_key = $3`,
    [transactionId, actor.userId, idempotencyKey],
  );

  const ctx: AdapterContext = {
    db, partnerId: partners.settlementPartnerId, transactionId,
    organizationId: econ.organizationId, correlationId: randomUUID(),
  };

  const outcome = await settlementAdapter(partner.adapter_key).submitSettlement(ctx, {
    idempotencyKey,
    transactionReference: econ.transactionReference,
    amount: econ.principalReceive,
    currency: econ.receiveCurrency,
    beneficiaryName: beneficiary.legal_name,
    beneficiaryAccountLast4: beneficiary.last4,
    beneficiaryCountry: beneficiary.country,
    purpose: beneficiary.purpose,
  });

  await db.query(
    `UPDATE settlement_instruction
        SET status = $2, partner_reference = $3, failure_code = $4, failure_detail = $5,
            settled_amount = $6, settled_currency = $7,
            settled_at = CASE WHEN $2 IN ('settled','partially_settled') THEN now() ELSE NULL END
      WHERE transaction_id = $1 AND idempotency_key = $8`,
    [
      transactionId,
      outcome.status === 'duplicate_ignored' ? 'submitted' : outcome.status,
      outcome.partnerReference, outcome.failureCode, outcome.failureDetail,
      outcome.settledAmount?.toString() ?? null, outcome.settledCurrency,
      idempotencyKey,
    ],
  );

  let finalState = 'submitted_to_partner';

  switch (outcome.status) {
    case 'settled': {
      const journal = await postings.postSettlementPayment(
        db, econ, partners, outcome.settledAmount ?? econ.principalReceive, actor.userId,
      );
      journalReferences.push(journal.reference);
      await db.query(
        'UPDATE transaction SET actual_receive_amount = $2 WHERE id = $1',
        [transactionId, (outcome.settledAmount ?? econ.principalReceive).toString()],
      );
      const result = await transition(db, {
        transactionId, event: 'partner_settled_immediate', actorType: 'partner',
        actorPartnerId: partners.settlementPartnerId,
        reason:
          `Partner reported settlement of ${(outcome.settledAmount ?? econ.principalReceive).toString()} ` +
          `${econ.receiveCurrency} (simulated). This is a partner report of payment, not settlement finality.`,
        evidence: {
          partner_reference: outcome.partnerReference, simulated: true, scenario: outcome.scenario,
        },
        journalId: journal.journalId,
      });
      await notifyEdge(db, result, transactionId, econ.organizationId);
      finalState = 'settled';
      break;
    }

    case 'partially_settled': {
      const settled = outcome.settledAmount ?? Decimal.zero();
      const journal = await postings.postPartialSettlement(db, econ, partners, settled, actor.userId);
      journalReferences.push(journal.reference);
      await db.query(
        'UPDATE transaction SET actual_receive_amount = $2 WHERE id = $1',
        [transactionId, settled.toString()],
      );
      // Move to processing first: partial settlement is an edge from partner_processing.
      await transition(db, {
        transactionId, event: 'partner_accepted', actorType: 'partner',
        actorPartnerId: partners.settlementPartnerId,
        reason: 'Partner accepted the instruction before reporting a partial settlement.',
      });
      const result = await transition(db, {
        transactionId, event: 'partial_settlement', actorType: 'partner',
        actorPartnerId: partners.settlementPartnerId,
        reason:
          `Partner settled ${settled.toString()} of ${econ.principalReceive.toString()} ` +
          `${econ.receiveCurrency}. Shortfall parked in settlement suspense.`,
        evidence: { partner_reference: outcome.partnerReference, simulated: true },
        journalId: journal.journalId,
      });
      const exc = await openExceptionCase(db, {
        exceptionType: 'settlement_failure',
        transactionId, organizationId: econ.organizationId,
        partnerId: partners.settlementPartnerId,
        currency: econ.receiveCurrency,
        amount: econ.principalReceive.subtract(settled),
        priority: 'high',
        detail:
          `Partial settlement on ${econ.transactionReference}. Instructed ` +
          `${econ.principalReceive.toString()}, settled ${settled.toString()}. The shortfall is in ` +
          `settlement suspense and must be resolved with the partner.`,
      });
      exceptionReference = exc.reference;
      await notifyEdge(db, result, transactionId, econ.organizationId);
      finalState = 'under_investigation';
      break;
    }

    case 'returned': {
      const settlementJournal = await postings.postSettlementPayment(
        db, econ, partners, econ.principalReceive, actor.userId,
      );
      journalReferences.push(settlementJournal.reference);
      await transition(db, {
        transactionId, event: 'partner_settled_immediate', actorType: 'partner',
        actorPartnerId: partners.settlementPartnerId,
        reason: 'Partner settled the instruction before the destination institution returned it.',
        journalId: settlementJournal.journalId,
      });
      const returnJournal = await postings.postReturnReceipt(
        db, econ, partners, econ.principalReceive,
        outcome.failureDetail ?? 'Returned by destination institution', actor.userId,
      );
      journalReferences.push(returnJournal.reference);
      const result = await transition(db, {
        transactionId, event: 'payment_returned_from_settled', actorType: 'partner',
        actorPartnerId: partners.settlementPartnerId,
        reason: outcome.failureDetail ?? 'Payment returned by the destination institution.',
        evidence: { partner_reference: outcome.partnerReference, simulated: true },
        journalId: returnJournal.journalId,
      });
      const exc = await openExceptionCase(db, {
        exceptionType: 'settlement_failure',
        transactionId, organizationId: econ.organizationId,
        partnerId: partners.settlementPartnerId,
        currency: econ.receiveCurrency, amount: econ.principalReceive,
        priority: 'high',
        detail:
          `Payment returned on ${econ.transactionReference}. Funds are back with the settlement partner ` +
          `and a refund is owed to the customer. The original settlement journal stands.`,
      });
      exceptionReference = exc.reference;
      await notifyEdge(db, result, transactionId, econ.organizationId);
      finalState = 'returned';
      break;
    }

    case 'timeout': {
      // The instruction may or may not have executed. Park the amount in suspense and
      // raise an exception. Under no circumstances retry automatically.
      const suspense = await ledger.resolveAccount(db, {
        category: 'settlement_suspense', currency: econ.receiveCurrency,
      });
      const payable = await ledger.resolveAccount(db, {
        category: 'customer_settlement_payable', currency: econ.receiveCurrency,
        organizationId: econ.organizationId,
      });
      const journal = await ledger.post(db, {
        journalType: 'suspense_posting',
        transactionId, organizationId: econ.organizationId,
        description: `Unknown partner outcome on ${econ.transactionReference}`,
        plainEnglish:
          `We sent a settlement instruction and the partner did not respond. We do not know whether ` +
          `the payment was made. Until we do, the amount sits in settlement suspense rather than being ` +
          `treated as either paid or unpaid. This is the single most dangerous state in the system: ` +
          `retrying blindly could pay the beneficiary twice, and writing it off could leave them unpaid. ` +
          `A person must establish the true position with the partner before anything else happens.`,
        effectiveDate: new Date(),
        lines: [
          {
            accountId: suspense, direction: 'debit', amount: econ.principalReceive,
            currency: econ.receiveCurrency,
            narrative: `Unknown outcome held in suspense for ${econ.transactionReference}`,
          },
          {
            accountId: payable, direction: 'credit', amount: econ.principalReceive,
            currency: econ.receiveCurrency,
            narrative: `Obligation remains open pending confirmation on ${econ.transactionReference}`,
          },
        ],
        postedBy: actor.userId,
      });
      journalReferences.push(journal.reference);
      const result = await transition(db, {
        transactionId, event: 'partner_outcome_unknown', actorType: 'engine',
        reason:
          `Partner did not respond to instruction ${idempotencyKey}. Outcome UNKNOWN. Automatic retry ` +
          `is disabled for this state.`,
        evidence: { idempotency_key: idempotencyKey, simulated: true, scenario: outcome.scenario },
        journalId: journal.journalId,
      });
      const exc = await openExceptionCase(db, {
        exceptionType: 'unknown_partner_outcome',
        transactionId, organizationId: econ.organizationId,
        partnerId: partners.settlementPartnerId,
        currency: econ.receiveCurrency, amount: econ.principalReceive,
        priority: 'critical',
        detail:
          `Instruction ${idempotencyKey} timed out with no response. Establish with the partner whether ` +
          `the payment executed BEFORE taking any further action. Do not resubmit.`,
      });
      exceptionReference = exc.reference;
      await notifyEdge(db, result, transactionId, econ.organizationId);
      finalState = 'under_investigation';
      break;
    }

    case 'rejected':
    case 'failed': {
      // Nothing was paid. Unwind the positioning and the conversion.
      const positioningJournal = await maybeOne<{ id: string; reference: string }>(
        db,
        `SELECT id, reference FROM journal
          WHERE transaction_id = $1 AND journal_type = 'partner_positioning' AND posting_status = 'posted'
          ORDER BY posted_at DESC LIMIT 1`,
        [transactionId],
      );
      const conversionJournal = await maybeOne<{ id: string; reference: string }>(
        db,
        `SELECT id, reference FROM journal
          WHERE transaction_id = $1 AND journal_type = 'fx_conversion' AND posting_status = 'posted'
          ORDER BY posted_at DESC LIMIT 1`,
        [transactionId],
      );
      const reason = outcome.failureDetail ?? 'Partner rejected the settlement instruction.';
      if (positioningJournal) {
        const r = await ledger.reverse(db, {
          journalId: positioningJournal.id,
          reason: `Settlement failed: ${reason}`,
          postedBy: actor.userId,
        });
        journalReferences.push(r.reference);
      }
      if (conversionJournal) {
        const r = await ledger.reverse(db, {
          journalId: conversionJournal.id,
          reason: `Settlement failed: ${reason}`,
          postedBy: actor.userId,
        });
        journalReferences.push(r.reference);
      }
      const result = await transition(db, {
        transactionId, event: 'partner_rejected', actorType: 'partner',
        actorPartnerId: partners.settlementPartnerId,
        reason,
        evidence: {
          failure_code: outcome.failureCode, partner_reference: outcome.partnerReference,
          simulated: true, scenario: outcome.scenario,
        },
      });
      const exc = await openExceptionCase(db, {
        exceptionType: 'settlement_failure',
        transactionId, organizationId: econ.organizationId,
        partnerId: partners.settlementPartnerId,
        currency: econ.receiveCurrency, amount: econ.principalReceive,
        priority: 'high',
        detail: `Settlement rejected: ${outcome.failureCode ?? 'unspecified'}. ${reason}`,
      });
      exceptionReference = exc.reference;
      await notifyEdge(db, result, transactionId, econ.organizationId);
      finalState = 'failed';
      break;
    }

    case 'duplicate_ignored': {
      // A second submission of the same key. We already have a result; do not pay again.
      throw conflict(
        'DUPLICATE_SETTLEMENT_INSTRUCTION',
        'This settlement has already been instructed. A second instruction was not sent.',
        { idempotency_key: idempotencyKey, detail: outcome.failureDetail },
      );
    }

    case 'accepted':
    case 'processing':
    default: {
      const result = await transition(db, {
        transactionId, event: 'partner_accepted', actorType: 'partner',
        actorPartnerId: partners.settlementPartnerId,
        reason: 'Partner acknowledged the instruction and is processing it.',
        evidence: { partner_reference: outcome.partnerReference, simulated: true },
      });
      await notifyEdge(db, result, transactionId, econ.organizationId);
      finalState = 'partner_processing';
      break;
    }
  }

  return { outcome, finalState, journalReferences, exceptionReference };
}

/** The destination institution confirms the beneficiary was credited. */
export async function confirmBeneficiaryCredit(
  db: Queryable, transactionId: string, partnerId: string,
): Promise<TransitionResult> {
  const txn = await loadTransaction(db, transactionId);
  const result = await transition(db, {
    transactionId, event: 'beneficiary_confirm', actorType: 'partner',
    actorPartnerId: partnerId,
    reason: 'Destination institution confirmed the beneficiary account was credited (simulated).',
    evidence: { simulated: true },
  });
  await notifyEdge(db, result, transactionId, txn.organization_id);
  return result;
}

/** Settles the accrued partner fee and completes the transaction. */
export async function complete(
  db: Queryable, transactionId: string, actor: Actor,
): Promise<{ transition: TransitionResult; journalReference: string | null }> {
  const econ = await economicsFor(db, transactionId);
  const partners = await resolvePartners(db);

  const openBreaks = await one<{ n: string }>(
    db,
    `SELECT count(*)::text AS n FROM exception_case
      WHERE transaction_id = $1 AND status NOT IN ('resolved','written_off','closed_no_action')`,
    [transactionId],
  );
  if (Number(openBreaks.n) > 0) {
    throw precondition(
      'OPEN_EXCEPTION',
      `This transaction has ${openBreaks.n} open exception(s). It cannot be marked complete until they ` +
      `are resolved.`,
    );
  }

  const feeJournal = await postings.postPartnerFeePayment(db, econ, partners, actor.userId);

  const result = await transition(db, {
    transactionId, event: 'complete',
    actorType: actor.type, actorUserId: actor.userId, actorRole: actor.role,
    actorPermissions: actor.permissions as never,
    stepUpValid: actor.stepUpValid ?? false,
    reason: 'Reconciled with no open exceptions; partner fees settled.',
    journalId: feeJournal?.journalId ?? null,
  });

  await notifyEdge(db, result, transactionId, econ.organizationId);
  return { transition: result, journalReference: feeJournal?.reference ?? null };
}

/** The complete lifecycle view of one transaction, used by the timeline and walkthrough. */
export async function timeline(
  db: Queryable, transactionId: string,
): Promise<Record<string, unknown> | null> {
  // maybeOne, not one: a transaction that row-level security has filtered out is ABSENT
  // from this caller's point of view, and must produce a 404 rather than a 500. The
  // difference between those two status codes is itself an information leak.
  const txn = await maybeOne<Record<string, unknown>>(
    db,
    `SELECT t.id, t.reference, t.state, t.send_amount::text AS send_amount, t.send_currency,
            t.receive_currency, t.expected_receive_amount::text AS expected_receive_amount,
            t.actual_receive_amount::text AS actual_receive_amount, t.purpose, t.risk_rating,
            t.created_at, t.completed_at, t.invoice_number,
            o.legal_name AS organization_name, o.display_code AS organization_code,
            b.legal_name AS beneficiary_name, b.country AS beneficiary_country,
            c.code AS corridor_code, c.is_placeholder AS corridor_is_placeholder,
            iu.full_name AS initiated_by_name, au.full_name AS approved_by_name
       FROM transaction t
       JOIN organization o ON o.id = t.organization_id
       JOIN beneficiary b ON b.id = t.beneficiary_id
       JOIN corridor c ON c.id = t.corridor_id
       LEFT JOIN app_user iu ON iu.id = t.initiated_by
       LEFT JOIN app_user au ON au.id = t.approved_by
      WHERE t.id = $1`,
    [transactionId],
  );
  if (!txn) return null;

  const transitions = await many<Record<string, unknown>>(
    db,
    `SELECT tt.from_state, tt.to_state, tt.actor_type, tt.actor_role, tt.reason,
            tt.evidence, tt.occurred_at,
            u.full_name AS actor_name, p.display_name AS partner_name,
            j.reference AS journal_reference, j.plain_english AS journal_explanation
       FROM transaction_transition tt
       LEFT JOIN app_user u ON u.id = tt.actor_user_id
       LEFT JOIN partner p ON p.id = tt.actor_partner_id
       LEFT JOIN journal j ON j.id = tt.journal_id
      WHERE tt.transaction_id = $1 ORDER BY tt.occurred_at, tt.id`,
    [transactionId],
  );

  const journals = await ledger.journalsForTransaction(db, transactionId);

  const integrationEvents = await many<Record<string, unknown>>(
    db,
    `SELECT operation, direction, outcome, http_status, latency_ms, simulation_scenario,
            occurred_at, request_payload, response_payload
       FROM integration_event WHERE transaction_id = $1 ORDER BY occurred_at`,
    [transactionId],
  );

  const auditEvents = await many<Record<string, unknown>>(
    db,
    `SELECT seq::text AS seq, occurred_at, category, action, outcome, actor_role, reason
       FROM audit_event WHERE transaction_id = $1 ORDER BY seq`,
    [transactionId],
  );

  const notifications = await many<Record<string, unknown>>(
    db,
    `SELECT channel, event_type, subject, status, created_at
       FROM notification WHERE transaction_id = $1 ORDER BY created_at`,
    [transactionId],
  );

  const exceptions = await many<Record<string, unknown>>(
    db,
    `SELECT reference, exception_type, status, priority, amount::text AS amount, currency, opened_at
       FROM exception_case WHERE transaction_id = $1 ORDER BY opened_at`,
    [transactionId],
  );

  return {
    transaction: txn,
    transitions,
    journals,
    integration_events: integrationEvents,
    audit_events: auditEvents,
    notifications,
    exceptions,
  };
}
