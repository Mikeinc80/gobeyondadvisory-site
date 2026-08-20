/**
 * FX quotation.
 *
 * Language rules enforced here, not merely documented:
 *
 *   - A quote is "indicative" until accepted. It becomes "locked" ONLY where a partner
 *     has contractually locked the rate, which requires a lock evidence reference. A
 *     simulated quote can never be locked — the database refuses it (see the
 *     `simulated_quote_cannot_lock` constraint) and so does this module.
 *   - Every simulated rate carries `is_simulated = true`, and the API response carries a
 *     mandatory label. The claims lint fails the build on "guaranteed rate", "no spread",
 *     "zero loss" or "best market rate" anywhere in user-facing text.
 *
 * Pricing is decomposed, never netted. Reference rate, provider rate, spread, EKORails
 * fee, partner fee and any levy are all separate stored columns. A customer, an auditor
 * or a regulator can see exactly what each component was, which is impossible if the
 * margin is hidden inside the rate.
 */

import type { Queryable } from '../../db/pool.js';
import { one, maybeOne, many } from '../../db/pool.js';
import { Decimal, MONEY_SCALE, RATE_SCALE } from '../../core/money.js';
import { nextReference } from '../../core/ids.js';
import { recordAudit } from '../../audit/audit.js';
import { precondition, invalid, notFound } from '../../core/errors.js';

export type QuoteSource = 'manual_treasury_entry' | 'test_market_data_provider' | 'mock_liquidity_provider';

export const DEFAULT_QUOTE_VALIDITY_SECONDS = 900; // 15 minutes

export interface FeeSchedule {
  ekorailsFixed: Decimal;
  ekorailsBps: Decimal;
  partnerFixed: Decimal;
  partnerBps: Decimal;
  levyFixed: Decimal;
  levyBps: Decimal;
  levyBasis: string | null;
  currency: string;
}

export interface QuoteRequest {
  organizationId: string;
  corridorId: string;
  sendAmount: Decimal;
  sendCurrency: string;
  receiveCurrency: string;
  /** Where the rate came from and what it was. */
  referenceRate: Decimal;
  referenceRateSource: string;
  referenceRateAt: Date;
  providerRate: Decimal;
  quoteSource: QuoteSource;
  quoteSourceDetail?: string;
  isSimulated: boolean;
  validitySeconds?: number;
  issuedBy: string | null;
  fees: FeeSchedule;
  /** Only supplied where a partner has contractually locked the rate. */
  lockEvidenceRef?: string | null;
}

export interface QuoteBreakdown {
  quoteId: string;
  reference: string;
  sendCurrency: string;
  receiveCurrency: string;
  sendAmount: string;
  referenceRate: string;
  referenceRateSource: string;
  referenceRateAt: string;
  providerRate: string;
  spreadBps: string;
  ekorailsFee: string;
  partnerFee: string;
  taxOrLevy: string;
  taxBasis: string | null;
  feeCurrency: string;
  totalPayable: string;
  expectedReceivable: string;
  quoteSource: QuoteSource;
  quoteSourceDetail: string | null;
  isSimulated: boolean;
  lockStatus: 'indicative' | 'locked';
  issuedAt: string;
  expiresAt: string;
  status: string;
  /** The mandatory user-facing label. Never omitted, never softened. */
  rateLabel: string;
  disclosures: string[];
}

/** Basis points as a Decimal, e.g. 250 bps = 2.5%. */
export function bps(value: number | string): Decimal {
  return Decimal.fromString(typeof value === 'number' ? value.toFixed(4) : value, 4);
}

/**
 * Computes the spread between the reference (mid-market) rate and the provider rate, in
 * basis points. Positive means the customer receives less than mid-market.
 *
 * spread_bps = (reference - provider) / reference * 10000
 */
export function computeSpreadBps(referenceRate: Decimal, providerRate: Decimal): Decimal {
  if (!referenceRate.isPositive()) {
    throw invalid('INVALID_REFERENCE_RATE', 'The reference rate must be positive.');
  }
  const diff = referenceRate.subtract(providerRate);
  const ratio = diff.divide(referenceRate, 'half_even', RATE_SCALE);
  return ratio.multiply(Decimal.fromString('10000.000000000000', RATE_SCALE), 'half_even', 4);
}

function applyFee(amount: Decimal, fixed: Decimal, rate: Decimal): Decimal {
  // Fixed component plus a basis-point component, rounded half-up: a charge is rounded
  // against us only where the rule says so, and we state which way it went.
  const variable = amount.multiplyBasisPoints(rate, 'half_up');
  return fixed.add(variable);
}

export async function issueQuote(db: Queryable, req: QuoteRequest): Promise<QuoteBreakdown> {
  if (!req.sendAmount.isPositive()) {
    throw invalid('INVALID_AMOUNT', 'The send amount must be greater than zero.');
  }
  if (!req.providerRate.isPositive()) {
    throw invalid('INVALID_RATE', 'The provider rate must be greater than zero.');
  }

  // A simulated quote cannot claim a contractual lock. Refused here and again by a
  // database constraint, because this is exactly the sort of claim that quietly creeps
  // into a demo and then into a pitch deck.
  const wantsLock = Boolean(req.lockEvidenceRef);
  if (wantsLock && req.isSimulated) {
    throw precondition(
      'SIMULATED_QUOTE_CANNOT_LOCK',
      'A simulated quote cannot be marked as locked. A rate lock is a contractual commitment by a ' +
      'partner institution; no simulator can make one.',
    );
  }

  const ekorailsFee = applyFee(req.sendAmount, req.fees.ekorailsFixed, req.fees.ekorailsBps);
  const partnerFee = applyFee(req.sendAmount, req.fees.partnerFixed, req.fees.partnerBps);
  const levy = applyFee(req.sendAmount, req.fees.levyFixed, req.fees.levyBps);

  const totalPayable = req.sendAmount.add(ekorailsFee).add(partnerFee).add(levy);

  // The principal converts, not the total: fees are ours and the partner's, and are not
  // remitted to the beneficiary. Rounding is half-even to avoid a systematic bias in
  // our favour across many transactions.
  const expectedReceivable = req.sendAmount.multiply(req.providerRate, 'half_even', MONEY_SCALE);

  if (!expectedReceivable.isPositive()) {
    throw invalid(
      'RATE_PRODUCES_ZERO',
      `At rate ${req.providerRate.toString()} the receivable rounds to zero. Refusing to issue a quote ` +
      'that promises nothing.',
    );
  }

  const spread = computeSpreadBps(req.referenceRate, req.providerRate);
  const reference = await nextReference(db, 'quote');
  const validity = req.validitySeconds ?? DEFAULT_QUOTE_VALIDITY_SECONDS;

  const row = await one<{ id: string; issued_at: Date; expires_at: Date }>(
    db,
    `INSERT INTO fx_quote (
       reference, organization_id, corridor_id, send_currency, receive_currency, send_amount,
       reference_rate, reference_rate_source, reference_rate_at, provider_rate, spread_bps,
       ekorails_fee, ekorails_fee_currency, partner_fee, partner_fee_currency,
       tax_or_levy, tax_or_levy_currency, tax_basis,
       total_payable, total_payable_currency, expected_receivable, expected_receive_currency,
       quote_source, quote_source_detail, is_simulated, lock_status, lock_evidence_ref,
       expires_at, issued_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
       $23,$24,$25,$26,$27, now() + ($28 || ' seconds')::interval, $29
     )
     RETURNING id, issued_at, expires_at`,
    [
      reference, req.organizationId, req.corridorId, req.sendCurrency, req.receiveCurrency,
      req.sendAmount.toString(),
      req.referenceRate.toString(), req.referenceRateSource, req.referenceRateAt,
      req.providerRate.toString(), spread.toString(),
      ekorailsFee.toString(), req.fees.currency,
      partnerFee.toString(), req.fees.currency,
      levy.toString(), req.fees.currency, req.fees.levyBasis,
      totalPayable.toString(), req.sendCurrency,
      expectedReceivable.toString(), req.receiveCurrency,
      req.quoteSource, req.quoteSourceDetail ?? null, req.isSimulated,
      wantsLock ? 'locked' : 'indicative', req.lockEvidenceRef ?? null,
      String(validity), req.issuedBy,
    ],
  );

  await recordAudit(db, {
    category: 'data_create',
    action: 'fx.quote.issue',
    outcome: 'success',
    actorUserId: req.issuedBy,
    actorType: req.issuedBy ? 'user' : 'system',
    organizationId: req.organizationId,
    entityType: 'fx_quote',
    entityId: row.id,
    newValues: {
      reference, send_amount: req.sendAmount.toString(), send_currency: req.sendCurrency,
      provider_rate: req.providerRate.toString(), spread_bps: spread.toString(),
      total_payable: totalPayable.toString(), expected_receivable: expectedReceivable.toString(),
      is_simulated: req.isSimulated, quote_source: req.quoteSource,
    },
  });

  return buildBreakdown({
    quoteId: row.id, reference,
    sendCurrency: req.sendCurrency, receiveCurrency: req.receiveCurrency,
    sendAmount: req.sendAmount, referenceRate: req.referenceRate,
    referenceRateSource: req.referenceRateSource, referenceRateAt: req.referenceRateAt,
    providerRate: req.providerRate, spreadBps: spread,
    ekorailsFee, partnerFee, levy, taxBasis: req.fees.levyBasis, feeCurrency: req.fees.currency,
    totalPayable, expectedReceivable,
    quoteSource: req.quoteSource, quoteSourceDetail: req.quoteSourceDetail ?? null,
    isSimulated: req.isSimulated, lockStatus: wantsLock ? 'locked' : 'indicative',
    issuedAt: row.issued_at, expiresAt: row.expires_at, status: 'issued',
  });
}

function buildBreakdown(q: {
  quoteId: string; reference: string; sendCurrency: string; receiveCurrency: string;
  sendAmount: Decimal; referenceRate: Decimal; referenceRateSource: string; referenceRateAt: Date;
  providerRate: Decimal; spreadBps: Decimal; ekorailsFee: Decimal; partnerFee: Decimal;
  levy: Decimal; taxBasis: string | null; feeCurrency: string; totalPayable: Decimal;
  expectedReceivable: Decimal; quoteSource: QuoteSource; quoteSourceDetail: string | null;
  isSimulated: boolean; lockStatus: 'indicative' | 'locked'; issuedAt: Date; expiresAt: Date;
  status: string;
}): QuoteBreakdown {
  const disclosures: string[] = [];

  if (q.isSimulated) {
    disclosures.push(
      'SIMULATED RATE. This rate was produced by a test source for demonstration purposes. It is not ' +
      'a market rate and no institution is offering it.',
    );
  }
  if (q.lockStatus === 'indicative') {
    disclosures.push(
      `Indicative until accepted. The amount the beneficiary receives may differ if the rate moves ` +
      `before acceptance or if the destination institution applies its own charges.`,
    );
  } else {
    disclosures.push(
      `Locked until ${q.expiresAt.toISOString()} under the partner rate-lock reference on file.`,
    );
  }
  disclosures.push(
    'The beneficiary bank or any intermediary may deduct its own charges, which are outside ' +
    'EKORails\' control and are not included in this breakdown.',
  );
  disclosures.push(
    'EKORails orchestrates settlement. Funds are held and moved by licensed partner institutions, ' +
    'not by EKORails.',
  );

  return {
    quoteId: q.quoteId,
    reference: q.reference,
    sendCurrency: q.sendCurrency,
    receiveCurrency: q.receiveCurrency,
    sendAmount: q.sendAmount.toString(),
    referenceRate: q.referenceRate.toString(),
    referenceRateSource: q.referenceRateSource,
    referenceRateAt: q.referenceRateAt.toISOString(),
    providerRate: q.providerRate.toString(),
    spreadBps: q.spreadBps.toString(),
    ekorailsFee: q.ekorailsFee.toString(),
    partnerFee: q.partnerFee.toString(),
    taxOrLevy: q.levy.toString(),
    taxBasis: q.taxBasis,
    feeCurrency: q.feeCurrency,
    totalPayable: q.totalPayable.toString(),
    expectedReceivable: q.expectedReceivable.toString(),
    quoteSource: q.quoteSource,
    quoteSourceDetail: q.quoteSourceDetail,
    isSimulated: q.isSimulated,
    lockStatus: q.lockStatus,
    issuedAt: q.issuedAt.toISOString(),
    expiresAt: q.expiresAt.toISOString(),
    status: q.status,
    rateLabel: q.isSimulated
      ? (q.lockStatus === 'locked' ? 'Simulated rate' : 'Indicative simulated rate')
      : (q.lockStatus === 'locked' ? `Locked until ${q.expiresAt.toISOString()}` : 'Indicative rate'),
    disclosures,
  };
}

export async function getQuote(db: Queryable, quoteId: string): Promise<QuoteBreakdown | null> {
  const row = await maybeOne<Record<string, string | Date | boolean | null>>(
    db,
    `SELECT id, reference, send_currency, receive_currency, send_amount::text,
            reference_rate::text, reference_rate_source, reference_rate_at,
            provider_rate::text, spread_bps::text,
            ekorails_fee::text, partner_fee::text, tax_or_levy::text, tax_basis,
            ekorails_fee_currency, total_payable::text, expected_receivable::text,
            quote_source, quote_source_detail, is_simulated, lock_status,
            issued_at, expires_at, status
       FROM fx_quote WHERE id = $1`,
    [quoteId],
  );
  if (!row) return null;

  return buildBreakdown({
    quoteId: row['id'] as string,
    reference: row['reference'] as string,
    sendCurrency: row['send_currency'] as string,
    receiveCurrency: row['receive_currency'] as string,
    sendAmount: Decimal.fromString(row['send_amount'] as string),
    referenceRate: Decimal.fromString(row['reference_rate'] as string, RATE_SCALE),
    referenceRateSource: row['reference_rate_source'] as string,
    referenceRateAt: row['reference_rate_at'] as Date,
    providerRate: Decimal.fromString(row['provider_rate'] as string, RATE_SCALE),
    spreadBps: Decimal.fromString(row['spread_bps'] as string, 4),
    ekorailsFee: Decimal.fromString(row['ekorails_fee'] as string),
    partnerFee: Decimal.fromString(row['partner_fee'] as string),
    levy: Decimal.fromString(row['tax_or_levy'] as string),
    taxBasis: row['tax_basis'] as string | null,
    feeCurrency: row['ekorails_fee_currency'] as string,
    totalPayable: Decimal.fromString(row['total_payable'] as string),
    expectedReceivable: Decimal.fromString(row['expected_receivable'] as string),
    quoteSource: row['quote_source'] as QuoteSource,
    quoteSourceDetail: row['quote_source_detail'] as string | null,
    isSimulated: row['is_simulated'] === true,
    lockStatus: row['lock_status'] as 'indicative' | 'locked',
    issuedAt: row['issued_at'] as Date,
    expiresAt: row['expires_at'] as Date,
    status: row['status'] as string,
  });
}

export class QuoteExpiredError extends Error {
  readonly code = 'QUOTE_EXPIRED';
  constructor(reference: string, expiredAt: Date) {
    super(
      `Quote ${reference} expired at ${expiredAt.toISOString()}. Request a new quote — an expired rate ` +
      `is not a price anyone is offering.`,
    );
    this.name = 'QuoteExpiredError';
  }
}

/**
 * Accepts a quote. Refuses an expired quote outright: honouring a stale rate means
 * carrying an unhedged position we never priced.
 */
export async function acceptQuote(
  db: Queryable,
  input: { quoteId: string; acceptedBy: string; organizationId: string },
): Promise<QuoteBreakdown> {
  const row = await maybeOne<{
    id: string; reference: string; status: string; expires_at: Date; organization_id: string;
  }>(
    db,
    'SELECT id, reference, status, expires_at, organization_id FROM fx_quote WHERE id = $1',
    [input.quoteId],
  );
  if (!row) throw notFound('QUOTE_NOT_FOUND', 'Quote not found.');
  if (row.organization_id !== input.organizationId) {
    // Cross-organisation access returns "not found", not "forbidden": confirming that a
    // record exists in another organisation is itself a disclosure.
    throw notFound('QUOTE_NOT_FOUND', 'Quote not found.');
  }
  if (row.status === 'accepted') {
    throw precondition('QUOTE_ALREADY_ACCEPTED', 'This quote has already been accepted.');
  }
  if (row.status !== 'issued') {
    throw precondition('QUOTE_NOT_ACCEPTABLE', `This quote is ${row.status} and cannot be accepted.`);
  }
  if (row.expires_at.getTime() <= Date.now()) {
    await db.query("UPDATE fx_quote SET status = 'expired' WHERE id = $1 AND status = 'issued'", [row.id]);
    await recordAudit(db, {
      category: 'data_update', action: 'fx.quote.accept', outcome: 'failure',
      actorUserId: input.acceptedBy, organizationId: input.organizationId,
      entityType: 'fx_quote', entityId: row.id,
      metadata: { reason: 'expired', expired_at: row.expires_at.toISOString() },
    });
    throw new QuoteExpiredError(row.reference, row.expires_at);
  }

  await db.query(
    "UPDATE fx_quote SET status = 'accepted', accepted_at = now(), accepted_by = $2 WHERE id = $1",
    [row.id, input.acceptedBy],
  );
  await recordAudit(db, {
    category: 'approval', action: 'fx.quote.accept', outcome: 'success',
    actorUserId: input.acceptedBy, organizationId: input.organizationId,
    entityType: 'fx_quote', entityId: row.id,
    metadata: { reference: row.reference },
  });

  return (await getQuote(db, row.id))!;
}

/** Marks issued quotes past their expiry as expired. Run by the scheduler. */
export async function expireStaleQuotes(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    "UPDATE fx_quote SET status = 'expired' WHERE status = 'issued' AND expires_at <= now()",
  );
  return rowCount ?? 0;
}

export async function quotesForOrganization(
  db: Queryable, organizationId: string, limit = 50,
): Promise<Array<Record<string, unknown>>> {
  return many<Record<string, unknown>>(
    db,
    `SELECT id, reference, send_currency, receive_currency, send_amount::text AS send_amount,
            provider_rate::text AS provider_rate, total_payable::text AS total_payable,
            expected_receivable::text AS expected_receivable, is_simulated, lock_status,
            status, issued_at, expires_at
       FROM fx_quote WHERE organization_id = $1
      ORDER BY issued_at DESC LIMIT $2`,
    [organizationId, limit],
  );
}

/**
 * The default fee schedule. Values are internal commercial settings, not regulatory
 * facts, so they are safe to set. The levy is zero because no levy has been confirmed:
 * inventing a tax rate would be inventing a regulatory fact.
 */
export function defaultFeeSchedule(currency: string): FeeSchedule {
  return {
    ekorailsFixed: Decimal.fromString('0.000000'),
    ekorailsBps: bps(35),           // 0.35%
    partnerFixed: Decimal.fromString('0.000000'),
    partnerBps: bps(15),            // 0.15%
    levyFixed: Decimal.fromString('0.000000'),
    levyBps: bps(0),
    levyBasis: 'No levy configured. Applicable taxes and levies are UNCONFIRMED pending the CBN filing (FD-006).',
    currency,
  };
}
