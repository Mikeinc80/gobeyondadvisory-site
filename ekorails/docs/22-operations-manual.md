# 22 — Operations manual

For **Treasury and Settlement Operator**, **Finance and Reconciliation Analyst**, and
**System Administrator**.

---

## Part 1 — Treasury and settlement

### The queue

**Operations → Overview** groups payments by what is waiting on you. It is ordered by urgency, not
by age, and two groups sit at the top permanently when they are non-empty.

| State | What it is | Urgency |
|---|---|---|
| `under_investigation` | The partner did not answer, or settled less than instructed | **Now** |
| `returned` | The destination bank sent the money back | **Now** |
| `compliance_approved` | Needs a quote | Normal |
| `quote_issued` | With the customer | Watch the expiry |
| `quote_accepted` | Needs funding requested | Normal |
| `awaiting_funding` | Waiting on the customer | Watch the age |
| `funding_confirmed` | Convert and position | Normal |
| `ready_for_settlement` | Instruct the partner | Normal |
| `submitted_to_partner` / `partner_processing` | With the partner | Watch the age |

### Issuing a quote

A quote carries a provider rate, a spread stated **separately**, fees, and an expiry.

The language rules are not stylistic:

- Before the customer accepts, it is **indicative**. Always.
- "Locked until [time]" may be used **only** where a partner has contractually locked the rate. No
  partner has, in this build, so nothing here is locked.
- Every rate in this environment is simulated and labelled as such.

Never: guaranteed rate, no spread, zero loss, best market rate. The build fails on all four.

An expired quote is refused rather than honoured. If a customer misses the window, issue a new
quote; do not extend an old one, because the rate it carries is no longer the rate.

### Preparing settlement

Two steps that are separate on purpose:

1. **Convert.** Two legs through `fx_clearing` — one giving up the source currency, one taking on
   the target.
2. **Position.** Clears `fx_clearing` back to zero against the partner accounts.

If you do the first without the second, `fx_clearing` carries a balance, which means an open
currency position with nobody owning it. It is on the Liquidity screen for that reason, and a
non-zero clearing balance is a task, not a note.

### Submitting to a partner

Every instruction carries a deterministic idempotency key. Submitting the same instruction twice
returns `duplicate_ignored` and instructs no second payment.

### When the partner does not answer

**This is the situation this console exists for.**

The instruction may or may not have been executed. Retrying is how a payment gets made twice.

1. The transaction is in `under_investigation`. Automatic retry is **off** and cannot be turned on.
2. Read `integration_event` on the transaction: the exchange, the key, the latency, the outcome.
3. **Contact the partner and establish the true position from their records.** Not from ours.
4. Only then move it, with a reason describing what you established and how.

Do not resolve this from the screen. The screen tells you what we know, and what we know is exactly
what is insufficient.

### Short funding and partial settlement

Neither proceeds automatically, and neither is written off.

- **Short funding**: less arrived than expected. The payment does not proceed. Either the customer
  funds the difference or the payment is reduced, and both are decisions, not adjustments.
- **Partial settlement**: the paid portion discharges that much of the obligation; the shortfall
  goes to `settlement_suspense` with an owner. It stays there until somebody explains it.

### A return

The destination bank sent the money back. The original settlement is **not** reversed — a return is
a new event. Reversing the first would make the record say the payment never happened, which is
false and hides a real operational event.

## Part 2 — Finance and reconciliation

### Every day, in this order

1. **Trial balance.** If it does not net to zero in every currency, stop and treat it as a critical
   incident. Investigating breaks on top of an unbalanced ledger wastes the time it takes to
   discover that was the cause.
2. **Run reconciliation** for the business date.
3. **Work the breaks**, critical first. Full procedure in `18-reconciliation-procedures.md`.
4. **Check `fx_clearing` and `settlement_suspense`.** A non-zero balance in either is an open item
   with an owner.

### Ledger accounts

Every balance you see is summed from journal entries at the moment you loaded the page. No balance
is stored anywhere, so none can be stale, and there is nothing to reconcile a balance against
except its own entries.

There is **no customer stored-value account** in the chart of accounts. If you are looking for where
a customer's money sits, it is in a partner account, and that is the point.

### Corrections

Only ever a reversal. There is no `UPDATE` grant on `journal` or `journal_entry` for any application
role, so there is no path by which an entry can be edited — including for you.

A reversal posts the mirror image. Both journals stay visible. The original is marked `reversed` and
its entries are untouched.

### Breaks you must not close quickly

`missing_internal_record` and `duplicate` both mean money may have moved in a way this system does
not know about. Neither is a reconciliation item; both are incidents. See
`15-incident-response-plan.md`.

## Part 3 — Administration

### What an administrator cannot do

Worth knowing before you look for it:

- **Move money.** No treasury permission.
- **Clear a compliance alert.** No compliance permission.
- **Post to the ledger.** No `ledger.post.adjustment`, and no database grant regardless.
- **Read customer transactions.** No `txn.read` or `txn.read.any`. Administering a platform and
  reading its customers' payments are different jobs.
- **Enable live funds.** Not from this console or any other. The release gates are process-level
  environment configuration and require named evidence.

### Configuration

Immutable. A change is a **new version** under maker-checker — proposed by one person, approved by
another — and it never rewrites a historical result, because every engine copies the values it used
into its own output record.

Unresolved placeholders are listed separately and named as such. Each points at the founder decision
that would resolve it. They are not defects; they are facts the build did not have.

### The simulators

**Administration → Simulation control.** Direct a partner simulator to produce a specific outcome on
its next call.

This is how failure is tested rather than hoped about. Nothing about the transaction is faked: the
system genuinely receives that outcome and genuinely has to deal with it, which is the only way to
find out whether it does.

The one to run first is `partner_timeout`. Watch the transaction go to `under_investigation` and
watch retry stay off.

Creating a directive is an audited configuration change.

### Users and roles

Adding a user, changing their roles and suspending them are all audited.

**A note on your own power:** you hold `admin.roles.manage`. Nothing in the software prevents you
from granting yourself a compliance role. The change would be audited, and nobody is watching the
audit trail in real time. This is recorded honestly in the threat model as a partial control, and
the mitigation is organisational: more than one person, and somebody reviewing role changes.

### Break glass

Emergency access is three separate audited events: a request, an approval **by a different person**,
and a use. Every one is reviewable, and a use with no matching approval is an incident.
