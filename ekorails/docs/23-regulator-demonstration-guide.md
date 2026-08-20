# 23 — Regulator demonstration guide

For a supervisor, an auditor, or anyone conducting technical due diligence.

This guide is written so that you can verify claims rather than accept them. Every section names
what to look at and what would prove the claim false.

---

## Before anything else

**This deployment settles through simulators and moves no real money.** Every partner, rate and
settlement is simulated. Every business, person and document in it is fictional.

**EKORails is not** a bank, a deposit-taking institution, a licensed payment provider, a custodian
of customer funds, a cryptocurrency exchange, a consumer investment platform, or an admitted
participant in the CBN Regulatory Sandbox.

The last one matters most for a supervisory conversation: **no admission has been confirmed to this
build, and nothing in this software claims otherwise.**

---

## 1. Verify the environment claim yourself

`GET /api/system/environment` and `GET /api/system/regulatory-boundary`, or the **Supervisory view**
in the interface.

The banner **SANDBOX ENVIRONMENT. NO LIVE FUNDS.** is the first element in the document on every
screen, travels on every API response in the `X-EKORails-Environment` header, and the client blocks
the page if the two disagree.

**What would disprove the claim:** a page rendering without the banner; a response without the
header; live funds enabled with unmet gates. Try a URL that does not exist — the 404 carries the
banner too.

## 2. Verify that live funds are not reachable

**Supervisory view → Release gates**, or in the boundary response.

Nine gates. Each requires named evidence. **None is settable from any interface** — they are
process-level environment configuration read once at start-up. In `PRODUCTION` mode the process
refuses to start with any gate unmet, and in this build `assertLiveMoneyPermitted()` throws
unconditionally regardless of configuration.

**What would disprove it:** any screen, setting or API call that changes a gate. There is none.

## 3. Verify that no customer funds are held

This is the claim with the most regulatory weight, so it is worth verifying structurally rather than
by reading a policy.

1. **Finance → Ledger accounts.** Read the chart of accounts. There is no customer stored-value
   account, no wallet, no client-money account. Not disabled — **absent**.
2. Open any completed payment and read its ledger entries. The funding receipt **debits the partner
   account**. Value is recorded as arriving at the licensed partner, never at EKORails.
3. `04-data-model.md` lists every account category in the schema.

**What would disprove it:** an account category that could hold a customer balance.

## 4. Verify the ledger

**Finance → Trial balance.**

Debits equal credits in every currency. The check runs in SQL against the tables, not against
anything the application remembers, so a defect in the application cannot make it pass. The service
**refuses to start** if it fails.

Ask to see it fail: an unbalanced journal cannot be inserted, because a deferred constraint trigger
raises at commit. This is in the test suite as a mandatory case.

**What would disprove it:** a non-zero difference in any currency; a stored balance column anywhere
(there is none — every balance is derived).

## 5. Verify the audit trail

**Oversight → Audit trail.**

- `GET /api/audit/verify` recomputes the hash chain **inside the database**. It does not depend on
  the application being honest.
- Filter by category `authorisation` and look for `outcome: denied`. **Refusals are recorded exactly
  as carefully as successes.** A trail containing only successes tells you nothing about what
  somebody tried to do.
- Export a range. The export carries a manifest proving contiguity and integrity, so a recipient can
  verify it without trusting the exporter. The export is itself an audited event.

**The honest limitation, stated here rather than left for you to find:** with no off-host copy of a
chain head, an attacker with the database owner role could rewrite records and recompute every
subsequent hash, and this check would pass. A break proves tampering; the absence of one does not
prove its absence. This is gap 1 in `12-threat-model.md`.

## 6. Verify separation of duties

**Administration → Roles**, and then test it.

- Ask a Business Initiator to authorise their own payment. The state machine refuses it and records
  the refusal.
- Ask a Compliance Analyst to clear a case flagged for manager approval. Refused, recorded.
- Ask the person who investigated a reconciliation break to approve its closure. Refused.

Each refusal appears in the audit trail. That is the demonstration: not that the buttons are hidden,
but that the action is refused and the attempt is recorded.

## 7. Verify that a compliance decision can be reconstructed

Open any compliance case.

You will see every rule that **applied** and was evaluated, including those that did not fire — with
the rule text, the parameter values in force at the time, and the data the rule read. The record is
self-contained: it is not read back from current configuration, so a later rule change cannot alter
what a past decision appears to have been based on.

Both the ruleset hash and the input hash are stored, and the case screen recomputes the ruleset hash
from the stored snapshot and tells you whether they agree.

**What would disprove it:** a decision whose basis cannot be reconstructed; evaluations stored only
for triggered rules.

## 8. Verify that automation does not decide

- **Compliance rules recommend.** Every case closes on a decision recorded against a named person
  with a written reason. There is no path by which a rule outcome alone rejects a customer.
- **AI extraction decides nothing.** It writes proposals to a separate table. The compliance engine
  never reads it. A person must confirm each value, and the confirmation records their identity.

The word "verified" is never used about extraction in this system, and the build fails on it.

## 9. Watch it fail

The part of a demonstration worth insisting on.

**Administration → Simulation control.** Direct the settlement simulator to `partner_timeout`, then
submit a settlement.

The transaction moves to `under_investigation` and **automatic retry switches off**. That is the
scenario that causes duplicate payments in systems that retry blindly, and this is the one place
where doing nothing is the correct behaviour.

Then try `partial_settlement`: the paid portion discharges the obligation and the shortfall posts to
settlement suspense with an owner. It is not written off.

Then `returned_payment`: the original settlement is **not** reversed. A return is a new event.

## 10. What is not finished

Ending here on purpose. A demonstration that ends on a claim is less informative than one that ends
on a gap.

| | |
|---|---|
| **No corridor is confirmed** | The CBN filing was not available. Every corridor fact is a visible placeholder, and a rule fires on every transaction so none clears automatically |
| **No partner is real** | Every partner is a simulator. No agreement with any institution has been confirmed |
| **No independent security review** | Nothing in the risk register has reached `implemented_and_independently_reviewed` |
| **No restoration test** | Backups that have not been restored are not backups |
| **No antivirus** | Document checks are structural, and are not described as scanning anywhere |
| **No uptime measurement** | Therefore no availability figure is claimed |
| **One person** | Separation of duties is in the software and not yet in the organisation |
| **Ten founder decisions open** | Listed in `A-founder-decisions.md` and in the Learning Center |

`25-pilot-readiness-report.md` states the position on each of these in the form of a readiness
verdict.

---

## Suggested sequence for a live session

About 45 minutes.

| # | Screen | Point |
|---|---|---|
| 1 | Supervisory view | What EKORails is not, and how each is enforced |
| 2 | Release gates | Live funds are not reachable |
| 3 | Ledger accounts | No customer stored-value account exists |
| 4 | New transaction → authorise | Separation of duties, refused in front of you |
| 5 | Compliance case | Every rule evaluated, including the quiet ones |
| 6 | Simulation control → timeout | The system does nothing, correctly |
| 7 | Trial balance | Balanced, checked in SQL |
| 8 | Audit trail | A refusal, and the chain verification |
| 9 | Product map | What is genuinely unfinished |
