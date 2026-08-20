/**
 * Reconciliation.
 *
 * The purpose of reconciliation is to find out where two independently-derived views of
 * the same events disagree. That only works if the two views really are independent, so:
 *
 *   - The partner statement is produced by the partner simulator from ITS OWN record of
 *     what it did (the integration events), not from our ledger. The
 *     `reconciliation_mismatch` scenario makes the partner genuinely wrong, and the run
 *     genuinely catches it.
 *   - A difference is never "fixed" by overwriting one side. It becomes a break, with an
 *     owner, an age and a resolution that is itself journalised.
 *
 * Six run types are implemented, matching the brief: transaction-to-ledger,
 * ledger-to-partner-statement, funding, settlement, fees and currency position.
 */
import { one, many, maybeOne } from '../../db/pool.js';
import { Decimal } from '../../core/money.js';
import { nextReference } from '../../core/ids.js';
import { recordAudit } from '../../audit/audit.js';
import { openExceptionCase } from './exceptions.js';
import * as ledger from '../ledger/ledger.js';
import { randomUUID } from 'node:crypto';
import { settlementAdapter } from '../partners/adapters.js';
import { sha256Hex } from '../../core/crypto.js';
async function beginRun(db, runType, businessDate, options) {
    const reference = await nextReference(db, 'reconciliation');
    const row = await one(db, `INSERT INTO reconciliation_run (
       reference, run_type, business_date, partner_id, currency, status, started_by
     ) VALUES ($1,$2,$3,$4,$5,'running',$6)
     RETURNING id`, [
        reference, runType, businessDate.toISOString().slice(0, 10),
        options.partnerId ?? null, options.currency ?? null, options.startedBy,
    ]);
    return {
        db, runId: row.id, reference, businessDate, startedBy: options.startedBy,
        items: 0, matched: 0, broken: 0, byResult: {}, breaksOpened: [],
    };
}
async function addItem(ctx, item) {
    const row = await one(ctx.db, `INSERT INTO reconciliation_item (
       run_id, internal_ref, internal_kind, internal_id, internal_amount, internal_currency, internal_date,
       external_ref, external_id, external_amount, external_currency, external_date,
       result, difference_amount, difference_currency, detail
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING id`, [
        ctx.runId, item.internalRef ?? null, item.internalKind ?? null, item.internalId ?? null,
        item.internalAmount?.toString() ?? null, item.internalCurrency ?? null, item.internalDate ?? null,
        item.externalRef ?? null, item.externalId ?? null,
        item.externalAmount?.toString() ?? null, item.externalCurrency ?? null, item.externalDate ?? null,
        item.result, item.difference?.toString() ?? null, item.differenceCurrency ?? null, item.detail,
    ]);
    ctx.items += 1;
    ctx.byResult[item.result] = (ctx.byResult[item.result] ?? 0) + 1;
    if (item.result === 'matched') {
        ctx.matched += 1;
    }
    else {
        ctx.broken += 1;
        const exc = await openExceptionCase(ctx.db, {
            exceptionType: 'reconciliation_break',
            reconciliationItemId: row.id,
            transactionId: item.transactionId ?? null,
            organizationId: item.organizationId ?? null,
            partnerId: item.partnerId ?? null,
            currency: item.differenceCurrency ?? item.internalCurrency ?? null,
            amount: item.difference ?? null,
            priority: item.breakPriority ?? 'normal',
            detail: `${ctx.reference} (${item.result}): ${item.detail}`,
        });
        ctx.breaksOpened.push(exc.reference);
    }
    return row.id;
}
async function finishRun(ctx, unexplained, currency) {
    const status = ctx.broken > 0 ? 'completed_with_breaks' : 'completed';
    await ctx.db.query(`UPDATE reconciliation_run
        SET status = $2, finished_at = now(), items_total = $3, items_matched = $4,
            items_broken = $5, unexplained_amount = $6
      WHERE id = $1`, [ctx.runId, status, ctx.items, ctx.matched, ctx.broken, unexplained?.toString() ?? null]);
    await recordAudit(ctx.db, {
        category: 'data_create',
        action: 'reconciliation.run',
        outcome: 'success',
        actorUserId: ctx.startedBy,
        actorType: ctx.startedBy ? 'user' : 'job',
        entityType: 'reconciliation_run',
        entityId: ctx.runId,
        metadata: {
            reference: ctx.reference, status, items: ctx.items, matched: ctx.matched,
            broken: ctx.broken, by_result: ctx.byResult, breaks_opened: ctx.breaksOpened,
            unexplained: unexplained?.toString() ?? null,
        },
    });
    const run = await one(ctx.db, 'SELECT run_type, business_date FROM reconciliation_run WHERE id = $1', [ctx.runId]);
    return {
        runId: ctx.runId,
        reference: ctx.reference,
        runType: run.run_type,
        businessDate: run.business_date.toISOString().slice(0, 10),
        status,
        itemsTotal: ctx.items,
        itemsMatched: ctx.matched,
        itemsBroken: ctx.broken,
        unexplainedAmount: unexplained?.toString() ?? null,
        currency,
        breaksOpened: ctx.breaksOpened,
        byResult: ctx.byResult,
    };
}
// ---------------------------------------------------------------------------
// Run 1 — transaction to ledger
// ---------------------------------------------------------------------------
/**
 * Every transaction that has reached a state with accounting consequences must have the
 * journals that state declares. A settled transaction with no settlement journal is a
 * silent hole in the books, and this run is what finds it.
 */
export async function reconcileTransactionToLedger(db, businessDate, startedBy) {
    const ctx = await beginRun(db, 'transaction_to_ledger', businessDate, { startedBy });
    const REQUIRED_JOURNALS = {
        quote_accepted: ['obligation_recognition'],
        awaiting_funding: ['obligation_recognition'],
        funding_confirmed: ['obligation_recognition', 'funding_receipt'],
        ready_for_settlement: ['obligation_recognition', 'funding_receipt', 'fx_conversion', 'partner_positioning'],
        submitted_to_partner: ['obligation_recognition', 'funding_receipt', 'fx_conversion', 'partner_positioning'],
        partner_processing: ['obligation_recognition', 'funding_receipt', 'fx_conversion', 'partner_positioning'],
        settled: ['obligation_recognition', 'funding_receipt', 'fx_conversion', 'partner_positioning', 'settlement_payment'],
        beneficiary_confirmed: ['obligation_recognition', 'funding_receipt', 'fx_conversion', 'partner_positioning', 'settlement_payment'],
        reconciled: ['obligation_recognition', 'funding_receipt', 'fx_conversion', 'partner_positioning', 'settlement_payment'],
        completed: ['obligation_recognition', 'funding_receipt', 'fx_conversion', 'partner_positioning', 'settlement_payment'],
    };
    const transactions = await many(db, `SELECT t.id, t.reference, t.state, t.organization_id, t.send_amount::text,
            t.send_currency, t.created_at,
            (SELECT array_agg(DISTINCT j.journal_type)
               FROM journal j
              WHERE j.transaction_id = t.id AND j.posting_status = 'posted') AS journal_types
       FROM transaction t
      WHERE t.state = ANY($1::text[])
      ORDER BY t.created_at`, [Object.keys(REQUIRED_JOURNALS)]);
    for (const txn of transactions) {
        const present = new Set(txn.journal_types ?? []);
        const required = REQUIRED_JOURNALS[txn.state] ?? [];
        const missing = required.filter((r) => !present.has(r));
        if (missing.length === 0) {
            await addItem(ctx, {
                result: 'matched',
                internalRef: txn.reference, internalKind: 'transaction', internalId: txn.id,
                internalAmount: Decimal.fromString(txn.send_amount), internalCurrency: txn.send_currency,
                internalDate: txn.created_at,
                detail: `State "${txn.state}" has all ${required.length} required journal type(s).`,
                transactionId: txn.id, organizationId: txn.organization_id,
            });
        }
        else {
            await addItem(ctx, {
                result: 'missing_internal_record',
                internalRef: txn.reference, internalKind: 'transaction', internalId: txn.id,
                internalAmount: Decimal.fromString(txn.send_amount), internalCurrency: txn.send_currency,
                internalDate: txn.created_at,
                difference: Decimal.fromString(txn.send_amount), differenceCurrency: txn.send_currency,
                detail: `Transaction is in state "${txn.state}" but the ledger is missing: ${missing.join(', ')}. ` +
                    `A state with accounting consequences must have its journals.`,
                breakPriority: 'critical',
                transactionId: txn.id, organizationId: txn.organization_id,
            });
        }
    }
    return finishRun(ctx, null, null);
}
// ---------------------------------------------------------------------------
// Run 2 — ledger to partner statement
// ---------------------------------------------------------------------------
export async function reconcileLedgerToPartnerStatement(db, input) {
    const ctx = await beginRun(db, 'ledger_to_partner_statement', input.businessDate, {
        partnerId: input.partnerId, currency: input.currency, startedBy: input.startedBy,
    });
    const partner = await one(db, 'SELECT adapter_key, display_name FROM partner WHERE id = $1', [input.partnerId]);
    // Fetch the partner's own view.
    const statementLines = await settlementAdapter(partner.adapter_key).fetchStatement({ db, partnerId: input.partnerId, correlationId: randomUUID() }, input.businessDate, input.currency);
    // Persist it, so the comparison is reproducible later.
    const statement = await one(db, `INSERT INTO partner_statement (
       partner_id, statement_date, currency, opening_balance, closing_balance, source_hash
     ) VALUES ($1,$2,$3,0,0,$4)
     ON CONFLICT (partner_id, statement_date, currency)
     DO UPDATE SET received_at = now()
     RETURNING id`, [
        input.partnerId, input.businessDate.toISOString().slice(0, 10), input.currency,
        sha256Hex(JSON.stringify(statementLines.map((l) => [l.partnerReference, l.amount.toString()]))),
    ]);
    await db.query('DELETE FROM partner_statement_line WHERE statement_id = $1', [statement.id])
        .catch(() => { });
    let lineNumber = 1;
    for (const line of statementLines) {
        await db.query(`INSERT INTO partner_statement_line (
         statement_id, line_number, partner_reference, value_date, direction, amount,
         currency, narrative, our_reference
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (statement_id, line_number) DO NOTHING`, [
            statement.id, lineNumber++, line.partnerReference, line.valueDate,
            line.direction, line.amount.toString(), line.currency, line.narrative, line.ourReference,
        ]);
    }
    // Our view: settlement journals for this partner and currency.
    const ourLines = await many(db, `SELECT j.reference, j.transaction_id, j.organization_id, e.amount::text, j.posted_at,
            t.reference AS transaction_reference
       FROM journal j
       JOIN journal_entry e ON e.journal_id = j.id
       JOIN ledger_account a ON a.id = e.ledger_account_id
       LEFT JOIN transaction t ON t.id = j.transaction_id
      WHERE j.journal_type = 'settlement_payment'
        AND j.posting_status = 'posted'
        AND a.partner_id = $1
        AND e.currency = $2
        AND e.direction = 'credit'
        AND j.posted_at::date = $3::date
      ORDER BY j.posted_at`, [input.partnerId, input.currency, input.businessDate.toISOString().slice(0, 10)]);
    const externalByRef = new Map(statementLines.map((l) => [l.ourReference ?? '', l]));
    const seenExternal = new Set();
    let unexplained = Decimal.zero();
    for (const ours of ourLines) {
        const key = ours.transaction_reference ?? '';
        const theirs = externalByRef.get(key);
        const ourAmount = Decimal.fromString(ours.amount);
        if (!theirs) {
            unexplained = unexplained.add(ourAmount);
            await addItem(ctx, {
                result: 'missing_partner_record',
                internalRef: ours.transaction_reference, internalKind: 'journal',
                internalAmount: ourAmount, internalCurrency: input.currency, internalDate: ours.posted_at,
                difference: ourAmount, differenceCurrency: input.currency,
                detail: `Our ledger records a settlement of ${ourAmount.toString()} ${input.currency} for ` +
                    `${ours.transaction_reference ?? 'an unreferenced transaction'}, but ` +
                    `${partner.display_name}'s statement has no matching line.`,
                breakPriority: 'critical',
                transactionId: ours.transaction_id, organizationId: ours.organization_id,
                partnerId: input.partnerId,
            });
            continue;
        }
        seenExternal.add(key);
        if (!ourAmount.equals(theirs.amount)) {
            const diff = ourAmount.subtract(theirs.amount);
            unexplained = unexplained.add(diff);
            await addItem(ctx, {
                result: 'amount_difference',
                internalRef: ours.transaction_reference, internalKind: 'journal',
                internalAmount: ourAmount, internalCurrency: input.currency, internalDate: ours.posted_at,
                externalRef: theirs.partnerReference, externalAmount: theirs.amount,
                externalCurrency: theirs.currency, externalDate: theirs.valueDate,
                difference: diff, differenceCurrency: input.currency,
                detail: `Amount difference on ${ours.transaction_reference}: our ledger says ${ourAmount.toString()}, ` +
                    `${partner.display_name} says ${theirs.amount.toString()}. Difference ${diff.toString()} ` +
                    `${input.currency}. Neither side is amended; the difference is carried as a break.`,
                breakPriority: 'high',
                transactionId: ours.transaction_id, organizationId: ours.organization_id,
                partnerId: input.partnerId,
            });
            continue;
        }
        await addItem(ctx, {
            result: 'matched',
            internalRef: ours.transaction_reference, internalKind: 'journal',
            internalAmount: ourAmount, internalCurrency: input.currency, internalDate: ours.posted_at,
            externalRef: theirs.partnerReference, externalAmount: theirs.amount,
            externalCurrency: theirs.currency, externalDate: theirs.valueDate,
            detail: `Matched on reference and amount.`,
            transactionId: ours.transaction_id, organizationId: ours.organization_id,
            partnerId: input.partnerId,
        });
    }
    // Anything on the partner's statement we do not recognise. This is the direction that
    // finds a duplicate payment, so it is treated as critical.
    for (const line of statementLines) {
        const key = line.ourReference ?? '';
        if (seenExternal.has(key))
            continue;
        unexplained = unexplained.subtract(line.amount);
        await addItem(ctx, {
            result: 'missing_internal_record',
            externalRef: line.partnerReference, externalAmount: line.amount,
            externalCurrency: line.currency, externalDate: line.valueDate,
            difference: line.amount, differenceCurrency: line.currency,
            detail: `${partner.display_name}'s statement shows ${line.amount.toString()} ${line.currency} for ` +
                `${line.ourReference ?? 'an unknown reference'} which our ledger does not record. A payment we ` +
                `did not instruct, or instructed twice, would look exactly like this.`,
            breakPriority: 'critical',
            partnerId: input.partnerId,
        });
    }
    return finishRun(ctx, unexplained, input.currency);
}
// ---------------------------------------------------------------------------
// Run 3 — funding
// ---------------------------------------------------------------------------
export async function reconcileFunding(db, businessDate, startedBy) {
    const ctx = await beginRun(db, 'funding', businessDate, { startedBy });
    const rows = await many(db, `SELECT f.transaction_id, f.organization_id, t.reference,
            f.expected_amount::text, f.received_amount::text, f.expected_currency, f.status,
            (SELECT sum(e.amount)::text FROM journal j
               JOIN journal_entry e ON e.journal_id = j.id
               JOIN ledger_account a ON a.id = e.ledger_account_id
              WHERE j.transaction_id = f.transaction_id
                AND j.journal_type = 'funding_receipt'
                AND j.posting_status = 'posted'
                AND a.category = 'partner_funding_account'
                AND e.direction = 'debit') AS ledger_amount
       FROM funding_instruction f JOIN transaction t ON t.id = f.transaction_id
      WHERE f.status IN ('confirmed', 'partially_received', 'short_funded', 'over_funded')`);
    for (const r of rows) {
        const received = r.received_amount ? Decimal.fromString(r.received_amount) : Decimal.zero();
        const inLedger = r.ledger_amount ? Decimal.fromString(r.ledger_amount) : Decimal.zero();
        const expected = Decimal.fromString(r.expected_amount);
        if (received.equals(inLedger) && received.equals(expected)) {
            await addItem(ctx, {
                result: 'matched', internalRef: r.reference, internalKind: 'funding',
                internalAmount: received, internalCurrency: r.expected_currency,
                detail: 'Funding instruction, receipt and ledger all agree.',
                transactionId: r.transaction_id, organizationId: r.organization_id,
            });
        }
        else if (!received.equals(inLedger)) {
            await addItem(ctx, {
                result: 'amount_difference', internalRef: r.reference, internalKind: 'funding',
                internalAmount: received, internalCurrency: r.expected_currency,
                externalAmount: inLedger, externalCurrency: r.expected_currency,
                difference: received.subtract(inLedger), differenceCurrency: r.expected_currency,
                detail: `Funding record says ${received.toString()} received but the ledger posted ` +
                    `${inLedger.toString()}. The funding record and the books disagree.`,
                breakPriority: 'critical',
                transactionId: r.transaction_id, organizationId: r.organization_id,
            });
        }
        else {
            await addItem(ctx, {
                result: 'partially_matched', internalRef: r.reference, internalKind: 'funding',
                internalAmount: received, internalCurrency: r.expected_currency,
                externalAmount: expected, externalCurrency: r.expected_currency,
                difference: expected.subtract(received), differenceCurrency: r.expected_currency,
                detail: `Expected ${expected.toString()} but received ${received.toString()}. The ledger agrees with ` +
                    `what was received; the shortfall against the instruction is the open item.`,
                breakPriority: 'high',
                transactionId: r.transaction_id, organizationId: r.organization_id,
            });
        }
    }
    return finishRun(ctx, null, null);
}
// ---------------------------------------------------------------------------
// Run 4 — settlement
// ---------------------------------------------------------------------------
export async function reconcileSettlement(db, businessDate, startedBy) {
    const ctx = await beginRun(db, 'settlement', businessDate, { startedBy });
    const rows = await many(db, `SELECT s.transaction_id, s.organization_id, t.reference, s.partner_id,
            s.instructed_amount::text, s.settled_amount::text, s.instructed_currency,
            s.status, s.idempotency_key,
            (SELECT count(*)::text FROM integration_event ie
              WHERE ie.transaction_id = s.transaction_id
                AND ie.operation = 'settlement.submit'
                AND ie.outcome <> 'duplicate_ignored') AS submission_count
       FROM settlement_instruction s JOIN transaction t ON t.id = s.transaction_id`);
    for (const r of rows) {
        const instructed = Decimal.fromString(r.instructed_amount);
        const settled = r.settled_amount ? Decimal.fromString(r.settled_amount) : null;
        const submissions = Number(r.submission_count);
        // The check that matters most: did one instruction become two payments?
        if (submissions > 1) {
            await addItem(ctx, {
                result: 'duplicate', internalRef: r.reference, internalKind: 'settlement',
                internalAmount: instructed, internalCurrency: r.instructed_currency,
                difference: instructed, differenceCurrency: r.instructed_currency,
                detail: `${submissions} non-duplicate settlement submissions were recorded for ${r.reference} under ` +
                    `key ${r.idempotency_key}. Idempotency should have made this impossible. Investigate ` +
                    `immediately for a double payment.`,
                breakPriority: 'critical',
                transactionId: r.transaction_id, organizationId: r.organization_id, partnerId: r.partner_id,
            });
            continue;
        }
        if (r.status === 'settled' && settled && settled.equals(instructed)) {
            await addItem(ctx, {
                result: 'matched', internalRef: r.reference, internalKind: 'settlement',
                internalAmount: instructed, internalCurrency: r.instructed_currency,
                externalAmount: settled, externalCurrency: r.instructed_currency,
                detail: 'Instructed and settled amounts agree, with exactly one submission.',
                transactionId: r.transaction_id, organizationId: r.organization_id, partnerId: r.partner_id,
            });
        }
        else if (r.status === 'partially_settled' && settled) {
            await addItem(ctx, {
                result: 'partially_matched', internalRef: r.reference, internalKind: 'settlement',
                internalAmount: instructed, internalCurrency: r.instructed_currency,
                externalAmount: settled, externalCurrency: r.instructed_currency,
                difference: instructed.subtract(settled), differenceCurrency: r.instructed_currency,
                detail: `Instructed ${instructed.toString()}, settled ${settled.toString()}.`,
                breakPriority: 'high',
                transactionId: r.transaction_id, organizationId: r.organization_id, partnerId: r.partner_id,
            });
        }
        else if (['timeout', 'created', 'submitted'].includes(r.status)) {
            await addItem(ctx, {
                result: 'unmatched', internalRef: r.reference, internalKind: 'settlement',
                internalAmount: instructed, internalCurrency: r.instructed_currency,
                difference: instructed, differenceCurrency: r.instructed_currency,
                detail: `Settlement instruction is "${r.status}" with no confirmed outcome. Until the partner ` +
                    `confirms, we do not know whether the beneficiary was paid.`,
                breakPriority: r.status === 'timeout' ? 'critical' : 'normal',
                transactionId: r.transaction_id, organizationId: r.organization_id, partnerId: r.partner_id,
            });
        }
        else if (['rejected', 'failed', 'returned', 'cancelled'].includes(r.status)) {
            await addItem(ctx, {
                result: 'matched', internalRef: r.reference, internalKind: 'settlement',
                internalAmount: instructed, internalCurrency: r.instructed_currency,
                detail: `Instruction ended as "${r.status}". No settlement is expected.`,
                transactionId: r.transaction_id, organizationId: r.organization_id, partnerId: r.partner_id,
            });
        }
    }
    return finishRun(ctx, null, null);
}
// ---------------------------------------------------------------------------
// Run 5 — fees
// ---------------------------------------------------------------------------
export async function reconcileFees(db, businessDate, startedBy) {
    const ctx = await beginRun(db, 'fees', businessDate, { startedBy });
    const rows = await many(db, `SELECT t.reference, t.id AS transaction_id, t.organization_id,
            q.ekorails_fee::text AS quoted_fee, q.partner_fee::text AS quoted_partner_fee,
            q.ekorails_fee_currency AS currency,
            (SELECT sum(e.amount)::text FROM journal j
               JOIN journal_entry e ON e.journal_id = j.id
               JOIN ledger_account a ON a.id = e.ledger_account_id
              WHERE j.transaction_id = t.id AND j.posting_status = 'posted'
                AND a.category = 'fee_revenue' AND e.direction = 'credit') AS posted_revenue,
            (SELECT sum(e.amount)::text FROM journal j
               JOIN journal_entry e ON e.journal_id = j.id
               JOIN ledger_account a ON a.id = e.ledger_account_id
              WHERE j.transaction_id = t.id AND j.posting_status = 'posted'
                AND a.category = 'partner_fees_payable' AND e.direction = 'credit') AS posted_partner_fee
       FROM transaction t JOIN fx_quote q ON q.id = t.fx_quote_id
      WHERE q.status = 'accepted'`);
    for (const r of rows) {
        const quoted = Decimal.fromString(r.quoted_fee);
        const posted = r.posted_revenue ? Decimal.fromString(r.posted_revenue) : Decimal.zero();
        const quotedPartner = Decimal.fromString(r.quoted_partner_fee);
        const postedPartner = r.posted_partner_fee ? Decimal.fromString(r.posted_partner_fee) : Decimal.zero();
        if (quoted.equals(posted) && quotedPartner.equals(postedPartner)) {
            await addItem(ctx, {
                result: 'matched', internalRef: r.reference, internalKind: 'transaction',
                internalAmount: quoted, internalCurrency: r.currency,
                detail: 'Fees charged to the customer match the fees posted to the ledger.',
                transactionId: r.transaction_id, organizationId: r.organization_id,
            });
        }
        else {
            const diff = quoted.subtract(posted).add(quotedPartner.subtract(postedPartner));
            await addItem(ctx, {
                result: 'amount_difference', internalRef: r.reference, internalKind: 'transaction',
                internalAmount: quoted.add(quotedPartner), internalCurrency: r.currency,
                externalAmount: posted.add(postedPartner), externalCurrency: r.currency,
                difference: diff, differenceCurrency: r.currency,
                detail: `Quoted fees (EKORails ${quoted.toString()}, partner ${quotedPartner.toString()}) do not match ` +
                    `posted fees (EKORails ${posted.toString()}, partner ${postedPartner.toString()}). A customer ` +
                    `charged something the books do not record is a revenue-recognition problem and a conduct one.`,
                breakPriority: 'high',
                transactionId: r.transaction_id, organizationId: r.organization_id,
            });
        }
    }
    return finishRun(ctx, null, null);
}
// ---------------------------------------------------------------------------
// Run 6 — currency position
// ---------------------------------------------------------------------------
/**
 * FX clearing should net to zero in every currency once conversions are matched by
 * positioning. A non-zero balance is an open currency exposure, and it is reported as
 * one rather than being netted away.
 */
export async function reconcileCurrencyPosition(db, businessDate, startedBy) {
    const ctx = await beginRun(db, 'currency_position', businessDate, { startedBy });
    const balances = await ledger.accountBalances(db, { category: 'fx_clearing' });
    let totalExposure = Decimal.zero();
    for (const account of balances) {
        const balance = Decimal.fromString(account.balanceNatural);
        if (balance.isZero()) {
            await addItem(ctx, {
                result: 'matched', internalRef: account.code, internalKind: 'journal_entry',
                internalAmount: balance, internalCurrency: account.currency,
                detail: `FX clearing is flat in ${account.currency}. Every conversion has matching positioning.`,
            });
        }
        else {
            totalExposure = totalExposure.add(balance.abs());
            await addItem(ctx, {
                result: 'unmatched', internalRef: account.code, internalKind: 'journal_entry',
                internalAmount: balance, internalCurrency: account.currency,
                difference: balance, differenceCurrency: account.currency,
                detail: `FX clearing holds ${balance.toString()} ${account.currency}. This is an open currency ` +
                    `position: an obligation was converted without matching liquidity being positioned behind it, ` +
                    `or vice versa. It is a real exposure to rate movement until it is closed.`,
                breakPriority: 'high',
            });
        }
    }
    // Trial balance is checked here too. If the whole ledger is out of balance, that is
    // the most serious finding a reconciliation run can produce.
    const tb = await ledger.trialBalance(db);
    for (const row of tb) {
        if (!row.balanced) {
            await addItem(ctx, {
                result: 'amount_difference', internalRef: `TRIAL-BALANCE-${row.currency}`,
                internalKind: 'journal_entry',
                internalAmount: Decimal.fromString(row.totalDebits), internalCurrency: row.currency,
                externalAmount: Decimal.fromString(row.totalCredits), externalCurrency: row.currency,
                difference: Decimal.fromString(row.difference), differenceCurrency: row.currency,
                detail: `THE LEDGER DOES NOT BALANCE in ${row.currency}. Debits ${row.totalDebits}, credits ` +
                    `${row.totalCredits}. This should be impossible — the database refuses unbalanced journals — ` +
                    `so its appearance means something has bypassed the posting layer.`,
                breakPriority: 'critical',
            });
        }
    }
    return finishRun(ctx, totalExposure.isZero() ? null : totalExposure, null);
}
export async function runDailyReconciliation(db, businessDate, startedBy) {
    const runs = [];
    runs.push(await reconcileTransactionToLedger(db, businessDate, startedBy));
    runs.push(await reconcileFunding(db, businessDate, startedBy));
    runs.push(await reconcileSettlement(db, businessDate, startedBy));
    runs.push(await reconcileFees(db, businessDate, startedBy));
    runs.push(await reconcileCurrencyPosition(db, businessDate, startedBy));
    const partners = await many(db, `SELECT DISTINCT p.id, a.currency
       FROM partner p JOIN ledger_account a ON a.partner_id = p.id
      WHERE p.partner_role = 'settlement_institution'`);
    for (const p of partners) {
        runs.push(await reconcileLedgerToPartnerStatement(db, {
            partnerId: p.id, currency: p.currency, businessDate, startedBy,
        }));
    }
    const totalBreaks = runs.reduce((sum, r) => sum + r.itemsBroken, 0);
    return {
        businessDate: businessDate.toISOString().slice(0, 10),
        runs,
        totalBreaks,
        allClean: totalBreaks === 0,
    };
}
export async function listRuns(db, limit = 50) {
    return many(db, `SELECT r.reference, r.run_type, r.business_date, r.status, r.items_total,
            r.items_matched, r.items_broken, r.unexplained_amount::text AS unexplained_amount,
            r.currency, r.started_at, r.finished_at, p.display_name AS partner_name
       FROM reconciliation_run r LEFT JOIN partner p ON p.id = r.partner_id
      ORDER BY r.started_at DESC LIMIT $1`, [limit]);
}
export async function getRun(db, reference) {
    const run = await maybeOne(db, `SELECT r.id, r.reference, r.run_type, r.business_date, r.status, r.items_total,
            r.items_matched, r.items_broken, r.unexplained_amount::text AS unexplained_amount,
            r.currency, r.started_at, r.finished_at, p.display_name AS partner_name
       FROM reconciliation_run r LEFT JOIN partner p ON p.id = r.partner_id
      WHERE r.reference = $1`, [reference]);
    if (!run)
        return null;
    run['items'] = await many(db, `SELECT internal_ref, internal_kind, internal_amount::text AS internal_amount, internal_currency,
            external_ref, external_amount::text AS external_amount, external_currency,
            result, difference_amount::text AS difference_amount, difference_currency, detail
       FROM reconciliation_item WHERE run_id = $1 ORDER BY result, internal_ref`, [run['id']]);
    return run;
}
//# sourceMappingURL=reconcile.js.map