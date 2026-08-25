# How to run this system yourself

For an evaluator at the Central Bank of Nigeria, or a technical reviewer acting for it.

A screenshot proves what somebody chose to photograph. This document exists so you do not
have to rely on ours: the whole system stands up on one machine in about five minutes, with
fictional data, and every claim in the application can be checked directly.

---

## What you will be running

**EKORAILS LIMITED** (RC 9490673) settlement orchestration, in SANDBOX mode.

- **No real money can move.** Settlement runs through simulators. Nine release gates stand
  between this build and live funds; none is met, and none can be set from any screen.
- **Every business, person, document and account number is fictional.** No real identity
  document or bank detail appears anywhere.
- The environment banner — **SANDBOX ENVIRONMENT. NO LIVE FUNDS.** — is the first element on
  every page, travels on every API response, and the browser blocks the page if the two ever
  disagree.

## Requirements

Node.js 22 and PostgreSQL 16. Or Docker, if you prefer.

## Five commands

```bash
git clone <repository> && cd ekorails
npm install
./scripts/provision-roles.sh     # three database roles, least privilege
./scripts/db-reset.sh            # schema
npm run build && npm run seed    # fictional demonstration data
npm start                        # http://127.0.0.1:8080
```

Or, with Docker: `docker compose up`.

The seeder prints every account it created and one shared passphrase. Each account requires a
second factor; get a current code with the command the seeder prints:

```bash
node services/api/dist/src/seed/totp.js auditor@ekorails.invalid
```

**Start with `auditor@ekorails.invalid`.** It is the read-only oversight role and it sees
everything, with personal data masked.

## Verify the claims that matter, in order

Each of these takes under two minutes, and each names what would disprove it.

### 1. No real money can move

**Oversight → Controls.** Nine release gates, each with the evidence it requires, and the
count met.

*Disproved if:* any screen, setting or API call changes a gate. There is none — they are read
from the process environment once at start-up. In production mode the service refuses to
start with any gate unmet, and in this build the function that would permit live money throws
unconditionally regardless of configuration.

### 2. EKORails cannot hold customer funds

**Finance → Ledger accounts.** Read the chart of accounts.

There is no customer stored-value account, no wallet, no client-money account. Not disabled —
absent. Then open any completed payment and read its ledger entries: the funding receipt
debits the **partner** account. Value is recorded as arriving at the licensed partner, never
at EKORails.

*Disproved if:* you find an account category that could hold a customer balance. The complete
list is in `docs/04-data-model.md`, generated from the schema.

### 3. The ledger cannot be wrong in the ways that matter

**Finance → Trial balance.** Debits equal credits in every currency.

The check runs in SQL against the tables, so a defect in the application cannot make it pass,
and the service refuses to start if it fails. To see the constraint work, try to insert an
unbalanced journal directly:

```sql
-- Refused at COMMIT by a deferred constraint trigger, not by application code.
```

*Disproved if:* any currency shows a non-zero difference, or you find a stored balance column
anywhere. Every balance is summed from entries at the moment you read it.

### 4. The record cannot be quietly altered

**Oversight → Audit trail.** The hash chain verification runs inside the database.

Filter to category `authorisation` and look for outcome `denied`. **Refusals are recorded as
carefully as successes** — a trail containing only successes tells you nothing about what
somebody attempted.

*The limitation we state ourselves:* with no off-host copy of a chain head, an attacker
holding the database owner role could rewrite records and recompute every subsequent hash,
and this check would pass. A break proves tampering; the absence of one does not prove its
absence. This is recorded as gap 1 in `docs/12-threat-model.md`.

### 5. Separation of duties is refused, not discouraged

Sign in as `amara.initiator@lagosagri.invalid`, create a payment, submit it — then try to
authorise it yourself. The system refuses, and **the refusal appears in the audit trail.**

Then try, as `compliance.analyst@ekorails.invalid`, to clear a case marked for manager
authority. Refused, and recorded.

### 6. A compliance decision can be reconstructed years later

**Compliance → Case queue**, open any case.

You will see every rule that applied and was evaluated — **including those that did not
fire** — with the rule text, the parameter values in force at the time, and the data read.
The record is self-contained: it is not read back from current configuration, so a later rule
change cannot alter what a past decision appears to have rested on. Both the ruleset hash and
the input hash are stored, and the screen recomputes the ruleset hash from the stored
snapshot and tells you whether they agree.

### 7. Automation does not decide

Compliance rules recommend; a named person decides with a written reason. AI extraction
writes proposals into a separate table that the compliance engine never reads, and a person
must confirm each value. The word "verified" is never used about extraction, and a build-time
check fails the release if it appears.

### 8. Watch it fail — the part worth insisting on

**Administration → Simulation control** (`admin@ekorails.invalid`). Direct the settlement
simulator to `partner_timeout`, then submit a settlement.

The payment moves to `under_investigation` and **automatic retry switches off**. That is the
scenario that causes duplicate payments in systems that retry blindly, and doing nothing is
the correct behaviour.

Then `partial_settlement`: the paid portion discharges the obligation and the shortfall posts
to settlement suspense with an owner. Then `returned_payment`: the original settlement
journal is **not** reversed, because a return is a new event.

### 9. Why nothing clears compliance automatically

**Compliance → Case queue.** Every transaction has raised a case.

The corridor is an unconfirmed placeholder, so `CORRIDOR_PLACEHOLDER_UNCONFIRMED` fires on
every payment. This is intended behaviour for a system whose regulatory scope has not been
confirmed. It is offered as evidence of posture rather than apologised for: a build that
invented a corridor to demonstrate a smooth flow would be demonstrating something other than
what it would do under supervision.

### 10. What is not finished

**Learning → Product map**, and `docs/25-pilot-readiness-report.md`, whose verdict is
computed from the state of the gates, the blocking risks and the open decisions rather than
typed in by its author.

## Run the checks yourself

```bash
npm test                    # 185 tests against a real PostgreSQL
node scripts/lint-claims.mjs        # language this entity may not use
node scripts/smoke-web.mjs          # 126 page loads across nine roles in a browser
```

Six checks fail the build rather than allowing drift: the claims lint, the web link check,
the environment check, the generated-document check, the traceability check and the prose
count check.

Of particular interest to an evaluator: `npm test` includes twenty mandatory cases that
assert the database refuses things the application would otherwise allow — an unbalanced
journal, an edited audit record, a self-approval, cross-organisation access.

## Accounts

One passphrase, printed by the seeder. Every account has a second factor.

| Account | Role |
|---|---|
| `auditor@ekorails.invalid` | Read-only oversight. **Start here** |
| `amara.initiator@lagosagri.invalid` | A customer preparing payments |
| `tunde.approver@lagosagri.invalid` | The customer's second authoriser |
| `compliance.analyst@ekorails.invalid` | Compliance review |
| `compliance.manager@ekorails.invalid` | High-risk approval |
| `treasury@ekorails.invalid` | Quotation, funding, settlement routing |
| `finance@ekorails.invalid` | Ledger and reconciliation |
| `admin@ekorails.invalid` | Configuration and the simulators |

## Where the documents are

`docs/` carries twenty-nine documents. Ten are generated from the code, and the build fails
if they drift from it. The ones most likely to be relevant:

| | |
|---|---|
| `23-regulator-demonstration-guide.md` | The supervisory walkthrough, with what would disprove each claim |
| `09-compliance-control-matrix.md` | Every rule, including how each can be wrong |
| `08-role-permission-matrix.md` | Nine roles with explicit denials |
| `07-transaction-states.md` | Every state and every declared route between them |
| `12-threat-model.md` | Eight gaps, listed together in §4 |
| `11-risk-register.md` | Control status stated honestly |
| `25-pilot-readiness-report.md` | The computed readiness verdict |
| `A-founder-decisions.md` | Every fact this application seeks to establish |

## If something does not work

The service deliberately refuses to start rather than serve traffic it cannot vouch for. It
will stop if migrations are not applied, if the ledger does not balance, or if the audit
chain does not verify. There is no flag to skip those checks.

The most common setup issue is the database roles: run `./scripts/provision-roles.sh` before
`./scripts/db-reset.sh`. On a managed database, set `EKORAILS_DB_SUPERUSER` so it connects
over TCP.
