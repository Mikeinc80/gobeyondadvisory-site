/**
 * The specific journal shapes for each economic event in a settlement.
 *
 * This file is the accounting model. Read it alongside docs/06-ledger-design.md, which
 * walks the same flows in prose.
 *
 * The multi-currency treatment is the part worth understanding. A journal must balance
 * WITHIN each currency, so a conversion cannot be written as "debit naira, credit
 * dollars" — that balances in neither. Instead a conversion is two balanced legs joined
 * through FX_CLEARING:
 *
 *     NGN leg:  Dr customer settlement payable (NGN)   Cr FX clearing (NGN)
 *     USD leg:  Dr FX clearing (USD)                   Cr customer settlement payable (USD)
 *
 * FX_CLEARING is then left holding a credit in NGN and a debit in USD. That pair IS the
 * open currency position, and it is visible on the finance dashboard instead of being
 * buried inside a rate. When the matching liquidity is positioned with the partner, the
 * second journal clears it back to zero. A persistently non-zero FX_CLEARING balance
 * means we converted an obligation without positioning the funds behind it — a real
 * exposure, and one the reconciliation run reports.
 */

import type { Queryable } from '../../db/pool.js';
import { Decimal } from '../../core/money.js';
import { post, resolveAccount, type PostedJournal, type PostingLine } from './ledger.js';

export interface TransactionEconomics {
  transactionId: string;
  transactionReference: string;
  organizationId: string;
  /** The amount the customer pays in total, including all charges. */
  totalPayable: Decimal;
  /** The principal that must reach the beneficiary, in the send currency. */
  principalSend: Decimal;
  /** The principal in the receive currency, at the quoted rate. */
  principalReceive: Decimal;
  sendCurrency: string;
  receiveCurrency: string;
  ekorailsFee: Decimal;
  partnerFee: Decimal;
  taxOrLevy: Decimal;
  /** Currencies of the three charge components. Usually the send currency. */
  feeCurrency: string;
  rate: Decimal;
}

export interface PartnerRefs {
  originPartnerId: string;
  settlementPartnerId: string;
}

/**
 * Step 1 — the customer accepts a quote and an obligation comes into existence.
 *
 * Dr Customer funding receivable      total the customer owes us to fund
 *   Cr Customer settlement payable    the principal we must deliver
 *   Cr Fee revenue                    our fee, earned on acceptance
 *   Cr Partner fees payable           the partner's fee, which we owe on
 *   Cr Regulatory charges payable     any levy, which we owe on
 */
export async function postObligationRecognition(
  db: Queryable, econ: TransactionEconomics, postedBy: string | null,
): Promise<PostedJournal> {
  const lines: PostingLine[] = [];

  const receivable = await resolveAccount(db, {
    category: 'customer_funding_receivable', currency: econ.sendCurrency,
    organizationId: econ.organizationId,
  });
  const payable = await resolveAccount(db, {
    category: 'customer_settlement_payable', currency: econ.sendCurrency,
    organizationId: econ.organizationId,
  });

  lines.push({
    accountId: receivable, direction: 'debit', amount: econ.totalPayable,
    currency: econ.sendCurrency,
    narrative: `Amount due from customer to fund ${econ.transactionReference}`,
  });
  lines.push({
    accountId: payable, direction: 'credit', amount: econ.principalSend,
    currency: econ.sendCurrency,
    narrative: `Obligation to deliver principal for ${econ.transactionReference}`,
  });

  if (econ.ekorailsFee.isPositive()) {
    lines.push({
      accountId: await resolveAccount(db, { category: 'fee_revenue', currency: econ.feeCurrency }),
      direction: 'credit', amount: econ.ekorailsFee, currency: econ.feeCurrency,
      narrative: `EKORails orchestration fee on ${econ.transactionReference}`,
    });
  }
  if (econ.partnerFee.isPositive()) {
    lines.push({
      accountId: await resolveAccount(db, { category: 'partner_fees_payable', currency: econ.feeCurrency }),
      direction: 'credit', amount: econ.partnerFee, currency: econ.feeCurrency,
      narrative: `Partner fee payable on ${econ.transactionReference}`,
    });
  }
  if (econ.taxOrLevy.isPositive()) {
    lines.push({
      accountId: await resolveAccount(db, { category: 'regulatory_charges_payable', currency: econ.feeCurrency }),
      direction: 'credit', amount: econ.taxOrLevy, currency: econ.feeCurrency,
      narrative: `Regulatory charge payable on ${econ.transactionReference}`,
    });
  }

  return post(db, {
    journalType: 'obligation_recognition',
    transactionId: econ.transactionId,
    organizationId: econ.organizationId,
    description: `Obligation recognised for ${econ.transactionReference}`,
    plainEnglish:
      `The customer accepted the quote, so two things became true at once. They now owe us ` +
      `${econ.totalPayable.toString()} ${econ.sendCurrency} to fund the payment (that is the debit, an ` +
      `amount receivable). And we now owe the beneficiary ${econ.principalSend.toString()} ` +
      `${econ.sendCurrency} of value (that is the credit, an amount payable), with the remainder split ` +
      `between our fee, the partner's fee and any levy. Nothing has moved yet; this journal records ` +
      `that a promise was made in both directions.`,
    effectiveDate: new Date(),
    lines,
    postedBy,
  });
}

/**
 * Step 2 — the customer's funds arrive at the origin partner.
 *
 * Note what this does NOT say: it does not say EKORails received money. The debit is to
 * the PARTNER's funding account, because the licensed partner institution holds it.
 *
 * Dr Partner funding account (origin)   funds now sitting with the partner
 *   Cr Customer funding receivable      the customer no longer owes us funding
 */
export async function postFundingReceipt(
  db: Queryable, econ: TransactionEconomics, partners: PartnerRefs,
  received: Decimal, postedBy: string | null,
): Promise<PostedJournal> {
  const partnerFunding = await resolveAccount(db, {
    category: 'partner_funding_account', currency: econ.sendCurrency,
    partnerId: partners.originPartnerId,
  });
  const receivable = await resolveAccount(db, {
    category: 'customer_funding_receivable', currency: econ.sendCurrency,
    organizationId: econ.organizationId,
  });

  return post(db, {
    journalType: 'funding_receipt',
    transactionId: econ.transactionId,
    organizationId: econ.organizationId,
    description: `Funding confirmed for ${econ.transactionReference}`,
    plainEnglish:
      `The customer's funds arrived at the origin partner institution. The partner's account goes up ` +
      `by ${received.toString()} ${econ.sendCurrency} and the amount the customer owed us goes down by ` +
      `the same. Read the debit carefully: it is the PARTNER's account, not ours. EKORails is not a ` +
      `deposit-taking institution and never holds the customer's money. In this build the arrival is ` +
      `simulated.`,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: partnerFunding, direction: 'debit', amount: received, currency: econ.sendCurrency,
        narrative: `Funds received at origin partner for ${econ.transactionReference}`,
      },
      {
        accountId: receivable, direction: 'credit', amount: received, currency: econ.sendCurrency,
        narrative: `Customer funding obligation discharged for ${econ.transactionReference}`,
      },
    ],
    postedBy,
  });
}

/**
 * Step 3 — the obligation is converted from the send currency to the receive currency.
 *
 * NGN leg:  Dr Customer settlement payable (NGN)   Cr FX clearing (NGN)
 * USD leg:  Dr FX clearing (USD)                   Cr Customer settlement payable (USD)
 */
export async function postFxConversion(
  db: Queryable, econ: TransactionEconomics, postedBy: string | null,
): Promise<PostedJournal> {
  const payableSend = await resolveAccount(db, {
    category: 'customer_settlement_payable', currency: econ.sendCurrency,
    organizationId: econ.organizationId,
  });
  const payableReceive = await resolveAccount(db, {
    category: 'customer_settlement_payable', currency: econ.receiveCurrency,
    organizationId: econ.organizationId,
  });
  const clearingSend = await resolveAccount(db, { category: 'fx_clearing', currency: econ.sendCurrency });
  const clearingReceive = await resolveAccount(db, { category: 'fx_clearing', currency: econ.receiveCurrency });

  return post(db, {
    journalType: 'fx_conversion',
    transactionId: econ.transactionId,
    organizationId: econ.organizationId,
    description: `FX conversion for ${econ.transactionReference} at ${econ.rate.toString()}`,
    plainEnglish:
      `The obligation changes currency. We stop owing ${econ.principalSend.toString()} ` +
      `${econ.sendCurrency} and start owing ${econ.principalReceive.toString()} ` +
      `${econ.receiveCurrency}, converted at ${econ.rate.toString()}. Because a journal must balance ` +
      `within each currency separately, the two halves are joined through the FX clearing account. ` +
      `FX clearing is now short ${econ.sendCurrency} and long ${econ.receiveCurrency} — that pair is ` +
      `the open currency position, and it stays visible on the finance dashboard until the matching ` +
      `funds are positioned with the settlement partner.`,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: payableSend, direction: 'debit', amount: econ.principalSend, currency: econ.sendCurrency,
        narrative: `Release ${econ.sendCurrency} obligation for ${econ.transactionReference}`,
      },
      {
        accountId: clearingSend, direction: 'credit', amount: econ.principalSend, currency: econ.sendCurrency,
        narrative: `FX clearing, sell side, ${econ.transactionReference}`,
      },
      {
        accountId: clearingReceive, direction: 'debit', amount: econ.principalReceive, currency: econ.receiveCurrency,
        narrative: `FX clearing, buy side, ${econ.transactionReference}`,
      },
      {
        accountId: payableReceive, direction: 'credit', amount: econ.principalReceive, currency: econ.receiveCurrency,
        narrative: `Assume ${econ.receiveCurrency} obligation for ${econ.transactionReference}`,
      },
    ],
    postedBy,
  });
}

/**
 * Step 4 — liquidity is positioned: send-currency funds leave the origin partner and
 * receive-currency funds appear at the settlement partner. This clears FX_CLEARING.
 *
 * NGN leg:  Dr FX clearing (NGN)                    Cr Partner funding account (NGN)
 * USD leg:  Dr Partner settlement account (USD)     Cr FX clearing (USD)
 */
export async function postPartnerPositioning(
  db: Queryable, econ: TransactionEconomics, partners: PartnerRefs, postedBy: string | null,
): Promise<PostedJournal> {
  const clearingSend = await resolveAccount(db, { category: 'fx_clearing', currency: econ.sendCurrency });
  const clearingReceive = await resolveAccount(db, { category: 'fx_clearing', currency: econ.receiveCurrency });
  const partnerFunding = await resolveAccount(db, {
    category: 'partner_funding_account', currency: econ.sendCurrency, partnerId: partners.originPartnerId,
  });
  const partnerSettlement = await resolveAccount(db, {
    category: 'partner_settlement_account', currency: econ.receiveCurrency,
    partnerId: partners.settlementPartnerId,
  });

  return post(db, {
    journalType: 'partner_positioning',
    transactionId: econ.transactionId,
    organizationId: econ.organizationId,
    description: `Liquidity positioned for ${econ.transactionReference}`,
    plainEnglish:
      `The funds physically move to match the converted obligation. ${econ.principalSend.toString()} ` +
      `${econ.sendCurrency} leaves the origin partner and ${econ.principalReceive.toString()} ` +
      `${econ.receiveCurrency} appears at the settlement partner. This is the journal that closes the ` +
      `FX clearing position opened by the conversion: after it, FX clearing is back to zero in both ` +
      `currencies. If it is not, we converted an obligation without funding it, and the finance ` +
      `dashboard will show the gap. In this build the movement is simulated.`,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: clearingSend, direction: 'debit', amount: econ.principalSend, currency: econ.sendCurrency,
        narrative: `Close FX clearing sell side, ${econ.transactionReference}`,
      },
      {
        accountId: partnerFunding, direction: 'credit', amount: econ.principalSend, currency: econ.sendCurrency,
        narrative: `Funds applied at origin partner for ${econ.transactionReference}`,
      },
      {
        accountId: partnerSettlement, direction: 'debit', amount: econ.principalReceive,
        currency: econ.receiveCurrency,
        narrative: `Funds available at settlement partner for ${econ.transactionReference}`,
      },
      {
        accountId: clearingReceive, direction: 'credit', amount: econ.principalReceive,
        currency: econ.receiveCurrency,
        narrative: `Close FX clearing buy side, ${econ.transactionReference}`,
      },
    ],
    postedBy,
  });
}

/**
 * Step 5 — the settlement partner pays the beneficiary.
 *
 * Dr Customer settlement payable (receive ccy)   our obligation is discharged
 *   Cr Partner settlement account (receive ccy)  the partner's funds went out
 */
export async function postSettlementPayment(
  db: Queryable, econ: TransactionEconomics, partners: PartnerRefs,
  settled: Decimal, postedBy: string | null,
): Promise<PostedJournal> {
  const payableReceive = await resolveAccount(db, {
    category: 'customer_settlement_payable', currency: econ.receiveCurrency,
    organizationId: econ.organizationId,
  });
  const partnerSettlement = await resolveAccount(db, {
    category: 'partner_settlement_account', currency: econ.receiveCurrency,
    partnerId: partners.settlementPartnerId,
  });

  return post(db, {
    journalType: 'settlement_payment',
    transactionId: econ.transactionId,
    organizationId: econ.organizationId,
    description: `Settlement paid for ${econ.transactionReference}`,
    plainEnglish:
      `The settlement partner paid ${settled.toString()} ${econ.receiveCurrency} to the beneficiary. ` +
      `Our obligation to deliver value is discharged (the debit) and the partner's account goes down ` +
      `by the same amount (the credit). Note that "settled" here means the partner reported the ` +
      `payment as made. It does not mean settlement finality, which is a legal property conferred by ` +
      `a settlement system operator and which no simulator can produce.`,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: payableReceive, direction: 'debit', amount: settled, currency: econ.receiveCurrency,
        narrative: `Obligation discharged for ${econ.transactionReference}`,
      },
      {
        accountId: partnerSettlement, direction: 'credit', amount: settled, currency: econ.receiveCurrency,
        narrative: `Paid out by settlement partner for ${econ.transactionReference}`,
      },
    ],
    postedBy,
  });
}

/**
 * Partial settlement. The partner paid less than instructed. The shortfall parks in
 * settlement suspense until an operator resolves it — it is NOT quietly written off,
 * and it is NOT treated as a completed payment.
 */
export async function postPartialSettlement(
  db: Queryable, econ: TransactionEconomics, partners: PartnerRefs,
  settled: Decimal, postedBy: string | null,
): Promise<PostedJournal> {
  const shortfall = econ.principalReceive.subtract(settled);
  const payableReceive = await resolveAccount(db, {
    category: 'customer_settlement_payable', currency: econ.receiveCurrency,
    organizationId: econ.organizationId,
  });
  const partnerSettlement = await resolveAccount(db, {
    category: 'partner_settlement_account', currency: econ.receiveCurrency,
    partnerId: partners.settlementPartnerId,
  });
  const suspense = await resolveAccount(db, {
    category: 'settlement_suspense', currency: econ.receiveCurrency,
  });

  return post(db, {
    journalType: 'suspense_posting',
    transactionId: econ.transactionId,
    organizationId: econ.organizationId,
    description: `Partial settlement for ${econ.transactionReference}, shortfall ${shortfall.toString()}`,
    plainEnglish:
      `The partner paid ${settled.toString()} ${econ.receiveCurrency} against an instruction for ` +
      `${econ.principalReceive.toString()}. The amount actually paid discharges that much of our ` +
      `obligation. The unpaid ${shortfall.toString()} moves to settlement suspense, where it stays ` +
      `visible until someone resolves it. Suspense is deliberately uncomfortable: a balance sitting ` +
      `there is an open question, and the finance dashboard reports the age of every suspense item.`,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: payableReceive, direction: 'debit', amount: settled, currency: econ.receiveCurrency,
        narrative: `Partial discharge for ${econ.transactionReference}`,
      },
      {
        accountId: partnerSettlement, direction: 'credit', amount: settled, currency: econ.receiveCurrency,
        narrative: `Partial payment by settlement partner for ${econ.transactionReference}`,
      },
      {
        accountId: suspense, direction: 'debit', amount: shortfall, currency: econ.receiveCurrency,
        narrative: `Unsettled shortfall on ${econ.transactionReference}`,
      },
      {
        accountId: payableReceive, direction: 'credit', amount: shortfall, currency: econ.receiveCurrency,
        narrative: `Shortfall remains owed on ${econ.transactionReference}`,
      },
    ],
    postedBy,
  });
}

/**
 * Returned payment. The beneficiary bank sent the funds back.
 *
 * Dr Partner settlement account   funds are back with the partner
 *   Cr Returned funds             we now owe the customer a refund
 */
export async function postReturnReceipt(
  db: Queryable, econ: TransactionEconomics, partners: PartnerRefs,
  returned: Decimal, reason: string, postedBy: string | null,
): Promise<PostedJournal> {
  const partnerSettlement = await resolveAccount(db, {
    category: 'partner_settlement_account', currency: econ.receiveCurrency,
    partnerId: partners.settlementPartnerId,
  });
  const returnedFunds = await resolveAccount(db, {
    category: 'returned_funds', currency: econ.receiveCurrency, organizationId: econ.organizationId,
  });

  return post(db, {
    journalType: 'return_receipt',
    transactionId: econ.transactionId,
    organizationId: econ.organizationId,
    description: `Payment returned on ${econ.transactionReference}: ${reason}`,
    plainEnglish:
      `The beneficiary's bank returned ${returned.toString()} ${econ.receiveCurrency}. Reason given: ` +
      `${reason}. The funds are back with the settlement partner (the debit) and we now carry an ` +
      `obligation to return them to the customer (the credit to returned funds). This does not undo ` +
      `the original settlement journal — that payment genuinely happened and stays in the record. ` +
      `A return is a new event, not an erasure.`,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: partnerSettlement, direction: 'debit', amount: returned, currency: econ.receiveCurrency,
        narrative: `Returned funds received back for ${econ.transactionReference}`,
      },
      {
        accountId: returnedFunds, direction: 'credit', amount: returned, currency: econ.receiveCurrency,
        narrative: `Refund owed to customer for ${econ.transactionReference}`,
      },
    ],
    postedBy,
  });
}

/** Test liquidity injection. Only ever used to give the simulators an opening position. */
export async function postTestLiquidity(
  db: Queryable,
  input: { partnerId: string; category: 'partner_funding_account' | 'partner_settlement_account';
           currency: string; amount: Decimal; postedBy: string | null },
): Promise<PostedJournal> {
  const partnerAccount = await resolveAccount(db, {
    category: input.category, currency: input.currency, partnerId: input.partnerId,
  });
  const testLiquidity = await resolveAccount(db, { category: 'test_liquidity', currency: input.currency });

  return post(db, {
    journalType: 'test_liquidity_injection',
    description: `Simulated opening liquidity: ${input.amount.toString()} ${input.currency}`,
    plainEnglish:
      `This gives a simulated partner an opening balance of ${input.amount.toString()} ` +
      `${input.currency} so that settlements can be demonstrated. The other side is the test ` +
      `liquidity account, which exists only to make it obvious that this money was invented for the ` +
      `demonstration. No real funds correspond to it, and the test liquidity account is excluded from ` +
      `every financial report except the one that discloses it.`,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: partnerAccount, direction: 'debit', amount: input.amount, currency: input.currency,
        narrative: `Simulated opening liquidity at partner`,
      },
      {
        accountId: testLiquidity, direction: 'credit', amount: input.amount, currency: input.currency,
        narrative: `Simulated liquidity source (not real funds)`,
      },
    ],
    postedBy: input.postedBy,
  });
}

/**
 * Reconciliation adjustment. Moves an unexplained difference into the reconciliation
 * difference account, where it is owned by a named person and aged until resolved.
 */
export async function postReconciliationAdjustment(
  db: Queryable,
  input: {
    transactionId?: string | null; organizationId?: string | null;
    counterAccountId: string; currency: string; amount: Decimal;
    direction: 'debit' | 'credit'; explanation: string; postedBy: string | null;
  },
): Promise<PostedJournal> {
  const difference = await resolveAccount(db, {
    category: 'reconciliation_difference', currency: input.currency,
  });
  const opposite = input.direction === 'debit' ? 'credit' : 'debit';

  return post(db, {
    journalType: 'reconciliation_adjustment',
    transactionId: input.transactionId ?? null,
    organizationId: input.organizationId ?? null,
    description: `Reconciliation adjustment: ${input.explanation}`,
    plainEnglish:
      `Our records and the partner's records disagreed by ${input.amount.toString()} ` +
      `${input.currency}. Rather than silently changing either side, the difference is recorded in ` +
      `the reconciliation difference account, where it has an owner, an age and an investigation. ` +
      `Explanation given: ${input.explanation}. A balance in this account is an admission that ` +
      `something is unexplained, which is exactly why it exists.`,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: input.counterAccountId, direction: input.direction, amount: input.amount,
        currency: input.currency, narrative: `Reconciliation adjustment: ${input.explanation}`,
      },
      {
        accountId: difference, direction: opposite as 'debit' | 'credit', amount: input.amount,
        currency: input.currency, narrative: `Unexplained difference pending investigation`,
      },
    ],
    postedBy: input.postedBy,
  });
}

/** Settles the partner fee we accrued at obligation recognition. */
export async function postPartnerFeePayment(
  db: Queryable, econ: TransactionEconomics, partners: PartnerRefs, postedBy: string | null,
): Promise<PostedJournal | null> {
  if (!econ.partnerFee.isPositive()) return null;
  const payable = await resolveAccount(db, {
    category: 'partner_fees_payable', currency: econ.feeCurrency,
  });
  const partnerFunding = await resolveAccount(db, {
    category: 'partner_funding_account', currency: econ.feeCurrency, partnerId: partners.originPartnerId,
  });

  return post(db, {
    journalType: 'partner_fee_payment',
    transactionId: econ.transactionId,
    organizationId: econ.organizationId,
    description: `Partner fee settled for ${econ.transactionReference}`,
    plainEnglish:
      `The fee we owed the partner, ${econ.partnerFee.toString()} ${econ.feeCurrency}, is paid out of ` +
      `the funds held with them. Our liability to the partner goes down (the debit) and their account ` +
      `goes down by the same (the credit). This is why the fee was recorded as payable at the start ` +
      `rather than netted off the rate: the amount owed, and to whom, stays visible until it is paid.`,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: payable, direction: 'debit', amount: econ.partnerFee, currency: econ.feeCurrency,
        narrative: `Partner fee liability discharged for ${econ.transactionReference}`,
      },
      {
        accountId: partnerFunding, direction: 'credit', amount: econ.partnerFee, currency: econ.feeCurrency,
        narrative: `Partner fee paid from funds at partner for ${econ.transactionReference}`,
      },
    ],
    postedBy,
  });
}
