/**
 * The double-entry ledger.
 *
 * Contract with the rest of the system:
 *
 *   - Nothing outside this module writes to `journal` or `journal_entry`.
 *   - Every posting is balanced per currency before it is offered to the database, and
 *     the database refuses it at COMMIT if it is not. Two independent checks, because a
 *     ledger that can go out of balance is not a ledger.
 *   - Corrections are reversals. There is no update path and no delete path.
 *   - Balances are always derived from entries. This module exposes no way to write one.
 *
 * On custody: the chart of accounts contains no customer stored-value account. A
 * customer's position exists as a RECEIVABLE (they owe us funding) and as a PAYABLE (we
 * owe the beneficiary delivery on their behalf). At no point does the ledger record
 * EKORails holding customer money, because EKORails is not authorised to.
 */

import type { Queryable } from '../../db/pool.js';
import { many, one, maybeOne } from '../../db/pool.js';
import { Decimal } from '../../core/money.js';
import { nextReference } from '../../core/ids.js';
import { recordAudit } from '../../audit/audit.js';

export type AccountCategory =
  | 'customer_funding_receivable'
  | 'customer_settlement_payable'
  | 'partner_funding_account'
  | 'partner_settlement_account'
  | 'fx_clearing'
  | 'fee_revenue'
  | 'partner_fees_payable'
  | 'regulatory_charges_payable'
  | 'settlement_suspense'
  | 'reconciliation_difference'
  | 'returned_funds'
  | 'test_liquidity';

export type JournalType =
  | 'test_liquidity_injection'
  | 'obligation_recognition'
  | 'funding_receipt'
  | 'fx_conversion'
  | 'partner_positioning'
  | 'settlement_payment'
  | 'partner_fee_payment'
  | 'regulatory_charge_payment'
  | 'return_receipt'
  | 'return_refund'
  | 'suspense_posting'
  | 'reconciliation_adjustment'
  | 'reversal';

/** The accounting character of each category, used to derive the normal side. */
export const ACCOUNT_SHAPE: Record<AccountCategory, { type: string; normalSide: 'debit' | 'credit' }> = {
  customer_funding_receivable: { type: 'asset', normalSide: 'debit' },
  customer_settlement_payable: { type: 'liability', normalSide: 'credit' },
  partner_funding_account: { type: 'asset', normalSide: 'debit' },
  partner_settlement_account: { type: 'asset', normalSide: 'debit' },
  fx_clearing: { type: 'clearing', normalSide: 'debit' },
  fee_revenue: { type: 'income', normalSide: 'credit' },
  partner_fees_payable: { type: 'liability', normalSide: 'credit' },
  regulatory_charges_payable: { type: 'liability', normalSide: 'credit' },
  settlement_suspense: { type: 'clearing', normalSide: 'debit' },
  reconciliation_difference: { type: 'clearing', normalSide: 'debit' },
  returned_funds: { type: 'liability', normalSide: 'credit' },
  test_liquidity: { type: 'equity', normalSide: 'credit' },
};

export interface PostingLine {
  accountId: string;
  direction: 'debit' | 'credit';
  amount: Decimal;
  currency: string;
  narrative: string;
  organizationId?: string | null;
  transactionId?: string | null;
}

export interface PostingRequest {
  journalType: JournalType;
  description: string;
  /** Plain-English explanation rendered in the Founder Learning Center. Mandatory. */
  plainEnglish: string;
  effectiveDate: Date;
  lines: PostingLine[];
  transactionId?: string | null;
  organizationId?: string | null;
  postedBy?: string | null;
  postedByProcess?: string;
}

export interface PostedJournal {
  journalId: string;
  reference: string;
  lineCount: number;
  totalsByCurrency: Array<{ currency: string; debits: string; credits: string }>;
}

export class LedgerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

/**
 * Application-side balance check. The database enforces this too; doing it here as well
 * gives a caller a precise, actionable error before a transaction is wasted, and it means
 * the invariant is stated in two independent places.
 */
export function assertBalanced(lines: readonly PostingLine[]): Array<{
  currency: string; debits: Decimal; credits: Decimal;
}> {
  if (lines.length < 2) {
    throw new LedgerError('JOURNAL_INCOMPLETE', 'A double entry requires at least two lines.');
  }
  const byCurrency = new Map<string, { debits: Decimal; credits: Decimal }>();
  for (const line of lines) {
    if (!line.amount.isPositive()) {
      throw new LedgerError(
        'NON_POSITIVE_AMOUNT',
        `Line "${line.narrative}" has amount ${line.amount.toString()}. Entries carry a direction and a ` +
        'strictly positive amount; a negative debit is a credit and must be written as one.',
      );
    }
    const bucket = byCurrency.get(line.currency) ?? { debits: Decimal.zero(), credits: Decimal.zero() };
    if (line.direction === 'debit') bucket.debits = bucket.debits.add(line.amount);
    else bucket.credits = bucket.credits.add(line.amount);
    byCurrency.set(line.currency, bucket);
  }
  const totals: Array<{ currency: string; debits: Decimal; credits: Decimal }> = [];
  for (const [currency, bucket] of byCurrency) {
    if (!bucket.debits.equals(bucket.credits)) {
      throw new LedgerError(
        'JOURNAL_IMBALANCE',
        `Journal does not balance in ${currency}: debits ${bucket.debits.toString()}, ` +
        `credits ${bucket.credits.toString()}, difference ${bucket.debits.subtract(bucket.credits).toString()}.`,
      );
    }
    totals.push({ currency, debits: bucket.debits, credits: bucket.credits });
  }
  return totals;
}

export async function post(db: Queryable, request: PostingRequest): Promise<PostedJournal> {
  const totals = assertBalanced(request.lines);

  if (request.plainEnglish.trim().length < 20) {
    throw new LedgerError(
      'MISSING_PLAIN_ENGLISH',
      'Every journal must carry a plain-English explanation. A ledger nobody can read is a ledger ' +
      'nobody can audit.',
    );
  }

  const reference = await nextReference(db, 'journal');
  const journal = await one<{ id: string }>(
    db,
    `INSERT INTO journal (
       reference, journal_type, transaction_id, organization_id, description,
       plain_english, effective_date, posted_by, posted_by_process
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      reference, request.journalType, request.transactionId ?? null,
      request.organizationId ?? null, request.description, request.plainEnglish,
      request.effectiveDate.toISOString().slice(0, 10),
      request.postedBy ?? null, request.postedByProcess ?? 'settlement_engine',
    ],
  );

  let lineNumber = 1;
  for (const line of request.lines) {
    await db.query(
      `INSERT INTO journal_entry (
         journal_id, line_number, ledger_account_id, direction, amount, currency,
         organization_id, transaction_id, narrative
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        journal.id, lineNumber++, line.accountId, line.direction,
        line.amount.toString(), line.currency,
        line.organizationId ?? request.organizationId ?? null,
        line.transactionId ?? request.transactionId ?? null,
        line.narrative,
      ],
    );
  }

  await recordAudit(db, {
    category: 'ledger_posting',
    action: `ledger.post.${request.journalType}`,
    outcome: 'success',
    actorUserId: request.postedBy ?? null,
    actorType: request.postedBy ? 'user' : 'system',
    organizationId: request.organizationId ?? null,
    entityType: 'journal',
    entityId: journal.id,
    transactionId: request.transactionId ?? null,
    metadata: {
      reference,
      journal_type: request.journalType,
      line_count: request.lines.length,
      totals: totals.map((t) => ({
        currency: t.currency, debits: t.debits.toString(), credits: t.credits.toString(),
      })),
    },
  });

  return {
    journalId: journal.id,
    reference,
    lineCount: request.lines.length,
    totalsByCurrency: totals.map((t) => ({
      currency: t.currency, debits: t.debits.toString(), credits: t.credits.toString(),
    })),
  };
}

/**
 * Reverses a journal by posting its mirror image and marking the original reversed.
 * The original's rows are never touched: a reader of the ledger sees both the mistake
 * and the correction, which is what an auditor needs.
 */
export async function reverse(
  db: Queryable,
  input: { journalId: string; reason: string; postedBy: string | null; effectiveDate?: Date },
): Promise<PostedJournal> {
  if (input.reason.trim().length < 10) {
    throw new LedgerError('MISSING_REVERSAL_REASON', 'A reversal requires a written reason.');
  }

  const original = await one<{
    id: string; reference: string; journal_type: string; transaction_id: string | null;
    organization_id: string | null; description: string; posting_status: string;
    effective_date: Date;
  }>(
    db,
    `SELECT id, reference, journal_type, transaction_id, organization_id, description,
            posting_status, effective_date
       FROM journal WHERE id = $1`,
    [input.journalId],
  );

  if (original.posting_status === 'reversed') {
    throw new LedgerError('ALREADY_REVERSED', `Journal ${original.reference} has already been reversed.`);
  }

  const lines = await many<{
    ledger_account_id: string; direction: string; amount: string; currency: string;
    narrative: string; organization_id: string | null; transaction_id: string | null;
  }>(
    db,
    `SELECT ledger_account_id, direction, amount::text, currency, narrative,
            organization_id, transaction_id
       FROM journal_entry WHERE journal_id = $1 ORDER BY line_number`,
    [input.journalId],
  );

  const reversalReference = await nextReference(db, 'journal');
  const reversal = await one<{ id: string }>(
    db,
    `INSERT INTO journal (
       reference, journal_type, transaction_id, organization_id, description, plain_english,
       effective_date, reverses_journal_id, reversal_reason, posted_by, posted_by_process
     ) VALUES ($1,'reversal',$2,$3,$4,$5,$6,$7,$8,$9,'ledger_reversal')
     RETURNING id`,
    [
      reversalReference, original.transaction_id, original.organization_id,
      `Reversal of ${original.reference}: ${original.description}`,
      `This journal cancels ${original.reference} in full. Every debit in the original becomes a credit ` +
      `here and every credit becomes a debit, so the two together have no net effect on any balance. ` +
      `The original entries remain in the ledger unchanged — a correction never erases what it corrects. ` +
      `Reason given: ${input.reason}`,
      (input.effectiveDate ?? new Date()).toISOString().slice(0, 10),
      original.id, input.reason, input.postedBy,
    ],
  );

  let lineNumber = 1;
  const mirrored: PostingLine[] = [];
  for (const line of lines) {
    const flipped = line.direction === 'debit' ? 'credit' : 'debit';
    mirrored.push({
      accountId: line.ledger_account_id,
      direction: flipped as 'debit' | 'credit',
      amount: Decimal.fromString(line.amount),
      currency: line.currency,
      narrative: `Reversal: ${line.narrative}`,
    });
    await db.query(
      `INSERT INTO journal_entry (
         journal_id, line_number, ledger_account_id, direction, amount, currency,
         organization_id, transaction_id, narrative
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        reversal.id, lineNumber++, line.ledger_account_id, flipped,
        line.amount, line.currency, line.organization_id, line.transaction_id,
        `Reversal: ${line.narrative}`,
      ],
    );
  }

  const totals = assertBalanced(mirrored);

  await db.query(
    `UPDATE journal SET posting_status = 'reversed', reversed_by_journal_id = $2 WHERE id = $1`,
    [original.id, reversal.id],
  );

  await recordAudit(db, {
    category: 'ledger_posting',
    action: 'ledger.reverse',
    outcome: 'success',
    actorUserId: input.postedBy,
    actorType: input.postedBy ? 'user' : 'system',
    organizationId: original.organization_id,
    entityType: 'journal',
    entityId: original.id,
    transactionId: original.transaction_id,
    reason: input.reason,
    metadata: { original_reference: original.reference, reversal_reference: reversalReference },
  });

  return {
    journalId: reversal.id,
    reference: reversalReference,
    lineCount: lines.length,
    totalsByCurrency: totals.map((t) => ({
      currency: t.currency, debits: t.debits.toString(), credits: t.credits.toString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

export interface AccountKey {
  category: AccountCategory;
  currency: string;
  organizationId?: string | null;
  partnerId?: string | null;
}

function accountCode(key: AccountKey): string {
  const scope = key.organizationId
    ? `ORG-${key.organizationId.slice(0, 8)}`
    : key.partnerId
      ? `PTR-${key.partnerId.slice(0, 8)}`
      : 'PLATFORM';
  return `${key.category.toUpperCase()}:${scope}`;
}

/**
 * Finds or creates the ledger account for a (category, currency, counterparty) triple.
 * Creation is idempotent under concurrency via the unique (code, currency) index.
 */
export async function resolveAccount(db: Queryable, key: AccountKey): Promise<string> {
  const code = accountCode(key);
  const existing = await maybeOne<{ id: string }>(
    db, 'SELECT id FROM ledger_account WHERE code = $1 AND currency = $2', [code, key.currency],
  );
  if (existing) return existing.id;

  const shape = ACCOUNT_SHAPE[key.category];
  const created = await one<{ id: string }>(
    db,
    `INSERT INTO ledger_account (code, name, category, normal_side, account_type, currency,
                                 organization_id, partner_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (code, currency) DO UPDATE SET name = ledger_account.name
     RETURNING id`,
    [
      code,
      `${key.category.replace(/_/g, ' ')} (${key.currency})`,
      key.category, shape.normalSide, shape.type, key.currency,
      key.organizationId ?? null, key.partnerId ?? null,
    ],
  );
  return created.id;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AccountBalance {
  ledgerAccountId: string;
  code: string;
  name: string;
  category: string;
  accountType: string;
  normalSide: string;
  currency: string;
  organizationId: string | null;
  partnerId: string | null;
  totalDebits: string;
  totalCredits: string;
  balanceNatural: string;
  entryCount: number;
  isSimulated: boolean;
}

export async function accountBalances(
  db: Queryable,
  filter: { currency?: string; organizationId?: string; category?: string } = {},
): Promise<AccountBalance[]> {
  const rows = await many<Record<string, string | null>>(
    db,
    `SELECT ledger_account_id, code, name, category, account_type, normal_side, currency,
            organization_id, partner_id, total_debits::text, total_credits::text,
            balance_natural::text, entry_count::text, is_simulated::text
       FROM ledger_account_balance
      WHERE ($1::text IS NULL OR currency = $1)
        AND ($2::uuid IS NULL OR organization_id = $2)
        AND ($3::text IS NULL OR category = $3)
      ORDER BY currency, category, code`,
    [filter.currency ?? null, filter.organizationId ?? null, filter.category ?? null],
  );
  return rows.map((r) => ({
    ledgerAccountId: r['ledger_account_id']!,
    code: r['code']!,
    name: r['name']!,
    category: r['category']!,
    accountType: r['account_type']!,
    normalSide: r['normal_side']!,
    currency: r['currency']!,
    organizationId: r['organization_id'] ?? null,
    partnerId: r['partner_id'] ?? null,
    totalDebits: r['total_debits']!,
    totalCredits: r['total_credits']!,
    balanceNatural: r['balance_natural']!,
    entryCount: Number(r['entry_count']),
    isSimulated: r['is_simulated'] === 'true',
  }));
}

export interface TrialBalanceRow {
  currency: string;
  totalDebits: string;
  totalCredits: string;
  difference: string;
  balanced: boolean;
}

export async function trialBalance(db: Queryable): Promise<TrialBalanceRow[]> {
  const rows = await many<{
    currency: string; total_debits: string; total_credits: string; difference: string;
  }>(
    db,
    'SELECT currency, total_debits::text, total_credits::text, difference::text FROM trial_balance ORDER BY currency',
  );
  return rows.map((r) => ({
    currency: r.currency,
    totalDebits: r.total_debits,
    totalCredits: r.total_credits,
    difference: r.difference,
    balanced: Decimal.fromString(r.difference).isZero(),
  }));
}

/** Journals attached to one transaction, with their entries. Powers the Ledger Explorer. */
export async function journalsForTransaction(
  db: Queryable, transactionId: string,
): Promise<Array<Record<string, unknown>>> {
  const journals = await many<Record<string, unknown>>(
    db,
    `SELECT j.id, j.reference, j.journal_type, j.description, j.plain_english,
            j.effective_date, j.posted_at, j.posting_status, j.is_simulated,
            j.reverses_journal_id, j.reversed_by_journal_id
       FROM journal j WHERE j.transaction_id = $1 ORDER BY j.posted_at, j.reference`,
    [transactionId],
  );

  for (const journal of journals) {
    journal['entries'] = await many<Record<string, unknown>>(
      db,
      `SELECT e.line_number, e.direction, e.amount::text AS amount, e.currency, e.narrative,
              a.code AS account_code, a.name AS account_name, a.category AS account_category,
              a.normal_side, a.account_type
         FROM journal_entry e JOIN ledger_account a ON a.id = e.ledger_account_id
        WHERE e.journal_id = $1 ORDER BY e.line_number`,
      [journal['id']],
    );
  }
  return journals;
}

/**
 * Verifies that the whole ledger balances, per currency, and that every individual
 * journal balances. Run by the reconciliation job and by the ledger integrity test.
 */
export interface LedgerIntegrityReport {
  trialBalanceBalanced: boolean;
  trialBalance: TrialBalanceRow[];
  unbalancedJournals: Array<{ reference: string; currency: string; difference: string }>;
  singleLineJournals: string[];
  journalCount: number;
  entryCount: number;
}

export async function verifyLedgerIntegrity(db: Queryable): Promise<LedgerIntegrityReport> {
  const tb = await trialBalance(db);

  const unbalanced = await many<{ reference: string; currency: string; difference: string }>(
    db,
    `SELECT j.reference, e.currency,
            SUM(CASE WHEN e.direction = 'debit' THEN e.amount ELSE -e.amount END)::text AS difference
       FROM journal j JOIN journal_entry e ON e.journal_id = j.id
      GROUP BY j.reference, e.currency
     HAVING SUM(CASE WHEN e.direction = 'debit' THEN e.amount ELSE -e.amount END) <> 0`,
  );

  const singleLine = await many<{ reference: string }>(
    db,
    `SELECT j.reference FROM journal j
       JOIN journal_entry e ON e.journal_id = j.id
      GROUP BY j.reference HAVING count(*) < 2`,
  );

  const counts = await one<{ journals: string; entries: string }>(
    db,
    `SELECT (SELECT count(*)::text FROM journal) AS journals,
            (SELECT count(*)::text FROM journal_entry) AS entries`,
  );

  return {
    trialBalanceBalanced: tb.every((r) => r.balanced),
    trialBalance: tb,
    unbalancedJournals: unbalanced,
    singleLineJournals: singleLine.map((r) => r.reference),
    journalCount: Number(counts.journals),
    entryCount: Number(counts.entries),
  };
}
