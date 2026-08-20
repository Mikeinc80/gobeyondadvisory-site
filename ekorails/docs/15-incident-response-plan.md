# 15 — Incident response plan

**Status: written, never rehearsed.** A plan nobody has practised is a document, not a capability.
Rehearsing it is part of `EKORAILS_GATE_OPERATIONAL_CONTROLS`, which is not met.

**The honest constraint on everything below:** there is currently one person. Every role in this
plan is the same person, which means the plan describes what should happen rather than what would.
This is `R-16` and it blocks a pilot.

---

## 1. What counts as an incident

| Severity | Examples | Response starts |
|---|---|---|
| **Critical** | Ledger does not balance; audit chain does not verify; suspected unauthorised access to customer data; a payment instructed twice; credentials exposed | Immediately, at any hour |
| **High** | A partner reports a payment we have no record of; a customer's data shown to another customer; authentication bypass; sustained unavailability | Within 1 hour |
| **Medium** | A reconciliation break nobody can explain; a compliance decision recorded against the wrong case; a document served to the wrong role | Same working day |
| **Low** | A single failed job; a cosmetic defect on a screen; a rate-limit false positive | Next working day |

Two of these deserve saying out loud, because the instinct is to treat them as bugs:

- **A ledger that does not balance is critical**, not a data problem to look at tomorrow. The
  service refuses to start on one, and that is the correct behaviour.
- **A payment instructed twice is critical** even if the second instruction was rejected. It means
  a control that should have prevented it did not.

## 2. The first hour

In order. Do not skip step 2 to get to step 3 faster.

1. **Declare.** Write down the time, what was seen, and who saw it. A `security_incident` record
   with a reference, severity and category. Everything after this attaches to that record.

2. **Preserve.** Before changing anything: capture the audit range, the relevant transactions, the
   ledger state and the logs. Investigation destroys evidence, and the record of what happened is
   often more valuable than a fast fix.
   ```
   GET /api/audit/export?from_seq=<before>&to_seq=<after>   # carries an integrity manifest
   GET /api/audit/verify                                     # is the chain intact?
   GET /api/ledger/trial-balance                             # does the ledger balance?
   ```

3. **Contain**, in increasing order of disruption:
   - Suspend the affected user or organisation (`org.suspend`) — narrow, reversible.
   - Revoke sessions for the affected accounts.
   - Suspend affected transactions (`txn.suspend`) so nothing progresses while you look.
   - Stop the background worker.
   - Take the service down. It defaults to simulation, so downtime moves no money.

4. **Assess.** Is customer data involved? Has money moved, or could it? Is the record intact? These
   three answers determine everything that follows.

## 3. By incident type

### The ledger does not balance

The service will not start. That is not something to work around.

1. `verifyLedgerIntegrity()` names the unbalanced or single-entry journals.
2. Read them. A journal that does not balance should be impossible — the constraint trigger runs at
   commit — so the presence of one means either the trigger was dropped or the data was written
   outside the application.
3. **Do not "fix" it with an adjustment.** Find out how it got there first. An adjustment posted
   over an unexplained imbalance destroys the only evidence of how it arose.
4. If a correction is genuinely needed, it is a reversal, posted by a Finance Analyst and approved
   by a second person.

### The audit chain does not verify

1. `GET /api/audit/verify` reports the first broken sequence number and both hashes.
2. Treat everything after that sequence as unreliable until explained.
3. A break means either a record was altered — which requires database credentials and dropping a
   trigger — or the chain was rebuilt.
4. **This is the scenario the threat model is most honest about:** with no off-host copy of a chain
   head, a patient attacker with the owner role can rewrite history and recompute every subsequent
   hash, and this check would pass. A break tells you something happened; the absence of a break
   does not prove nothing did.

### Suspected unauthorised access to customer data

1. Establish scope from the audit trail: `data_access` category, filtered by actor and window.
2. Establish whether unmasked data was reached — `pii.unmask` use is separately audited.
3. Revoke the sessions and suspend the account.
4. **Notification.** Whether notification is required, to whom, and within what period, depends on
   the applicable regime, which is unresolved (FD-008, and see `14-privacy-impact-assessment.md`).
   The `security_incident` record carries `notification_required` and `notified_at` fields; they are
   there so the decision is recorded either way, including a decision not to notify and its reason.

### A payment may have been made twice

The most expensive incident this system can have.

1. **Do not retry anything.** Move the transaction to `under_investigation` if it is not there.
2. Read `integration_event` for the transaction: every partner exchange, its idempotency key, its
   outcome and its latency.
3. Contact the partner and establish the true position from their records, not from ours.
4. Only then decide. If two payments were made, the second is a return to pursue, recorded as its
   own event — not as a reversal of the first.

### A partner reports a payment we have no record of

`missing_internal_record` from reconciliation, and the more serious direction of the two.

1. Do not adopt the partner's figure.
2. Open an exception at critical priority.
3. Establish whether an instruction left this system at all: `integration_event` is the record.
4. If it did not, the question is how the partner came to act, and that is a partner incident.

## 4. Communication

| Who | When | What |
|---|---|---|
| Affected customers | As soon as the scope is known, before it is fully understood | What happened, what it means for them, what they should do. Not a reassurance with no content |
| The partner | Immediately for anything touching settlement | Facts and references. Not speculation about cause |
| A supervisor | Per the applicable regime — **unresolved** | Recorded either way in the incident record |
| Internally | Continuously | The incident record is the single place |

The rule for customer communication: say what is known, say what is not yet known, and say when the
next update will come. An update that says "we are still investigating and will update you at 16:00"
is worth more than silence and worth far more than premature reassurance.

## 5. After

Within five working days:

1. **Timeline** from the audit trail, not from memory.
2. **Root cause.** Not "human error" — what made the error possible, and what made it undetectable
   for as long as it was.
3. **What worked.** Controls that caught it or limited it. Worth recording; they justify their cost.
4. **What did not.** Including controls that should have caught it earlier.
5. **Actions**, each with an owner and a date. Added to the risk register if they represent a
   standing risk rather than a one-off fix.
6. **A test.** Any incident with a technical root cause gets a regression test that fails without
   the fix. An incident without a test is an incident waiting to recur.

## 6. What this plan does not have

- **No on-call rotation.** One person.
- **No paging.** No alerting is deployed, so an incident is noticed when somebody looks.
- **No monitoring.** There is no metric that would tell you the ledger stopped balancing between
  restarts; the check runs at start-up and on demand.
- **No forensic retention beyond the database.** Logs are written to standard output. Whatever the
  deployment captures is what exists.
- **No rehearsal.** Nobody has run a scenario against this plan.

Each of these is a real gap and each is deliberately listed rather than left for a reviewer to
discover.
