/**
 * The Founder Learning Center.
 *
 * This is not documentation bolted on afterwards. It reads the live system: the product
 * map reports each module's real completion stage, the walkthrough is built from an
 * actual transaction's transitions and journals, the rule library shows how often each
 * rule has genuinely fired, and the decision log holds the founder decisions that are
 * still blocking the pilot.
 *
 * The honesty rule for everything in here: if something is simulated, it says so; if a
 * module is built but untested, it says that too. A learning centre that flatters the
 * build teaches the founder something false.
 */

import type { Queryable } from '../../db/pool.js';
import { many, maybeOne, one } from '../../db/pool.js';
import { recordAudit } from '../../audit/audit.js';
import { notFound, precondition } from '../../core/errors.js';
import { environment } from '../../core/env.js';
import { timeline } from '../settlement/service.js';
import { findTransition } from '../settlement/machine.js';

export async function productMap(db: Queryable): Promise<Record<string, unknown>> {
  const modules = await many<Record<string, unknown>>(
    db, 'SELECT * FROM learning_module ORDER BY ordinal',
  );
  return {
    modules,
    completion_definitions: [
      { stage: 'designed', means: 'The behaviour is specified and the data model supports it. No code yet.' },
      { stage: 'frontend_built', means: 'A user can see it. It may not do anything.' },
      { stage: 'backend_built', means: 'The logic exists and works when called directly.' },
      { stage: 'integrated', means: 'Front end and back end are connected and the flow works end to end.' },
      { stage: 'tested', means: 'Automated tests cover the behaviour, including its failure modes.' },
      { stage: 'security_reviewed', means: 'The module has been examined for the threats in the threat model.' },
      { stage: 'founder_accepted', means: 'You have used it and confirmed it does what you need.' },
      { stage: 'pilot_ready', means: 'Every stage above is complete AND its regulatory dependencies are cleared.' },
    ],
    honesty_note:
      'A feature is never reported as complete because its interface exists. The stage shown for each ' +
      'module is the highest stage it has genuinely reached.',
  };
}

export async function glossary(db: Queryable): Promise<Array<Record<string, unknown>>> {
  return many<Record<string, unknown>>(db, 'SELECT * FROM learning_glossary ORDER BY term');
}

export function architecture(): Record<string, unknown> {
  const env = environment();
  return {
    environment: { mode: env.mode, live_funds_enabled: env.liveFundsEnabled },
    components: [
      {
        key: 'web',
        name: 'Business and back-office consoles',
        layer: 'frontend',
        plain_english:
          'The screens people use. Six separate consoles — business, operations, compliance, finance, ' +
          'auditor and administration — because the same screen serving every role is how a business ' +
          'user ends up seeing a compliance queue.',
        talks_to: ['api'],
        security_note:
          'Runs under a strict Content-Security-Policy with no inline scripts and no external origins. ' +
          'It holds no secrets: the session cookie is HttpOnly and the browser cannot read it.',
        status: 'built',
      },
      {
        key: 'api',
        name: 'Settlement orchestration API',
        layer: 'backend',
        plain_english:
          'Every rule in the product lives here. It authenticates the caller, checks their permission ' +
          'for the specific action, runs the compliance engine, posts to the ledger and calls the ' +
          'partners. Nothing bypasses it.',
        talks_to: ['database', 'partners', 'storage', 'observability'],
        security_note:
          'Connects to the database as a restricted role with no UPDATE or DELETE privilege on audit, ' +
          'ledger or compliance tables. A bug in this layer cannot rewrite history.',
        status: 'built',
      },
      {
        key: 'database',
        name: 'PostgreSQL',
        layer: 'data',
        plain_english:
          'Where everything is stored, and — more importantly — where the rules that must never be ' +
          'broken are enforced. Journals that do not balance are refused at commit. Audit records ' +
          'cannot be edited. Customers cannot see one another\'s rows.',
        talks_to: [],
        security_note:
          'Row-level security with FORCE on every table carrying customer data, plus append-only ' +
          'triggers and a hash-chained audit trail. Sensitive fields are encrypted with AES-256-GCM ' +
          'before they are written.',
        status: 'built',
      },
      {
        key: 'ledger',
        name: 'Double-entry ledger',
        layer: 'data',
        plain_english:
          'The financial record. Every movement is two or more entries that sum to zero within each ' +
          'currency. Balances are never stored — they are always added up from the entries, so there ' +
          'is nothing to drift out of line.',
        talks_to: ['database'],
        security_note:
          'Corrections are made by posting a reversal, never by changing an entry. Both the mistake ' +
          'and the correction stay visible.',
        status: 'built',
      },
      {
        key: 'compliance',
        name: 'Compliance engine and screening providers',
        layer: 'backend',
        plain_english:
          'Runs every rule against every transaction and records what it found — including the rules ' +
          'that did not fire. Screening for sanctions, PEP and adverse media goes out to a provider.',
        talks_to: ['database', 'partners'],
        security_note:
          'Evaluations are immutable and self-contained: they store the rule text and parameter values ' +
          'in force at the time, so a decision can be reproduced years later.',
        status: 'built (screening provider is SIMULATED)',
      },
      {
        key: 'partners',
        name: 'Partner institutions',
        layer: 'external',
        plain_english:
          'The licensed institutions that actually hold and move money: the origin bank, the FX ' +
          'provider, the settlement institution and the destination bank. EKORails instructs them; ' +
          'it does not do their job.',
        talks_to: [],
        security_note:
          'Every instruction carries an idempotency key derived from the transaction reference, so the ' +
          'same instruction can never become two payments.',
        status: 'ALL SIMULATED. No real institution is connected.',
      },
      {
        key: 'storage',
        name: 'Document storage',
        layer: 'data',
        plain_english:
          'Where uploaded invoices, contracts and identity documents live. Downloads go through a ' +
          'short-lived signed link, and every link that is minted is recorded.',
        talks_to: [],
        security_note:
          'Encrypted at rest with a per-document key reference. Content hashes prove a document has ' +
          'not changed since upload. Full antivirus scanning is a NAMED GAP, not a claimed control.',
        status: 'metadata and integrity built; blob store and antivirus not deployed',
      },
      {
        key: 'reporting',
        name: 'Reporting and exports',
        layer: 'backend',
        plain_english:
          'Turns the data into the reports operations, compliance, finance and a regulator each need. ' +
          'The same report shows different detail depending on who asks.',
        talks_to: ['database'],
        security_note:
          'Every export is recorded with a hash of what was produced and the masking profile that ' +
          'produced it, so it is provable what was disclosed and to whom.',
        status: 'built',
      },
      {
        key: 'observability',
        name: 'Logging, metrics and alerting',
        layer: 'platform',
        plain_english:
          'How we find out something is wrong. Structured logs, request tracing and security alerts.',
        talks_to: [],
        security_note:
          'Every log line passes through a redaction layer. Passwords, tokens, full account numbers ' +
          'and identification numbers cannot be written to a log.',
        status: 'structured logging and redaction built; metrics, tracing and uptime monitoring NOT deployed',
      },
    ],
    data_flows: [
      { from: 'web', to: 'api', carries: 'User actions, over HTTPS with a session cookie and a CSRF token' },
      { from: 'api', to: 'database', carries: 'Parameterised queries inside a transaction with the caller\'s security context set' },
      { from: 'api', to: 'partners', carries: 'Settlement and screening instructions, with idempotency keys (SIMULATED)' },
      { from: 'partners', to: 'api', carries: 'Outcomes and statements (SIMULATED)' },
      { from: 'api', to: 'storage', carries: 'Encrypted document bytes and short-lived signed download links' },
      { from: 'api', to: 'observability', carries: 'Redacted structured logs and security events' },
    ],
    what_is_not_here_yet: [
      'A managed object store for document blobs (documents are metadata-tracked but not blob-stored in this build).',
      'A real antivirus scanning service.',
      'A shared cache and durable job runner for multi-instance deployment (the job table exists; the worker is single-process).',
      'Metrics, distributed tracing and uptime monitoring.',
      'An OIDC identity provider (authentication is built in, and is OIDC-compatible by design, but no external provider is connected).',
    ],
  };
}

export async function decisionLog(db: Queryable): Promise<Record<string, unknown>> {
  const decisions = await many<Record<string, unknown>>(
    db,
    `SELECT decision_ref, title, decision_date, status, context, options_considered,
            recommended_option, reason_selected, main_risk, regulatory_impact, cost_impact,
            reversibility, approver, approved_at, blocks
       FROM decision_log ORDER BY decision_ref`,
  );
  const open = decisions.filter((d) => d['status'] === 'awaiting_approval');
  return {
    decisions,
    open_count: open.length,
    blocking_pilot: open.map((d) => ({ ref: d['decision_ref'], title: d['title'], blocks: d['blocks'] })),
    note:
      'A decision marked "awaiting_approval" is genuinely unresolved. The software runs with a ' +
      'placeholder in its place and says so wherever the placeholder is visible.',
  };
}

export async function approveDecision(
  db: Queryable, decisionRef: string, approverName: string, reason: string, userId: string,
): Promise<Record<string, unknown>> {
  const existing = await maybeOne<{ status: string; title: string }>(
    db, 'SELECT status, title FROM decision_log WHERE decision_ref = $1', [decisionRef],
  );
  if (!existing) throw notFound('DECISION_NOT_FOUND', 'Decision not found.');
  if (existing.status !== 'awaiting_approval') {
    throw precondition('DECISION_NOT_OPEN', `Decision ${decisionRef} is already "${existing.status}".`);
  }

  await db.query(
    `UPDATE decision_log
        SET status = 'approved', approver = $2, approved_at = now(),
            reason_selected = $3, decision_date = CURRENT_DATE
      WHERE decision_ref = $1`,
    [decisionRef, approverName, reason],
  );

  await recordAudit(db, {
    category: 'configuration_change', action: 'decision.approve', outcome: 'success',
    actorUserId: userId, entityType: 'decision_log', entityId: null,
    reason,
    metadata: {
      decision_ref: decisionRef, title: existing.title, approver: approverName,
      note:
        'Approving a decision here records the founder\'s choice. It does NOT change any configuration ' +
        'by itself — the corresponding placeholder must still be replaced under maker-checker.',
    },
  });

  return {
    decision_ref: decisionRef, status: 'approved',
    next_step:
      'Recording approval does not change the software. The placeholder this decision governs must ' +
      'still be replaced through a maker-checker configuration change.',
  };
}

/**
 * A guided walkthrough of one transaction, organised by actor rather than by timestamp,
 * with the five questions the brief asks to be answered at every stage.
 */
export async function walkthrough(db: Queryable, transactionId: string): Promise<Record<string, unknown>> {
  const data = await timeline(db, transactionId);
  if (!data) throw notFound('TRANSACTION_NOT_FOUND', 'Transaction not found.');

  const transitions = data['transitions'] as Array<Record<string, unknown>>;
  const journals = data['journals'] as Array<Record<string, unknown>>;

  const ACTOR_OF: Record<string, string> = {
    submit_for_approval: 'Business (initiator)',
    business_approve: 'Business (approver)',
    business_reject: 'Business (approver)',
    compliance_approve: 'Compliance',
    compliance_reject: 'Compliance',
    compliance_request_information: 'Compliance',
    compliance_suspend: 'Compliance',
    investigation_cleared: 'Compliance (manager)',
    investigation_rejected: 'Compliance (manager)',
    quote_issue: 'Treasury',
    quote_accept: 'Business (approver)',
    request_funding: 'Treasury',
    funding_confirm: 'Partner / Treasury',
    prepare_settlement: 'Treasury',
    submit_to_partner: 'Treasury',
    partner_accepted: 'Partner',
    partner_settled: 'Partner',
    partner_settled_immediate: 'Partner',
    partner_rejected: 'Partner',
    partner_failed: 'Partner',
    partner_outcome_unknown: 'System (no partner response)',
    partial_settlement: 'Partner',
    beneficiary_confirm: 'Destination bank',
    payment_returned_from_settled: 'Destination bank',
    reconcile: 'Finance',
    reconcile_without_confirmation: 'Finance',
    complete: 'Finance',
  };

  const WHAT_COULD_GO_WRONG: Record<string, string> = {
    submit_for_approval: 'The wrong beneficiary is selected. This is why the beneficiary must be separately approved before first use.',
    business_approve: 'The same person approves their own payment. The database refuses it.',
    compliance_approve: 'An alert is cleared without a real reason. The reason field has a minimum length and the decision is permanent.',
    quote_issue: 'A rate is presented as guaranteed when it is not. Simulated quotes cannot be marked as locked.',
    quote_accept: 'The rate has moved since it was quoted. An expired quote is refused rather than honoured.',
    funding_confirm: 'Less arrives than expected. Short funding raises an exception and does not proceed to settlement.',
    prepare_settlement: 'Currency is converted without the matching liquidity being positioned, leaving an open FX position. The FX clearing account makes that visible.',
    submit_to_partner: 'The instruction is sent twice. The idempotency key prevents a second payment.',
    partner_outcome_unknown: 'We retry blindly and pay twice. Automatic retry is disabled in this state; a person must establish the true position first.',
    partial_settlement: 'The shortfall is quietly written off. It goes to settlement suspense with an owner instead.',
    payment_returned_from_settled: 'The original settlement is erased to "tidy up". It is not — a return is a new event.',
    reconcile: 'A difference is resolved by overwriting one side. Reconciliation opens a break instead.',
    complete: 'A transaction is completed with an open break against it. This is refused.',
  };

  const steps = transitions.map((t) => {
    const event = String(t['to_state'] ?? '');
    const definition = findTransition(t['from_state'] as never, event) ?? null;
    const matchedEvent = Object.keys(ACTOR_OF).find((k) => {
      const d = findTransition(t['from_state'] as never, k);
      return d?.to === t['to_state'];
    }) ?? '';
    const def = findTransition(t['from_state'] as never, matchedEvent);

    return {
      from: t['from_state'],
      to: t['to_state'],
      occurred_at: t['occurred_at'],
      who_is_responsible: ACTOR_OF[matchedEvent] ?? (t['actor_type'] === 'partner' ? 'Partner' : 'System'),
      actor_name: t['actor_name'] ?? t['partner_name'] ?? 'System',
      what_is_happening: def?.description ?? String(t['reason'] ?? ''),
      why_it_matters: def?.preconditions.length
        ? `This step is only allowed once: ${def.preconditions.join('; ')}.`
        : 'This step has no preconditions beyond being in the previous state.',
      what_could_go_wrong: WHAT_COULD_GO_WRONG[matchedEvent]
        ?? 'The main risk at this step is acting without recording why. Every transition requires a reason.',
      what_evidence_is_retained: [
        'An append-only transition record with the actor, the reason and the timestamp.',
        'A hash-chained audit event linked to this transaction.',
        t['journal_reference'] ? `Ledger journal ${t['journal_reference']}.` : 'No ledger entry — this step has no accounting consequence.',
      ],
      accounting_consequence: def?.accountingConsequence ?? 'none',
      journal_reference: t['journal_reference'] ?? null,
      journal_explanation: t['journal_explanation'] ?? null,
      reason_given: t['reason'],
    };
  });

  const ledgerExplanation = journals.map((j) => ({
    reference: j['reference'],
    type: j['journal_type'],
    plain_english: j['plain_english'],
    posting_status: j['posting_status'],
    effective_date: j['effective_date'],
    entries: (j['entries'] as Array<Record<string, unknown>>).map((e) => ({
      direction: e['direction'],
      account: e['account_name'],
      account_code: e['account_code'],
      amount: e['amount'],
      currency: e['currency'],
      what_this_means:
        e['direction'] === 'debit'
          ? explainDebit(String(e['account_category']), String(e['account_type']))
          : explainCredit(String(e['account_category']), String(e['account_type'])),
      narrative: e['narrative'],
    })),
    how_a_reversal_would_work:
      `A reversal would post a new journal in which every debit above becomes a credit and every ` +
      `credit becomes a debit, for the same amounts. The two journals together would have no net ` +
      `effect on any balance. This journal would be marked "reversed" but its entries would remain ` +
      `exactly as they are — a correction never erases what it corrects.`,
  }));

  return {
    transaction: data['transaction'],
    steps,
    ledger_explanation: ledgerExplanation,
    reconciliation: data['exceptions'],
    audit_events: data['audit_events'],
    customer_notifications: data['notifications'],
    partner_interactions: (data['integration_events'] as Array<Record<string, unknown>>).map((e) => ({
      operation: e['operation'],
      direction: e['direction'],
      outcome: e['outcome'],
      latency_ms: e['latency_ms'],
      simulated_scenario: e['simulation_scenario'],
      occurred_at: e['occurred_at'],
      note: 'This exchange was with a SIMULATOR, not a real institution.',
    })),
  };
}

function explainDebit(category: string, accountType: string): string {
  switch (category) {
    case 'customer_funding_receivable': return 'The customer now owes us this much to fund the payment.';
    case 'customer_settlement_payable': return 'Our obligation to deliver value goes down by this much.';
    case 'partner_funding_account': return 'The partner now holds this much more of the customer\'s funds.';
    case 'partner_settlement_account': return 'The settlement partner now holds this much more.';
    case 'fx_clearing': return 'We have taken on this much of one currency in a conversion. It should be cleared by matching positioning.';
    case 'partner_fees_payable': return 'A fee we owed the partner has been paid, so what we owe goes down.';
    case 'settlement_suspense': return 'This amount is unexplained and is parked here until someone resolves it.';
    case 'reconciliation_difference': return 'This is a difference between our records and a partner\'s that nobody has yet explained.';
    default: return accountType === 'asset'
      ? 'This asset went up by this amount.'
      : 'This balance moved in the debit direction by this amount.';
  }
}

function explainCredit(category: string, accountType: string): string {
  switch (category) {
    case 'customer_funding_receivable': return 'The customer no longer owes us this much — they have funded it.';
    case 'customer_settlement_payable': return 'We have taken on an obligation to deliver this much value.';
    case 'partner_funding_account': return 'Funds left the partner\'s account by this amount.';
    case 'partner_settlement_account': return 'The settlement partner paid out this much.';
    case 'fx_clearing': return 'We have given up this much of one currency in a conversion.';
    case 'fee_revenue': return 'We earned this much in fees.';
    case 'partner_fees_payable': return 'We now owe the partner this much in fees.';
    case 'regulatory_charges_payable': return 'We now owe this much in levies or charges.';
    case 'returned_funds': return 'We now owe the customer a refund of this amount.';
    case 'test_liquidity': return 'This money was invented for the demonstration. No real funds correspond to it.';
    default: return accountType === 'liability'
      ? 'This liability went up by this amount.'
      : 'This balance moved in the credit direction by this amount.';
  }
}

export async function assessment(db: Queryable, moduleKey: string): Promise<Record<string, unknown>> {
  const module = await maybeOne<{ key: string; title: string }>(
    db, 'SELECT key, title FROM learning_module WHERE key = $1', [moduleKey],
  );
  if (!module) throw notFound('MODULE_NOT_FOUND', 'Module not found.');

  const questions = await many<{ id: string; ordinal: number; question: string; options: string[] }>(
    db,
    'SELECT id, ordinal, question, options FROM learning_assessment_question WHERE module_key = $1 ORDER BY ordinal',
    [moduleKey],
  );
  return {
    module: module.title,
    module_key: module.key,
    // Correct answers are deliberately not sent to the client.
    questions: questions.map((q) => ({ ordinal: q.ordinal, question: q.question, options: q.options })),
    note: 'Your answers are recorded but never restrict what you can do in the system.',
  };
}

export async function submitAssessment(
  db: Queryable, moduleKey: string, userId: string, answers: number[],
): Promise<Record<string, unknown>> {
  const questions = await many<{
    ordinal: number; question: string; options: string[]; correct_index: number; explanation: string;
  }>(
    db,
    `SELECT ordinal, question, options, correct_index, explanation
       FROM learning_assessment_question WHERE module_key = $1 ORDER BY ordinal`,
    [moduleKey],
  );
  if (questions.length === 0) throw notFound('MODULE_NOT_FOUND', 'No assessment for that module.');

  const results = questions.map((q, i) => ({
    ordinal: q.ordinal,
    question: q.question,
    your_answer: answers[i] !== undefined ? q.options[answers[i]!] ?? null : null,
    correct_answer: q.options[q.correct_index],
    correct: answers[i] === q.correct_index,
    explanation: q.explanation,
  }));
  const score = results.filter((r) => r.correct).length;

  await db.query(
    `INSERT INTO learning_assessment_attempt (user_id, module_key, answers, score, total)
     VALUES ($1,$2,$3::jsonb,$4,$5)`,
    [userId, moduleKey, JSON.stringify(answers), score, questions.length],
  );

  return {
    score, total: questions.length, results,
    note: 'This result is recorded for your own reference and does not restrict your access to anything.',
  };
}
