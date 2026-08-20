# 06 — Ledger design

---

## 1. Three rules, and why each one matters

### Every movement balances, within each currency

At least two entries, summing to zero. Within each currency, not across them — a cross-currency
payment is two conversions, and it has to balance twice.

This is enforced by a deferred `CONSTRAINT TRIGGER` that runs at commit:

```sql
CREATE CONSTRAINT TRIGGER journal_must_balance AFTER INSERT ON journal
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();
```

Deferred, because a journal is written as several statements and is only complete at commit. The
trigger refuses a journal with fewer than two entries and a journal whose entries do not net to
zero in any currency. The application cannot write an unbalanced journal even if it tries, and the
test suite proves this by trying.

### Balances are never stored

Every balance in this system is summed from journal entries at the moment it is read. There is no
`balance` column anywhere.

A stored balance is a second source of truth. It agrees with the entries until the day it does not,
and then there is no way to tell which is right. Deriving costs a little performance and removes an
entire category of failure.

### Corrections are reversals, never edits

A mistake is corrected by posting a new journal in which every debit becomes a credit and every
credit becomes a debit, for the same amounts. The two together have no net effect on any balance.
The original journal is marked `reversed` and **its entries remain exactly as they were**.

Both the mistake and the correction stay visible. That is the point: a ledger you can tidy is a
ledger nobody can rely on.

Enforced structurally, not by convention: the application's database role holds no `UPDATE` or
`DELETE` grant on `journal` or `journal_entry`, and an append-only trigger raises even for the
table owner.

## 2. What is deliberately absent from the chart of accounts

**There is no customer stored-value account.** Not disabled, not restricted — absent.

This is the strongest evidence in the system that EKORails does not hold customer funds. A policy
can be broken by somebody in a hurry. A schema that has nowhere to record a thing cannot record it.
The categories that exist are:

| Category | Type | What it records |
|---|---|---|
| `customer_funding_receivable` | asset | What a customer still owes to fund a payment we have agreed to make |
| `customer_settlement_payable` | liability | What we have undertaken to deliver to a beneficiary |
| `partner_funding_account` | asset | What the **partner institution** holds on the customer's behalf |
| `partner_settlement_account` | asset | What the settlement institution holds and pays out from |
| `fx_clearing` | clearing | The account a currency conversion passes through |
| `settlement_suspense` | liability | Where a shortfall sits until somebody explains it |
| `reconciliation_difference` | clearing | A difference between our records and a partner's, unexplained |
| `fee_revenue` | revenue | What EKORails earned |
| `partner_fees_payable` | liability | What EKORails owes a partner |
| `regulatory_charges_payable` | liability | Levies and charges owed |
| `returned_funds` | liability | Money a destination bank sent back, now owed to the customer |
| `test_liquidity` | equity | Money invented for the demonstration |

`test_liquidity` has its own category rather than being mixed into anything else, so that a figure
that corresponds to no real money is never summed with one that does.

## 3. The postings

Amounts below are illustrative and every figure in this build is simulated.

### Obligation recognition — when a quote is accepted

The first ledger entry any payment produces. Nothing is owed before this point.

| | Account | Debit | Credit |
|---|---|---|---|
| | `customer_funding_receivable` (NGN) | 5,000,000.00 | |
| | `customer_settlement_payable` (NGN) | | 4,950,000.00 |
| | `fee_revenue` (NGN) | | 40,000.00 |
| | `partner_fees_payable` (NGN) | | 8,000.00 |
| | `regulatory_charges_payable` (NGN) | | 2,000.00 |

In plain English: the customer now owes us this much; we have undertaken to deliver value; and the
charges are recognised at the moment they are agreed, not when they are paid.

### Funding receipt — when the money reaches the partner

| | Account | Debit | Credit |
|---|---|---|---|
| | `partner_funding_account` (NGN) | 5,000,000.00 | |
| | `customer_funding_receivable` (NGN) | | 5,000,000.00 |

Read the debit carefully: it increases what the **partner** holds. It does not increase anything of
EKORails'. This single posting is where the custody position is expressed in accounting.

### FX conversion — two legs through clearing

| | Account | Debit | Credit |
|---|---|---|---|
| | `customer_settlement_payable` (NGN) | 4,950,000.00 | |
| | `fx_clearing` (NGN) | | 4,950,000.00 |
| | `fx_clearing` (USD) | 3,300.00 | |
| | `customer_settlement_payable` (USD) | | 3,300.00 |

Each currency nets to zero on its own, which is the whole reason the trigger checks by currency.
A balance left in `fx_clearing` means one half of a conversion happened and the other did not — an
open position with nobody owning it. It is visible on the liquidity screen for exactly that reason.

### Partner positioning — clears the conversion

| | Account | Debit | Credit |
|---|---|---|---|
| | `fx_clearing` (NGN) | 4,950,000.00 | |
| | `partner_funding_account` (NGN) | | 4,950,000.00 |
| | `partner_settlement_account` (USD) | 3,300.00 | |
| | `fx_clearing` (USD) | | 3,300.00 |

After this, `fx_clearing` is zero in both currencies. If it is not, something is unfinished.

### Settlement payment

| | Account | Debit | Credit |
|---|---|---|---|
| | `customer_settlement_payable` (USD) | 3,300.00 | |
| | `partner_settlement_account` (USD) | | 3,300.00 |

The obligation is discharged and the partner has paid out.

### Partial settlement — the interesting one

The partner settles 3,000.00 of an instructed 3,300.00.

| | Account | Debit | Credit |
|---|---|---|---|
| | `customer_settlement_payable` (USD) | 3,000.00 | |
| | `partner_settlement_account` (USD) | | 3,000.00 |
| | `customer_settlement_payable` (USD) | 300.00 | |
| | `settlement_suspense` (USD) | | 300.00 |

The paid portion discharges that much of the obligation. The shortfall moves to suspense — where it
has an owner and appears on a screen — rather than being written off or left implicit.

### Return after settlement

| | Account | Debit | Credit |
|---|---|---|---|
| | `partner_settlement_account` (USD) | 3,300.00 | |
| | `returned_funds` (USD) | | 3,300.00 |

**The original settlement journal is not reversed.** The payment genuinely happened; the money
genuinely came back. Two events, two journals. Reversing the first would make the record say the
payment never occurred, which is false and would hide a real operational event from anybody looking
later.

### Reconciliation adjustment

Only ever a reversal of a specific journal, or a posting to `reconciliation_difference` pending an
explanation. There is no function that adjusts a balance directly, because there is no balance to
adjust.

## 4. Precision

| | Type | Scale |
|---|---|---|
| Money | `NUMERIC(24,6)` | 6 decimal places |
| Exchange rates | `NUMERIC(24,12)` | 12 decimal places |

Six places for money because a currency with two minor units still needs headroom for intermediate
results. Twelve for rates because a rate is multiplied by a large principal, and an error in the
twelfth place of a rate applied to five million naira is still small — an error in the sixth place
is not.

In the application, money is a BigInt-backed `Decimal`. It refuses to be constructed from a
JavaScript number with a fractional part, refuses a string with more precision than the scale
allows, and is never converted to a number on its way to a screen. Amounts travel from the database
to the browser as strings and are formatted as strings; `scripts/check-web.mjs` fails the build if
any client module calls `Number()` or `parseFloat()` on a field whose name contains "amount" or
"balance".

Rounding is explicit at every point where it occurs — four modes are available and the caller must
choose. There is no default rounding, because a default is a decision nobody made.

## 5. Verification

`verifyLedgerIntegrity()` runs three checks in SQL:

1. The trial balance nets to zero in every currency.
2. No journal is unbalanced.
3. No journal has fewer than two entries.

It runs at service start-up, and the process **refuses to start** if it fails. Serving traffic on
top of a ledger that does not balance, and then accepting payments against it, is worse than
refusing to start.

It is also exposed at `GET /api/ledger/trial-balance` and shown on the Finance console, so the
check is something anybody with the permission can run rather than something the system claims to
have run.

## 6. What this ledger does not do

Stated plainly, because a ledger document that lists only capabilities is not much use:

- **No multi-entity consolidation.** One entity.
- **No accounting period close.** No periods are opened or closed; there is no cut-off procedure.
- **No general-ledger export to an accounting package.** Reports export to CSV, XLSX and PDF; there
  is no journal export in any accounting interchange format.
- **No accruals beyond the charges recognised at quote acceptance.**
- **No tax computation.** `regulatory_charges_payable` records what a partner or a rule says is
  owed. Nothing in this system computes a tax liability.
