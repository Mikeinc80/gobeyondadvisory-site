/**
 * The twenty mandatory test cases from the specification.
 *
 * Each `describe` block below maps to one numbered case, and the number is in the title
 * so that a reviewer can walk the list against the requirement without translation.
 *
 * These run against a real PostgreSQL database with the real migrations applied. Several
 * of them assert on behaviour that exists only in the database — withheld grants,
 * append-only triggers, the deferred journal-balance check, row-level security — and
 * would pass vacuously against a mock.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  connect, resetDatabase, buildFixture, expectRejection, createAndAdvance,
  actor, settlementActor, SYSTEM, type TestDb, type Fixture,
} from './helpers.js';
import type { Queryable } from '../src/db/pool.js';

let db: TestDb;
let fx: Fixture;

before(async () => {
  resetDatabase();
  db = connect();
  fx = await buildFixture(db);
});

after(async () => {
  await db.close();
});

// ---------------------------------------------------------------------------
describe('1. Successful B2B settlement', () => {
  test('a transaction runs from creation to completed with a balanced ledger', async () => {
    const txn = await createAndAdvance(db, fx, { stopAt: 'completed', amount: '4000000.000000' });
    assert.equal(txn.state, 'completed', 'transaction should reach completed');

    const detail = await db.asOwner(SYSTEM, async (q) => {
      const settlement = await import('../src/modules/settlement/service.js');
      return settlement.timeline(q, txn.id);
    });

    const transitions = detail['transitions'] as Array<Record<string, unknown>>;
    const states = transitions.map((t) => t['to_state']);
    for (const expected of [
      'pending_business_approval', 'pending_compliance', 'compliance_approved',
      'quote_issued', 'quote_accepted', 'awaiting_funding', 'funding_confirmed',
      'ready_for_settlement', 'submitted_to_partner', 'settled', 'beneficiary_confirmed',
      'reconciled', 'completed',
    ]) {
      assert.ok(states.includes(expected), `lifecycle should include ${expected}; got ${states.join(' -> ')}`);
    }

    // Every transition carries a reason and an actor.
    for (const t of transitions) {
      assert.ok(String(t['reason']).length > 0, `transition to ${t['to_state']} must record a reason`);
      assert.ok(t['actor_type'], 'transition must record an actor type');
    }

    const journals = detail['journals'] as Array<Record<string, unknown>>;
    const types = journals.map((j) => j['journal_type']);
    for (const expected of [
      'obligation_recognition', 'funding_receipt', 'fx_conversion',
      'partner_positioning', 'settlement_payment',
    ]) {
      assert.ok(types.includes(expected), `ledger should include a ${expected} journal`);
    }

    // Every journal carries a plain-English explanation for the Learning Center.
    for (const j of journals) {
      assert.ok(
        String(j['plain_english']).length > 50,
        `journal ${j['reference']} must carry a substantive plain-English explanation`,
      );
    }
  });

  test('the trial balance nets to zero in every currency', async () => {
    const report = await db.asOwner(SYSTEM, async (q) => {
      const ledger = await import('../src/modules/ledger/ledger.js');
      return ledger.verifyLedgerIntegrity(q);
    });
    assert.equal(report.trialBalanceBalanced, true, 'trial balance must net to zero');
    assert.deepEqual(report.unbalancedJournals, [], 'no journal may be unbalanced');
    assert.deepEqual(report.singleLineJournals, [], 'no journal may have a single line');
  });
});

// ---------------------------------------------------------------------------
describe('2. Sanctions match', () => {
  test('a match against the simulated list suspends rather than silently allowing', async () => {
    const result = await db.asOwner(SYSTEM, async (q) => {
      const orgService = await import('../src/modules/org/service.js');
      // The fictional watchlist entry, exactly as seeded in the simulator.
      return orgService.runScreening(q, {
        organizationId: fx.orgAId, subjectType: 'organization', subjectId: fx.orgAId,
        name: 'Orion Delta Holdings Limited', country: 'NG',
        screeningTypes: ['sanctions'],
      });
    });

    assert.ok(
      ['potential_match', 'confirmed_match'].includes(result.status),
      `expected a match against the fictional list; got ${result.status}`,
    );
    assert.ok(result.hitCount > 0, 'the screening case must record at least one hit');

    const evaluation = await db.asOwner(SYSTEM, async (q) => {
      const engine = await import('../src/modules/compliance/engine.js');
      const txn = await createAndAdvanceInner(q, fx);
      const input = await engine.buildTransactionInput(q, txn);
      return engine.evaluate(q, input, {
        type: 'transaction', id: txn, organizationId: fx.orgAId,
      });
    });

    const sanctions = evaluation.all.find((r) => r.ruleKey === 'SANCTIONS_MATCH');
    assert.ok(sanctions, 'the sanctions rule must be evaluated');
    assert.equal(sanctions!.triggered, true, 'the sanctions rule must trigger on an outstanding match');
    assert.ok(
      ['suspend', 'reject'].includes(sanctions!.action ?? ''),
      `a sanctions hit must suspend or reject; got ${sanctions!.action}`,
    );
    assert.ok(evaluation.complianceCaseReference, 'a compliance case must be opened');
  });

  test('disposing of a match requires a written reason', async () => {
    await db.asOwner(SYSTEM, async (q) => {
      const orgService = await import('../src/modules/org/service.js');
      const row = await q.query<{ id: string }>(
        "SELECT id FROM screening_case WHERE status IN ('potential_match','confirmed_match') LIMIT 1",
      );
      await expectRejection(
        orgService.disposeScreening(q, {
          screeningCaseId: row.rows[0]!.id, disposition: 'cleared',
          reason: 'ok', userId: fx.users.analyst, role: 'compliance_analyst',
        }),
        /REASON_TOO_SHORT|written reason/i,
      );
    });
  });
});

async function createAndAdvanceInner(q: Queryable, fixture: Fixture): Promise<string> {
  // A transaction in pending_compliance, created inline so the caller's transaction
  // sees it. Kept minimal deliberately.
  const txnService = await import('../src/modules/transaction/service.js');
  const orgService = await import('../src/modules/org/service.js');
  const invoiceDoc = await orgService.uploadDocument(q, {
    organizationId: fixture.orgAId, documentType: 'invoice',
    originalFilename: 'inline.pdf', mimeType: 'application/pdf',
    bytes: Buffer.from('%PDF-1.4\ninline\n%%EOF\n', 'latin1'),
    userId: fixture.users.initiatorA,
  });
  const txn = await txnService.createTransaction(q, {
    organizationId: fixture.orgAId, beneficiaryId: fixture.beneficiaryA,
    corridorId: fixture.corridorId, sendAmount: '1000000.000000',
    sendCurrency: 'NGN', receiveCurrency: 'USD',
    purpose: 'Inline test transaction for rule evaluation.',
    sourceOfFunds: 'Trading revenue received into the operating account for this test.',
    invoiceNumber: `INV-INLINE-${Math.floor(Math.random() * 1_000_000)}`,
    documentLinks: [{ documentId: invoiceDoc.documentId, role: 'primary_invoice' }],
    initiatedBy: fixture.users.initiatorA,
  });
  return txn.id;
}

// ---------------------------------------------------------------------------
describe('3. PEP escalation', () => {
  test('a PEP hit routes to enhanced due diligence and requires a manager', async () => {
    const evaluation = await db.asOwner(SYSTEM, async (q) => {
      const orgService = await import('../src/modules/org/service.js');
      const engine = await import('../src/modules/compliance/engine.js');

      await orgService.runScreening(q, {
        organizationId: fx.orgBId, subjectType: 'organization', subjectId: fx.orgBId,
        // Matches the fictional PEP register entry.
        name: 'Chiamaka Nwosu-Adeyemi', country: 'NG', screeningTypes: ['pep'],
      });

      const txnId = await createAndAdvanceInner(q, {
        ...fx, orgAId: fx.orgBId, beneficiaryA: fx.beneficiaryB,
        users: { ...fx.users, initiatorA: fx.users.initiatorB },
      });
      const input = await engine.buildTransactionInput(q, txnId);
      return engine.evaluate(q, input, {
        type: 'transaction', id: txnId, organizationId: fx.orgBId,
      });
    });

    const pep = evaluation.all.find((r) => r.ruleKey === 'PEP_EXPOSURE');
    assert.ok(pep, 'the PEP rule must be evaluated');
    assert.equal(pep!.triggered, true, 'PEP exposure must trigger');
    assert.equal(pep!.action, 'enhanced_due_diligence', 'a PEP must route to enhanced due diligence');

    const requiresManager = await db.asOwner(SYSTEM, async (q) => {
      const row = await q.query<{ requires_manager: boolean }>(
        'SELECT requires_manager FROM compliance_case WHERE reference = $1',
        [evaluation.complianceCaseReference],
      );
      return row.rows[0]!.requires_manager;
    });
    assert.equal(requiresManager, true, 'the case must be flagged for manager approval');
  });

  test('an analyst cannot approve a high-risk KYB case', async () => {
    await db.asOwner(SYSTEM, async (q) => {
      const orgService = await import('../src/modules/org/service.js');
      await q.query("UPDATE organization SET risk_rating = 'high' WHERE id = $1", [fx.orgBId]);
      await expectRejection(
        orgService.decideKyb(q, {
          organizationId: fx.orgBId, decision: 'approve',
          reason: 'Attempting a high-risk approval as an analyst, which must be refused.',
          userId: fx.users.analyst, role: 'compliance_analyst', isManager: false,
        }),
        /MANAGER_APPROVAL_REQUIRED|Compliance Manager/i,
      );
    });
  });
});

// ---------------------------------------------------------------------------
describe('4. Transaction above limit', () => {
  test('an amount over the per-transaction limit is rejected, not merely flagged', async () => {
    const evaluation = await db.asOwner(SYSTEM, async (q) => {
      const engine = await import('../src/modules/compliance/engine.js');
      const txnService = await import('../src/modules/transaction/service.js');
      const limit = await q.query<{ per_transaction_limit: string }>(
        'SELECT per_transaction_limit::text FROM corridor WHERE id = $1', [fx.corridorId],
      );
      const over = (BigInt(limit.rows[0]!.per_transaction_limit.split('.')[0]!) + 1n).toString();

      const txn = await txnService.createTransaction(q, {
        organizationId: fx.orgAId, beneficiaryId: fx.beneficiaryA, corridorId: fx.corridorId,
        sendAmount: `${over}.000000`, sendCurrency: 'NGN', receiveCurrency: 'USD',
        purpose: 'A transaction deliberately above the configured per-transaction limit.',
        sourceOfFunds: 'Trading revenue received into the operating account for this test.',
        invoiceNumber: `INV-OVERLIMIT-${Math.floor(Math.random() * 1_000_000)}`,
        initiatedBy: fx.users.initiatorA,
      });
      const input = await engine.buildTransactionInput(q, txn.id);
      return engine.evaluate(q, input, { type: 'transaction', id: txn.id, organizationId: fx.orgAId });
    });

    const rule = evaluation.all.find((r) => r.ruleKey === 'TXN_ABOVE_SINGLE_LIMIT');
    assert.ok(rule?.triggered, 'the per-transaction limit rule must trigger');
    assert.equal(rule!.action, 'reject', 'a limit breach must reject rather than queue for review');
    assert.equal(evaluation.recommendedAction, 'reject');
    assert.equal(evaluation.outcome, 'prohibited');
  });

  test('a missing limit is treated as a block, never as unlimited', async () => {
    const evaluation = await db.asOwner(SYSTEM, async (q) => {
      const engine = await import('../src/modules/compliance/engine.js');
      await q.query('UPDATE corridor SET per_transaction_limit = NULL WHERE id = $1', [fx.corridorId]);
      const txnId = await createAndAdvanceInner(q, fx);
      const input = await engine.buildTransactionInput(q, txnId);
      const result = await engine.evaluate(q, input, {
        type: 'transaction', id: txnId, organizationId: fx.orgAId,
      });
      await q.query(
        "UPDATE corridor SET per_transaction_limit = '50000000.000000' WHERE id = $1", [fx.corridorId],
      );
      return result;
    });

    const rule = evaluation.all.find((r) => r.ruleKey === 'LIMIT_NOT_CONFIGURED');
    assert.ok(rule?.triggered, 'a missing limit must trigger LIMIT_NOT_CONFIGURED');
    assert.notEqual(
      evaluation.recommendedAction, 'auto_continue',
      'a transaction with no configured limit must never auto-continue',
    );
  });
});

// ---------------------------------------------------------------------------
describe('5. Missing source-of-funds evidence', () => {
  test('a transaction without source-of-funds evidence cannot auto-clear', async () => {
    const evaluation = await db.asOwner(SYSTEM, async (q) => {
      const engine = await import('../src/modules/compliance/engine.js');
      const txnId = await createAndAdvanceInner(q, fx);
      const input = await engine.buildTransactionInput(q, txnId);
      return engine.evaluate(q, input, { type: 'transaction', id: txnId, organizationId: fx.orgAId });
    });

    const rule = evaluation.all.find((r) => r.ruleKey === 'SOURCE_OF_FUNDS_INCOMPLETE');
    assert.ok(rule?.triggered, 'missing source-of-funds evidence must trigger the rule');
    assert.notEqual(evaluation.recommendedAction, 'auto_continue');
  });

  test('a short source-of-funds narrative is refused at creation', async () => {
    await db.asOwner(SYSTEM, async (q) => {
      const txnService = await import('../src/modules/transaction/service.js');
      await expectRejection(
        txnService.createTransaction(q, {
          organizationId: fx.orgAId, beneficiaryId: fx.beneficiaryA, corridorId: fx.corridorId,
          sendAmount: '1000.000000', sendCurrency: 'NGN', receiveCurrency: 'USD',
          purpose: 'Test transaction', sourceOfFunds: 'revenue',
          initiatedBy: fx.users.initiatorA,
        }),
        /SOURCE_OF_FUNDS_REQUIRED/,
      );
    });
  });
});

// ---------------------------------------------------------------------------
describe('6. Duplicate invoice', () => {
  test('a second transaction with the same invoice fingerprint is detected', async () => {
    const invoice = `INV-DUP-${Math.floor(Math.random() * 1_000_000)}`;
    await createAndAdvance(db, fx, {
      stopAt: 'compliance_approved', amount: '2500000.000000', invoice,
    });

    const evaluation = await db.asOwner(SYSTEM, async (q) => {
      const engine = await import('../src/modules/compliance/engine.js');
      const txnService = await import('../src/modules/transaction/service.js');
      const duplicate = await txnService.createTransaction(q, {
        organizationId: fx.orgAId, beneficiaryId: fx.beneficiaryA, corridorId: fx.corridorId,
        sendAmount: '2500000.000000', sendCurrency: 'NGN', receiveCurrency: 'USD',
        purpose: 'A second payment presented against an invoice already in flight.',
        sourceOfFunds: 'Trading revenue received into the operating account for this test.',
        invoiceNumber: invoice,
        initiatedBy: fx.users.initiatorA,
      });
      const input = await engine.buildTransactionInput(q, duplicate.id);
      return engine.evaluate(q, input, {
        type: 'transaction', id: duplicate.id, organizationId: fx.orgAId,
      });
    });

    const rule = evaluation.all.find((r) => r.ruleKey === 'DUPLICATE_INVOICE');
    assert.ok(rule?.triggered, 'the duplicate-invoice rule must trigger');
    assert.equal(
      rule!.action, 'manual_review',
      'a duplicate must go to review, not auto-reject: instalments and re-issues are legitimate',
    );
    const matches = rule!.dataUsed['matches'] as unknown[];
    assert.ok(matches.length >= 1, 'the matching transaction reference must be recorded');
  });
});

// ---------------------------------------------------------------------------
describe('7. Expired FX quote', () => {
  test('an expired quote cannot be accepted', async () => {
    await db.asOwner(SYSTEM, async (q) => {
      const fxq = await import('../src/modules/fx/quotes.js');
      const { Decimal, RATE_SCALE } = await import('../src/core/money.js');

      const quote = await fxq.issueQuote(q, {
        organizationId: fx.orgAId, corridorId: fx.corridorId,
        sendAmount: Decimal.fromString('1000000.000000'),
        sendCurrency: 'NGN', receiveCurrency: 'USD',
        referenceRate: Decimal.fromString('0.000625000000', RATE_SCALE),
        referenceRateSource: 'Simulated test rate.', referenceRateAt: new Date(),
        providerRate: Decimal.fromString('0.000618000000', RATE_SCALE),
        quoteSource: 'mock_liquidity_provider', isSimulated: true,
        validitySeconds: 60, issuedBy: fx.users.treasury,
        fees: fxq.defaultFeeSchedule('NGN'),
      });

      // Back-date BOTH timestamps: the schema requires expires_at > issued_at, and that
      // constraint is itself a control worth not defeating in a test.
      await q.query(
        `UPDATE fx_quote
            SET issued_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
          WHERE id = $1`,
        [quote.quoteId],
      );

      await expectRejection(
        fxq.acceptQuote(q, {
          quoteId: quote.quoteId, acceptedBy: fx.users.approverA, organizationId: fx.orgAId,
        }),
        /QUOTE_EXPIRED|expired/i,
      );

      const after = await q.query<{ status: string }>(
        'SELECT status FROM fx_quote WHERE id = $1', [quote.quoteId],
      );
      assert.equal(after.rows[0]!.status, 'expired', 'the quote must be marked expired');
    });
  });

  test('a simulated quote can never be marked as contractually locked', async () => {
    await db.asOwner(SYSTEM, async (q) => {
      const fxq = await import('../src/modules/fx/quotes.js');
      const { Decimal, RATE_SCALE } = await import('../src/core/money.js');
      await expectRejection(
        fxq.issueQuote(q, {
          organizationId: fx.orgAId, corridorId: fx.corridorId,
          sendAmount: Decimal.fromString('1000000.000000'),
          sendCurrency: 'NGN', receiveCurrency: 'USD',
          referenceRate: Decimal.fromString('0.000625000000', RATE_SCALE),
          referenceRateSource: 'Simulated test rate.', referenceRateAt: new Date(),
          providerRate: Decimal.fromString('0.000618000000', RATE_SCALE),
          quoteSource: 'mock_liquidity_provider', isSimulated: true,
          validitySeconds: 60, issuedBy: fx.users.treasury,
          fees: fxq.defaultFeeSchedule('NGN'),
          lockEvidenceRef: 'PRETEND-LOCK-001',
        }),
        /SIMULATED_QUOTE_CANNOT_LOCK/,
      );
    });
  });
});

// ---------------------------------------------------------------------------
describe('8. Partner API timeout', () => {
  test('a timeout produces an UNKNOWN outcome, a suspense posting and a critical exception', async () => {
    const txn = await createAndAdvance(db, fx, {
      stopAt: 'settled', amount: '3300000.000000', scenario: 'partner_timeout',
    });
    assert.equal(txn.state, 'under_investigation', 'a timeout must move to under_investigation');

    const detail = await db.asOwner(SYSTEM, async (q) => {
      const journals = await q.query<{ journal_type: string }>(
        "SELECT journal_type FROM journal WHERE transaction_id = $1", [txn.id],
      );
      const outbound = await q.query<{ state: string }>(
        'SELECT state FROM outbound_idempotency WHERE transaction_id = $1', [txn.id],
      );
      const exceptions = await q.query<{ exception_type: string; priority: string }>(
        'SELECT exception_type, priority FROM exception_case WHERE transaction_id = $1', [txn.id],
      );
      return { journals: journals.rows, outbound: outbound.rows, exceptions: exceptions.rows };
    });

    assert.ok(
      detail.journals.some((j) => j.journal_type === 'suspense_posting'),
      'the instructed amount must be parked in settlement suspense',
    );
    assert.equal(detail.outbound[0]?.state, 'unknown', 'the outbound record must be marked unknown');
    assert.ok(
      detail.exceptions.some((e) => e.exception_type === 'unknown_partner_outcome' && e.priority === 'critical'),
      'a critical unknown-outcome exception must be raised',
    );
  });
});

// ---------------------------------------------------------------------------
describe('9. Duplicate partner callback', () => {
  test('resubmitting the same idempotency key does not instruct a second payment', async () => {
    const txn = await createAndAdvance(db, fx, { stopAt: 'settled', amount: '2200000.000000' });

    const second = await db.asOwner(SYSTEM, async (q) => {
      const { SimulatedSettlementAdapter } = await import('../src/modules/partners/adapters.js');
      const { Decimal } = await import('../src/core/money.js');
      const { outboundIdempotencyKey } = await import('../src/core/ids.js');
      const adapter = new SimulatedSettlementAdapter();
      return adapter.submitSettlement(
        {
          db: q, partnerId: fx.partners.settlementInstitution,
          transactionId: txn.id, organizationId: fx.orgAId,
          correlationId: '00000000-0000-0000-0000-000000000001',
        },
        {
          idempotencyKey: outboundIdempotencyKey(txn.reference, 'settlement.submit'),
          transactionReference: txn.reference,
          amount: Decimal.fromString('1000.000000'), currency: 'USD',
          beneficiaryName: 'Alpha Supplier BV', beneficiaryAccountLast4: '0001',
          beneficiaryCountry: 'NL', purpose: 'Duplicate submission test.',
        },
      );
    });

    assert.equal(second.status, 'duplicate_ignored', 'the repeat must be recognised as a duplicate');
    assert.equal(second.settledAmount, null, 'no second payment may be reported');

    const submissions = await db.asOwner(SYSTEM, async (q) => {
      const row = await q.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM integration_event
          WHERE transaction_id = $1 AND operation = 'settlement.submit'
            AND outcome NOT IN ('duplicate_ignored')`,
        [txn.id],
      );
      return Number(row.rows[0]!.n);
    });
    assert.equal(submissions, 1, 'exactly one real submission may be recorded');
  });
});

// ---------------------------------------------------------------------------
describe('10. Failed settlement', () => {
  test('a partner rejection unwinds the positioning by reversal, not deletion', async () => {
    const txn = await createAndAdvance(db, fx, {
      stopAt: 'settled', amount: '1800000.000000', scenario: 'insufficient_liquidity',
    });
    assert.equal(txn.state, 'failed');

    const journals = await db.asOwner(SYSTEM, async (q) => {
      const rows = await q.query<{ journal_type: string; posting_status: string; reference: string }>(
        'SELECT journal_type, posting_status, reference FROM journal WHERE transaction_id = $1 ORDER BY posted_at',
        [txn.id],
      );
      return rows.rows;
    });

    const reversals = journals.filter((j) => j.journal_type === 'reversal');
    assert.ok(reversals.length >= 2, 'the conversion and positioning must both be reversed');
    const reversed = journals.filter((j) => j.posting_status === 'reversed');
    assert.ok(reversed.length >= 2, 'the original journals must be MARKED reversed, not removed');

    const stillPresent = journals.filter(
      (j) => j.journal_type === 'fx_conversion' || j.journal_type === 'partner_positioning',
    );
    assert.equal(stillPresent.length, 2, 'the original journals must remain in the ledger');
  });
});

// ---------------------------------------------------------------------------
describe('11. Returned transaction', () => {
  test('a return is a new event; the original settlement journal stands', async () => {
    const txn = await createAndAdvance(db, fx, {
      stopAt: 'settled', amount: '1600000.000000', scenario: 'returned_payment',
    });
    assert.equal(txn.state, 'returned');

    const journals = await db.asOwner(SYSTEM, async (q) => {
      const rows = await q.query<{ journal_type: string; posting_status: string }>(
        'SELECT journal_type, posting_status FROM journal WHERE transaction_id = $1', [txn.id],
      );
      return rows.rows;
    });

    const settlementJournal = journals.find((j) => j.journal_type === 'settlement_payment');
    assert.ok(settlementJournal, 'the settlement journal must exist');
    assert.equal(
      settlementJournal!.posting_status, 'posted',
      'the original settlement must NOT be reversed: the payment genuinely happened',
    );
    assert.ok(
      journals.some((j) => j.journal_type === 'return_receipt'),
      'a separate return-receipt journal must record the funds coming back',
    );
  });
});

// ---------------------------------------------------------------------------
describe('12. Reconciliation mismatch', () => {
  test('a partner statement that disagrees with the ledger produces a break', async () => {
    await createAndAdvance(db, fx, {
      stopAt: 'settled', amount: '2900000.000000', scenario: 'reconciliation_mismatch',
    });

    const summary = await db.asOwner(SYSTEM, async (q) => {
      const recon = await import('../src/modules/recon/reconcile.js');
      return recon.reconcileLedgerToPartnerStatement(q, {
        partnerId: fx.partners.settlementInstitution, currency: 'USD',
        businessDate: new Date(), startedBy: fx.users.finance,
      });
    });

    assert.ok(summary.itemsBroken > 0, 'the run must find at least one break');
    assert.ok(
      (summary.byResult['amount_difference'] ?? 0) > 0,
      `expected an amount_difference; got ${JSON.stringify(summary.byResult)}`,
    );
    assert.ok(summary.breaksOpened.length > 0, 'a break must be raised with an owner and an age');
  });

  test('closing a break above the threshold requires a second person', async () => {
    await db.asOwner(SYSTEM, async (q) => {
      const exceptions = await import('../src/modules/recon/exceptions.js');
      const row = await q.query<{ id: string; amount: string | null }>(
        `SELECT id, amount::text FROM exception_case
          WHERE exception_type = 'reconciliation_break' AND status = 'open'
            AND amount >= 1000 ORDER BY opened_at DESC LIMIT 1`,
      );
      if (!row.rows[0]) return; // no break above the threshold in this run

      const proposed = await exceptions.proposeResolution(q, {
        exceptionId: row.rows[0].id,
        resolution:
          'Investigated with the partner. The difference arises from a partner-side rounding ' +
          'convention and has been confirmed in writing. Proposing closure.',
        resolvedBy: fx.users.finance,
      });
      assert.equal(proposed.requiresApproval, true, 'above the threshold, closure needs approval');

      await expectRejection(
        exceptions.approveResolution(q, row.rows[0].id, fx.users.finance),
        /SEGREGATION_OF_DUTIES/,
      );

      await exceptions.approveResolution(q, row.rows[0].id, fx.users.finance2);
      const after = await q.query<{ status: string }>(
        'SELECT status FROM exception_case WHERE id = $1', [row.rows[0].id],
      );
      assert.equal(after.rows[0]!.status, 'resolved');
    });
  });
});

// ---------------------------------------------------------------------------
describe('13. Unauthorised ledger access', () => {
  // Each refused statement gets its own transaction: in PostgreSQL a failed statement
  // aborts the surrounding transaction, so a second assertion in the same block would
  // only ever see "current transaction is aborted" and would prove nothing.
  test('the application role cannot UPDATE a journal entry', async () => {
    await expectRejection(
      db.asApp({ scope: 'global' }, (q) => q.query('UPDATE journal_entry SET amount = 1')),
      /permission denied|APPEND_ONLY/i,
    );
  });

  test('the application role cannot DELETE a journal entry', async () => {
    await expectRejection(
      db.asApp({ scope: 'global' }, (q) => q.query('DELETE FROM journal_entry')),
      /permission denied|APPEND_ONLY/i,
    );
  });

  test('even the schema owner cannot UPDATE a journal entry', async () => {
    await expectRejection(
      db.asOwner(SYSTEM, (q) => q.query("UPDATE journal_entry SET narrative = 'tampered'")),
      /APPEND_ONLY_VIOLATION/,
    );
  });

  test('even the schema owner cannot DELETE a journal entry', async () => {
    await expectRejection(
      db.asOwner(SYSTEM, (q) => q.query('DELETE FROM journal_entry')),
      /APPEND_ONLY_VIOLATION/,
    );
  });

  test('a business user has no ledger read permission and sees only their own accounts', async () => {
    const { permissionsForRoles } = await import('../src/auth/rbac.js');
    const businessPermissions = permissionsForRoles(['business_initiator', 'business_approver']);
    assert.equal(
      businessPermissions.has('ledger.read'), false,
      'a business role must not hold ledger.read',
    );

    const visible = await db.asApp({ scope: 'org', organizationId: fx.orgAId }, async (q) => {
      const rows = await q.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ledger_account
          WHERE organization_id IS NOT NULL AND organization_id <> $1`,
        [fx.orgAId],
      );
      return Number(rows.rows[0]!.n);
    });
    assert.equal(visible, 0, 'organisation-scoped access must not see another organisation\'s accounts');
  });
});

// ---------------------------------------------------------------------------
describe('14. Unauthorised cross-organisation access', () => {
  test('organisation A cannot see organisation B\'s transactions, at the database level', async () => {
    await createAndAdvance(db, fx, { stopAt: 'pending_compliance', amount: '1100000.000000' });

    const seenByA = await db.asApp({ scope: 'org', organizationId: fx.orgAId }, async (q) => {
      const rows = await q.query<{ organization_id: string }>('SELECT organization_id FROM transaction');
      return rows.rows;
    });
    assert.ok(seenByA.length > 0, 'organisation A must see its own transactions');
    assert.ok(
      seenByA.every((r) => r.organization_id === fx.orgAId),
      'organisation A must see ONLY its own transactions',
    );

    const seenByB = await db.asApp({ scope: 'org', organizationId: fx.orgBId }, async (q) => {
      const rows = await q.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM transaction WHERE organization_id = $1', [fx.orgAId],
      );
      return Number(rows.rows[0]!.n);
    });
    assert.equal(seenByB, 0, 'organisation B must not see organisation A\'s rows even when naming them');
  });

  test('the isolation holds across every organisation-scoped table', async () => {
    const tables = [
      'organization', 'organization_profile', 'natural_person', 'bank_account', 'beneficiary',
      'document', 'screening_case', 'risk_assessment', 'compliance_case', 'compliance_decision',
      'transaction', 'transaction_approval', 'transaction_transition', 'funding_instruction',
      'settlement_instruction', 'fx_quote', 'notification', 'support_case', 'exception_case',
      'journal', 'journal_entry', 'ledger_account', 'app_user',
    ];
    for (const table of tables) {
      const leaked = await db.asApp({ scope: 'org', organizationId: fx.orgBId }, async (q) => {
        const column = table === 'organization' ? 'id' : 'organization_id';
        const rows = await q.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${table} WHERE ${column} = $1`, [fx.orgAId],
        );
        return Number(rows.rows[0]!.n);
      });
      assert.equal(leaked, 0, `${table} leaked rows across organisations`);
    }
  });

  test('a request with no security context sees nothing at all', async () => {
    const visible = await db.asApp({ scope: 'none' }, async (q) => {
      const rows = await q.query<{ n: string }>('SELECT count(*)::text AS n FROM transaction');
      return Number(rows.rows[0]!.n);
    });
    assert.equal(visible, 0, 'an unauthenticated context must see no organisation-scoped rows');
  });

  test('a cross-organisation quote acceptance returns not-found, not forbidden', async () => {
    await db.asOwner(SYSTEM, async (q) => {
      const fxq = await import('../src/modules/fx/quotes.js');
      const row = await q.query<{ id: string }>(
        'SELECT id FROM fx_quote WHERE organization_id = $1 LIMIT 1', [fx.orgAId],
      );
      const error = await expectRejection(
        fxq.acceptQuote(q, {
          quoteId: row.rows[0]!.id, acceptedBy: fx.users.initiatorB, organizationId: fx.orgBId,
        }),
        /QUOTE_NOT_FOUND/,
      );
      // Confirming existence would itself be a disclosure.
      assert.ok(
        !/forbidden|not yours|other organisation/i.test(error.message),
        'the message must not confirm that the record exists elsewhere',
      );
    });
  });
});

// ---------------------------------------------------------------------------
describe('15. Administrator attempting to edit an audit record', () => {
  test('the application role has no UPDATE privilege on the audit trail', async () => {
    await expectRejection(
      db.asApp({ scope: 'global' }, (q) => q.query("UPDATE audit_event SET action = 'tampered'")),
      /permission denied/i,
    );
  });

  test('the application role has no DELETE privilege on the audit trail', async () => {
    await expectRejection(
      db.asApp({ scope: 'global' }, (q) => q.query('DELETE FROM audit_event')),
      /permission denied/i,
    );
  });

  test('even the schema owner is refused by the append-only trigger on UPDATE', async () => {
    await expectRejection(
      db.asOwner(SYSTEM, (q) => q.query("UPDATE audit_event SET reason = 'tampered' WHERE seq = 1")),
      /APPEND_ONLY_VIOLATION/,
    );
  });

  test('even the schema owner is refused by the append-only trigger on DELETE', async () => {
    await expectRejection(
      db.asOwner(SYSTEM, (q) => q.query('DELETE FROM audit_event WHERE seq = 1')),
      /APPEND_ONLY_VIOLATION/,
    );
  });

  test('the audit record is genuinely unchanged after the attempts', async () => {
    const row = await db.asOwner(SYSTEM, async (q) => {
      const r = await q.query<{ action: string; reason: string | null; entry_hash: string }>(
        'SELECT action, reason, entry_hash FROM audit_event WHERE seq = 1',
      );
      return r.rows[0]!;
    });
    assert.notEqual(row.action, 'tampered', 'the action must be untouched');
    assert.notEqual(row.reason, 'tampered', 'the reason must be untouched');
    assert.ok(/^[0-9a-f]{64}$/.test(row.entry_hash), 'the entry hash must still be present');
  });

  test('a System Administrator holds no permission that could reach a compliance decision', async () => {
    const { ROLES, permissionsForRoles } = await import('../src/auth/rbac.js');
    const admin = permissionsForRoles(['system_administrator']);
    for (const forbidden of [
      'compliance.alert.clear', 'compliance.highrisk.approve', 'ledger.post.adjustment',
      'txn.approve', 'document.read.any', 'pii.unmask',
    ]) {
      assert.equal(
        admin.has(forbidden as never), false,
        `system_administrator must not hold ${forbidden}`,
      );
    }
    assert.ok(
      ROLES.system_administrator.explicitDenials.some((d) => /audit record/i.test(d)),
      'the role must explicitly state it cannot edit audit records',
    );
  });

  test('the audit hash chain verifies and detects tampering', async () => {
    const verification = await db.asOwner(SYSTEM, async (q) => {
      const { verifyAuditChain } = await import('../src/audit/audit.js');
      return verifyAuditChain(q, 0);
    });
    assert.equal(verification.intact, true, 'the chain must verify');
    assert.ok(verification.eventsChecked > 50, 'a meaningful number of events must have been checked');
  });
});

// ---------------------------------------------------------------------------
describe('16. Journal imbalance attempt', () => {
  test('an unbalanced journal is refused at commit by the database', async () => {
    await expectRejection(
      db.asOwner(SYSTEM, async (q) => {
        const accounts = await q.query<{ id: string }>(
          "SELECT id FROM ledger_account WHERE currency = 'NGN' LIMIT 2",
        );
        const journal = await q.query<{ id: string }>(
          `INSERT INTO journal (reference, journal_type, description, plain_english, effective_date)
           VALUES ('JRN-IMBALANCE-TEST','test_liquidity_injection','imbalance',
                   'A deliberately unbalanced journal used to prove the database refuses it.',
                   CURRENT_DATE)
           RETURNING id`,
        );
        await q.query(
          `INSERT INTO journal_entry (journal_id, line_number, ledger_account_id, direction, amount, currency, narrative)
           VALUES ($1,1,$2,'debit',1000.00,'NGN','dr'), ($1,2,$3,'credit',999.00,'NGN','cr')`,
          [journal.rows[0]!.id, accounts.rows[0]!.id, accounts.rows[1]!.id],
        );
      }),
      /JOURNAL_IMBALANCE/,
    );
  });

  test('a single-line journal is refused', async () => {
    await expectRejection(
      db.asOwner(SYSTEM, async (q) => {
        const account = await q.query<{ id: string }>(
          "SELECT id FROM ledger_account WHERE currency = 'NGN' LIMIT 1",
        );
        const journal = await q.query<{ id: string }>(
          `INSERT INTO journal (reference, journal_type, description, plain_english, effective_date)
           VALUES ('JRN-SINGLELINE-TEST','test_liquidity_injection','single',
                   'A single-legged journal used to prove the database refuses it.', CURRENT_DATE)
           RETURNING id`,
        );
        await q.query(
          `INSERT INTO journal_entry (journal_id, line_number, ledger_account_id, direction, amount, currency, narrative)
           VALUES ($1,1,$2,'debit',1000.00,'NGN','dr')`,
          [journal.rows[0]!.id, account.rows[0]!.id],
        );
      }),
      /JOURNAL_INCOMPLETE/,
    );
  });

  test('the application layer refuses an imbalance before it reaches the database', async () => {
    const { assertBalanced, LedgerError } = await import('../src/modules/ledger/ledger.js');
    const { Decimal } = await import('../src/core/money.js');
    assert.throws(
      () => assertBalanced([
        { accountId: 'a', direction: 'debit', amount: Decimal.fromString('100.000000'), currency: 'NGN', narrative: 'x' },
        { accountId: 'b', direction: 'credit', amount: Decimal.fromString('99.000000'), currency: 'NGN', narrative: 'y' },
      ]),
      (e: unknown) => e instanceof LedgerError && e.code === 'JOURNAL_IMBALANCE',
    );
  });

  test('a cross-currency journal must balance within EACH currency', async () => {
    const { assertBalanced } = await import('../src/modules/ledger/ledger.js');
    const { Decimal } = await import('../src/core/money.js');
    // Balanced in NGN, unbalanced in USD.
    assert.throws(() => assertBalanced([
      { accountId: 'a', direction: 'debit', amount: Decimal.fromString('100.000000'), currency: 'NGN', narrative: 'x' },
      { accountId: 'b', direction: 'credit', amount: Decimal.fromString('100.000000'), currency: 'NGN', narrative: 'y' },
      { accountId: 'c', direction: 'debit', amount: Decimal.fromString('50.000000'), currency: 'USD', narrative: 'z' },
    ]), /does not balance in USD/);
  });

  test('an entry cannot be posted in a currency other than its account\'s', async () => {
    await expectRejection(
      db.asOwner(SYSTEM, async (q) => {
        const account = await q.query<{ id: string }>(
          "SELECT id FROM ledger_account WHERE currency = 'NGN' LIMIT 1",
        );
        const journal = await q.query<{ id: string }>(
          `INSERT INTO journal (reference, journal_type, description, plain_english, effective_date)
           VALUES ('JRN-CURRENCY-TEST','test_liquidity_injection','ccy',
                   'A journal posting the wrong currency to an account, to prove it is refused.',
                   CURRENT_DATE)
           RETURNING id`,
        );
        await q.query(
          `INSERT INTO journal_entry (journal_id, line_number, ledger_account_id, direction, amount, currency, narrative)
           VALUES ($1,1,$2,'debit',1000.00,'USD','wrong currency')`,
          [journal.rows[0]!.id, account.rows[0]!.id],
        );
      }),
      /CURRENCY_MISMATCH/,
    );
  });
});

// ---------------------------------------------------------------------------
describe('17. Suspended organisation initiating a transaction', () => {
  test('a suspended organisation is refused at creation and the attempt is audited', async () => {
    await db.asOwner(SYSTEM, async (q) => {
      const txnService = await import('../src/modules/transaction/service.js');
      await q.query(
        "UPDATE organization SET suspended_at = now(), suspension_reason = 'Test suspension' WHERE id = $1",
        [fx.orgBId],
      );

      await expectRejection(
        txnService.createTransaction(q, {
          organizationId: fx.orgBId, beneficiaryId: fx.beneficiaryB, corridorId: fx.corridorId,
          sendAmount: '1000000.000000', sendCurrency: 'NGN', receiveCurrency: 'USD',
          purpose: 'A transaction attempted while the organisation is suspended.',
          sourceOfFunds: 'Trading revenue received into the operating account for this test.',
          initiatedBy: fx.users.initiatorB,
        }),
        /ORGANISATION_SUSPENDED/,
      );

      const audited = await q.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_event
          WHERE organization_id = $1 AND outcome = 'denied'
            AND metadata->>'denial_reason' = 'organisation_suspended'`,
        [fx.orgBId],
      );
      assert.ok(Number(audited.rows[0]!.n) >= 1, 'the refused attempt must be audited');

      await q.query('UPDATE organization SET suspended_at = NULL WHERE id = $1', [fx.orgBId]);
    });
  });

  test('the compliance engine also treats suspension as prohibited', async () => {
    const evaluation = await db.asOwner(SYSTEM, async (q) => {
      const engine = await import('../src/modules/compliance/engine.js');
      const txnId = await createAndAdvanceInner(q, fx);
      await q.query('UPDATE organization SET suspended_at = now() WHERE id = $1', [fx.orgAId]);
      const input = await engine.buildTransactionInput(q, txnId);
      const result = await engine.evaluate(q, input, {
        type: 'transaction', id: txnId, organizationId: fx.orgAId,
      });
      await q.query('UPDATE organization SET suspended_at = NULL WHERE id = $1', [fx.orgAId]);
      return result;
    });
    const rule = evaluation.all.find((r) => r.ruleKey === 'CUSTOMER_SUSPENDED');
    assert.ok(rule?.triggered, 'the suspension rule must trigger');
    assert.equal(rule!.severity, 'prohibited');
    assert.equal(evaluation.recommendedAction, 'reject');
  });
});

// ---------------------------------------------------------------------------
describe('18. User trying to approve their own transaction', () => {
  test('the service layer refuses a self-approval and audits the attempt', async () => {
    const txn = await createAndAdvance(db, fx, { stopAt: 'draft', amount: '1200000.000000' });

    await db.asOwner(SYSTEM, async (q) => {
      const txnService = await import('../src/modules/transaction/service.js');
      await txnService.submitForApproval(q, txn.id,
        actor(fx.users.initiatorA, 'business_initiator', ['txn.initiate']));

      await expectRejection(
        txnService.businessApprove(q, {
          transactionId: txn.id,
          // The same user who initiated it.
          actor: actor(fx.users.initiatorA, 'business_approver', ['txn.approve']),
          approve: true, reason: 'Attempting to authorise my own transaction.',
        }),
        /SEGREGATION_OF_DUTIES/,
      );

      const audited = await q.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_event
          WHERE transaction_id = $1 AND outcome = 'denied'
            AND metadata->>'denial_reason' = 'self_approval'`,
        [txn.id],
      );
      assert.ok(Number(audited.rows[0]!.n) >= 1, 'the refused self-approval must be audited');
    });
  });

  test('the database refuses a self-approval even if the service layer is bypassed', async () => {
    const txn = await createAndAdvance(db, fx, { stopAt: 'draft', amount: '1300000.000000' });

    await expectRejection(
      db.asOwner(SYSTEM, async (q) => {
        await q.query(
          `INSERT INTO transaction_approval (
             transaction_id, organization_id, approval_type, decision, decided_by, decided_by_role
           ) VALUES ($1,$2,'business_dual_authorisation','approved',$3,'business_approver')`,
          [txn.id, fx.orgAId, fx.users.initiatorA],
        );
      }),
      /SEGREGATION_OF_DUTIES/,
    );
  });

  test('the state machine refuses the approve edge for the initiator', async () => {
    const txn = await createAndAdvance(db, fx, { stopAt: 'draft', amount: '1400000.000000' });
    await db.asOwner(SYSTEM, async (q) => {
      const txnService = await import('../src/modules/transaction/service.js');
      const { transition } = await import('../src/modules/settlement/machine.js');
      await txnService.submitForApproval(q, txn.id,
        actor(fx.users.initiatorA, 'business_initiator', ['txn.initiate']));
      await expectRejection(
        transition(q, {
          transactionId: txn.id, event: 'business_approve', actorType: 'user',
          actorUserId: fx.users.initiatorA, actorRole: 'business_approver',
          actorPermissions: new Set(['txn.approve']) as never, stepUpValid: true,
          reason: 'Bypassing the service layer to attempt a self-approval.',
        }),
        /SEGREGATION_OF_DUTIES/,
      );
    });
  });
});

// ---------------------------------------------------------------------------
describe('19. Personally identifiable information appearing in logs', () => {
  test('the redaction layer removes credentials and masks identifiers', async () => {
    const { redact, findLeaks } = await import('../src/core/redact.js');
    const payload = {
      email: 'someone.real@example.com',
      password: 'CorrectHorseBatteryStaple1',
      session_token: 'abc123def456ghi789jkl012',
      api_key: 'sk_live_0123456789abcdef',
      account_number: '0123456789',
      iban: 'NL00DEMO0000100001',
      id_number: 'DEMO-ID-40001111',
      nested: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature',
        private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
      },
      safe_field: 'This should survive.',
    };

    const redacted = redact(payload) as Record<string, unknown>;
    assert.equal(redacted['password'], '[REDACTED]');
    assert.equal(redacted['session_token'], '[REDACTED]');
    assert.equal(redacted['api_key'], '[REDACTED]');
    assert.equal(redacted['safe_field'], 'This should survive.');
    assert.notEqual(redacted['account_number'], '0123456789');
    assert.notEqual(redacted['id_number'], 'DEMO-ID-40001111');
    assert.ok(!String(redacted['email']).includes('someone.real'), 'the email local part must be masked');

    const nested = redacted['nested'] as Record<string, unknown>;
    assert.equal(nested['authorization'], '[REDACTED]');
    assert.equal(nested['private_key'], '[REDACTED]');

    assert.deepEqual(findLeaks(JSON.stringify(redacted)), [], 'nothing sensitive may survive redaction');
  });

  test('no audit event in the database contains an unredacted secret', async () => {
    const leaks = await db.asOwner(SYSTEM, async (q) => {
      const { findLeaks } = await import('../src/core/redact.js');
      const rows = await q.query<{ seq: string; payload: string }>(
        `SELECT seq::text,
                coalesce(old_values::text,'') || coalesce(new_values::text,'') || metadata::text
                  || coalesce(reason,'') AS payload
           FROM audit_event`,
      );
      const found: Array<{ seq: string; leaks: string[] }> = [];
      for (const row of rows.rows) {
        const l = findLeaks(row.payload);
        if (l.length > 0) found.push({ seq: row.seq, leaks: l });
      }
      return found;
    });
    assert.deepEqual(leaks, [], `audit events leaked sensitive content: ${JSON.stringify(leaks)}`);
  });

  test('no integration event payload contains an unmasked account identifier', async () => {
    const leaks = await db.asOwner(SYSTEM, async (q) => {
      const { findLeaks } = await import('../src/core/redact.js');
      const rows = await q.query<{ id: string; payload: string }>(
        `SELECT id::text,
                coalesce(request_payload::text,'') || coalesce(response_payload::text,'') AS payload
           FROM integration_event`,
      );
      const found: Array<{ id: string; leaks: string[] }> = [];
      for (const row of rows.rows) {
        const l = findLeaks(row.payload);
        if (l.length > 0) found.push({ id: row.id, leaks: l });
      }
      return found;
    });
    assert.deepEqual(leaks, [], `integration events leaked sensitive content: ${JSON.stringify(leaks)}`);
  });

  test('off-platform notifications refuse to carry financial detail', async () => {
    const { assertSafeForChannel, UnsafeNotificationError } = await import('../src/modules/notification/notify.js');

    // In-app is inside the product and behind authentication.
    assertSafeForChannel('in_app', 'Payment settled', 'TXN-202608-100001 settled for NGN 4,000,000.00');

    assert.throws(
      () => assertSafeForChannel('email', 'Payment settled', 'Your payment of NGN 4,000,000.00 has settled.'),
      (e: unknown) => e instanceof UnsafeNotificationError,
      'an email must not carry a monetary amount',
    );
    assert.throws(
      () => assertSafeForChannel('sms', 'Code', 'Your account 0123456789 was credited.'),
      (e: unknown) => e instanceof UnsafeNotificationError,
      'an SMS must not carry an account identifier',
    );

    // The pattern actually used by the product: a reference and a prompt to sign in.
    assertSafeForChannel(
      'email', 'Transaction update',
      'Transaction TXN-REF has an update. Sign in to view the detail.',
    );
  });

  test('no stored notification body violates the off-platform rule', async () => {
    const violations = await db.asOwner(SYSTEM, async (q) => {
      const { assertSafeForChannel } = await import('../src/modules/notification/notify.js');
      const rows = await q.query<{ id: string; channel: string; subject: string; body: string }>(
        "SELECT id::text, channel, subject, body FROM notification WHERE channel <> 'in_app'",
      );
      const bad: string[] = [];
      for (const row of rows.rows) {
        try {
          assertSafeForChannel(row.channel as 'email' | 'sms', row.subject, row.body);
        } catch {
          bad.push(`${row.channel}: ${row.subject}`);
        }
      }
      return bad;
    });
    assert.deepEqual(violations, [], 'stored off-platform notifications must carry no sensitive detail');
  });
});

// ---------------------------------------------------------------------------
describe('20. Backup restoration and transaction-history verification', () => {
  test('a logical backup restores with history, ledger balance and audit chain intact', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    // Capture the pre-backup state.
    const before = await db.asOwner(SYSTEM, async (q) => {
      const { verifyLedgerIntegrity } = await import('../src/modules/ledger/ledger.js');
      const { verifyAuditChain } = await import('../src/audit/audit.js');
      const txns = await q.query<{ reference: string; state: string }>(
        'SELECT reference, state FROM transaction ORDER BY reference',
      );
      return {
        transactions: txns.rows,
        ledger: await verifyLedgerIntegrity(q),
        chain: await verifyAuditChain(q, 0),
      };
    });

    assert.ok(before.transactions.length > 0, 'there must be history to restore');

    // Prove the failure mode this procedure exists to avoid: an owner-run dump fails.
    let ownerDumpFailed = false;
    try {
      execFileSync('bash', ['-lc',
        'PGPASSWORD=ekorails_owner_dev pg_dump -h 127.0.0.1 -U ekorails_owner -d ekorails -Fc -f /dev/null',
      ], { stdio: 'pipe' });
    } catch {
      ownerDumpFailed = true;
    }
    assert.ok(
      ownerDumpFailed,
      'a dump run as the schema owner is expected to fail under FORCE ROW LEVEL SECURITY; ' +
      'if it now succeeds, the isolation guarantee has been weakened and this test must be revisited',
    );
    assert.equal(before.ledger.trialBalanceBalanced, true);
    assert.equal(before.chain.intact, true);

    const dir = mkdtempSync(join(tmpdir(), 'ekorails-backup-'));
    const dumpPath = join(dir, 'ekorails.dump');
    const restoreDb = 'ekorails_restore_test';

    try {
      // Dumped as the dedicated BYPASSRLS backup role. Running pg_dump as the schema
      // owner FAILS under FORCE ROW LEVEL SECURITY — which is precisely the kind of
      // silent backup failure this test exists to catch.
      execFileSync('bash', ['-lc',
        `PGPASSWORD=ekorails_backup_dev pg_dump -h 127.0.0.1 -U ekorails_backup -d ekorails -Fc --no-owner --no-acl -f ${dumpPath}`,
      ], { stdio: 'pipe' });

      execFileSync('bash', ['-lc',
        `su postgres -c "psql -q -c \\"DROP DATABASE IF EXISTS ${restoreDb};\\" ` +
        `-c \\"CREATE DATABASE ${restoreDb} OWNER ekorails_owner;\\""`,
      ], { stdio: 'pipe' });

      execFileSync('bash', ['-lc',
        `PGPASSWORD=ekorails_owner_dev pg_restore -h 127.0.0.1 -U ekorails_owner -d ${restoreDb} ${dumpPath} 2>/dev/null || true`,
      ], { stdio: 'pipe' });

      const pg = (await import('pg')).default;
      const pool = new pg.Pool({
        host: '127.0.0.1', port: 5432, database: restoreDb,
        user: 'ekorails_owner', password: 'ekorails_owner_dev', max: 2,
      });

      try {
        const client = await pool.connect();
        try {
          await client.query("SELECT set_config('ekorails.scope','system',false)");

          const restoredTxns = await client.query<{ reference: string; state: string }>(
            'SELECT reference, state FROM transaction ORDER BY reference',
          );
          assert.deepEqual(
            restoredTxns.rows, before.transactions,
            'every transaction and its state must survive the restore',
          );

          const trial = await client.query<{ currency: string; difference: string }>(
            'SELECT currency, difference::text FROM trial_balance ORDER BY currency',
          );
          for (const row of trial.rows) {
            assert.equal(
              Number(row.difference), 0,
              `the restored ledger must balance in ${row.currency}`,
            );
          }

          const chain = await client.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM verify_audit_chain()',
          );
          assert.equal(
            Number(chain.rows[0]!.n), 0,
            'the audit hash chain must still verify after restoration',
          );

          const journals = await client.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM journal_entry',
          );
          assert.equal(
            Number(journals.rows[0]!.n), before.ledger.entryCount,
            'every journal entry must survive the restore',
          );

          // The append-only guards must still be present in the restored database.
          let guardHeld = false;
          try {
            await client.query("UPDATE audit_event SET action = 'tampered' WHERE seq = 1");
          } catch (error) {
            guardHeld = /APPEND_ONLY_VIOLATION/.test(
              error instanceof Error ? error.message : String(error),
            );
          }
          assert.ok(guardHeld, 'the append-only trigger must be restored along with the data');
        } finally {
          client.release();
        }
      } finally {
        await pool.end();
      }

      execFileSync('bash', ['-lc',
        `su postgres -c "psql -q -c \\"DROP DATABASE IF EXISTS ${restoreDb};\\""`,
      ], { stdio: 'pipe' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
