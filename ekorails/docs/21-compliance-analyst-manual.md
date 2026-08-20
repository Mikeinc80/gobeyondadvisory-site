# 21 — Compliance analyst manual

For **Compliance Analyst** and **Compliance Manager**.

---

## What your decisions are

Permanent. A compliance decision cannot be edited or deleted. A later decision adds to the record;
it does not replace the earlier one.

That is not a limitation of the software. It is the point of it. The value of your decision to
somebody reading it in three years — a supervisor, an auditor, a court — comes entirely from the
fact that it could not have been tidied up afterwards.

Write every reason as if the person reading it was not in the room, does not know the customer, and
is deciding whether you acted reasonably.

## The queue

**Compliance → Case queue.** Ordered by priority, then by service target, not by age.

| Column | What to read it as |
|---|---|
| Engine outcome | What the rules found. A recommendation |
| Authority | Whether an analyst can clear this, or whether it needs a manager |
| Target | Breached means it took too long. It does not mean decide it faster |

A breached target is not a reason to make a quicker decision. It is a reason to record why it took
longer, which the reason field gives you room to do.

## Reading a case

Four things, in this order:

### 1. What the engine actually checked

Not just what fired. The case shows every rule that **applied** and was evaluated, including the
ones that found nothing.

This distinction matters more than anything else on the screen. "This rule was checked and found
nothing" is evidence. "This rule was never run" is a gap. If only triggered rules were shown, the
two would look identical a year later, and you would have no way to demonstrate that the check
happened.

Each evaluation shows the rule text, the parameter values **in force at the time**, and the data the
rule looked at. It is not read back from today's configuration, so a rule change next month cannot
alter what this decision appears to have been based on.

### 2. Screening results

Every match is a **proposal**. Names collide; that is the ordinary case.

To dispose of one, compare what actually distinguishes people: date of birth, nationality, and any
identifier you have. Then write down what you compared.

| Disposition | When |
|---|---|
| `cleared` | You have established this is a different person or entity, and said how |
| `escalated` | You cannot establish it, or the match is credible and needs a manager |
| `blocked` | You have established this is the listed person |
| `pending_review` | You are waiting on something. Say what |

"Cleared — false positive" with no comparison recorded is the single most common failing in AML
files. It reads as though nobody looked.

### 3. The customer's own material

Documents, ownership structure, the stated purpose of the payment and the source of funds. A source
of funds that does not fit the business is the question worth asking, and the information-request
path exists for exactly that.

### 4. History

Previous decisions on this customer, previous cases, previous notes. A pattern across three cases is
information that none of them carries alone.

## Making a decision

| Decision | Effect | Who |
|---|---|---|
| Clear | The case closes. The payment or onboarding proceeds | Analyst, unless flagged for manager |
| Clear as a false positive | The same, recording explicitly that the match was not the person | Analyst |
| Request information | The customer is asked. The case waits | Analyst |
| Escalate | Goes to a manager | Analyst |
| Reject | The case closes against the customer | Analyst |
| Suspend | Pending investigation | Analyst |
| Approve (high risk) | Clears a case flagged for manager authority | **Manager only** |

Two refusals the server will make regardless of what the screen offers:

- **An analyst cannot clear a case flagged for manager approval.** The attempt is recorded as a
  denied action, which is itself part of the record.
- **A manager cannot approve a case on which they already recorded a decision.** Reviewing your own
  earlier decision is not a review.

## Writing a reason

The reason field has a minimum length, and meeting it is not the same as satisfying it.

**Not adequate:** "Cleared." · "False positive." · "Customer known to us." · "No concerns."

**Adequate:** "The sanctions match is to Ibrahim Musa, born 1961, Sudanese national, listed under
[reference]. Our subject is Ibrahim Musa-Danladi, born 1984, Nigerian national, verified against a
passport and a bank statement. Different date of birth, different nationality, different
identification number. Cleared as a false positive."

The test: could somebody who has never seen this customer read your reason and understand both what
you concluded and what you relied on?

## Onboarding cases

**Compliance → KYB queue.**

A KYB approval is a decision about a business, not a formality. The engine recommends; it does not
approve. High-risk approvals require a manager.

Look at the ownership structure, not only the directors. A company whose beneficial owner sits
behind two other companies in different jurisdictions is a different proposition from one owned by
two named individuals, whatever the risk score says.

## Expiring documents

**Compliance → Expiring documents.**

An expired document does not suspend a customer by itself. It raises a rule against the next
transaction that relies on it.

That is deliberate. Suspending a customer because a certificate lapsed on a Friday is rarely the
right answer. Letting a payment proceed on stale evidence never is.

## The rule library

**Compliance → Rule library.** Every rule, with:

- the risk it addresses
- when it fires
- what evidence it requires
- what the system does automatically
- what you decide
- **how it can be wrong**
- its policy basis

The sixth is the one to read before disposing of a match the rule raised. A rule that never has a
false positive is a rule that is not looking hard enough, and knowing a rule's characteristic false
positive is what lets you dispose of one properly.

## What this build cannot do, and why you will see it constantly

**Every transaction raises a compliance case.** The corridor is an unconfirmed placeholder, so
`CORRIDOR_PLACEHOLDER_UNCONFIRMED` fires on every payment.

This is intended behaviour for a system whose regulatory scope has not been confirmed, not a defect.
It means no transaction can clear automatically, and every one needs a person. When the corridor is
confirmed and the placeholder is replaced under maker-checker, this stops.

**`HIGH_RISK_JURISDICTION` has an empty list.** A list of high-risk countries is a regulatory fact
and none was available to this build, so none was invented. The rule is present and evaluates
against an empty list, which is visible in every assessment rather than silently missing.

## Things you cannot do, by design

- **Post to the ledger.** Not a permission you hold.
- **Route a settlement.** Compliance and treasury are separate.
- **Read another organisation's data outside a case.** Row-level security, not a policy.
- **Edit or delete a decision.** No `UPDATE` grant exists.
- **Approve your own earlier decision as a manager.** Refused.
