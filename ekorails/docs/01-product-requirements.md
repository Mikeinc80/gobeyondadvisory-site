# 01 — Product requirements

**Entity:** EKORails LTD
**Product:** Compliance-first B2B cross-border settlement orchestration
**Status of this document:** complete, with every regulatory fact held as a placeholder
**Controlling source:** the final EKORails CBN Regulatory Sandbox application — **not available to
this build**. See `00-source-of-truth-review.md`.

---

## 1. What this product is

EKORails orchestrates business-to-business cross-border trade settlement. A Nigerian business that
owes a foreign supplier uses it to prepare a payment, prove where the money came from, pass
compliance review, obtain a rate, instruct a licensed partner to settle, and reconcile the result
against that partner's own record.

The word that does the work is *orchestrates*. EKORails coordinates a sequence of steps performed
by other, licensed parties. It does not perform them.

## 2. What this product is not

This list is not a disclaimer bolted onto a product that behaves otherwise. Each item is enforced
in code and is testable; §7 says how.

EKORails is not:

- a bank
- a deposit-taking institution
- a licensed payment provider
- a custodian of customer funds
- a cryptocurrency exchange or any kind of public exchange
- a consumer investment platform
- an admitted participant in the CBN Regulatory Sandbox

And this product does not do:

- retail remittance
- personal wallets or stored value of any kind
- lending, credit or factoring
- investment products
- card issuing or acquiring
- cryptocurrency trading, custody or conversion

## 3. Who it is for

Registered businesses with a genuine commercial reason to pay a foreign counterparty — an invoice,
a purchase order, a shipping document. The onboarding path assumes a company with a registration
number, a beneficial-ownership structure and documents. There is no path in this software by which
an individual can onboard, and there is no account type that would fit one.

## 4. The nine roles

Set out in full, with permissions and explicit denials, in `08-role-permission-matrix.md`. In
outline:

| Role | Realm | What they are for |
|---|---|---|
| Business Initiator | Customer | Manages the business profile, adds beneficiaries, prepares payments |
| Business Approver | Customer | Provides the second authorisation on a colleague's payment |
| Compliance Analyst | EKORails | Reviews screening results and cases; clears or escalates with a written reason |
| Compliance Manager | EKORails | Approves high-risk cases; reviews an analyst's decision |
| Treasury and Settlement Operator | EKORails | Quotes, funds, converts, routes settlement |
| Finance and Reconciliation Analyst | EKORails | Owns the ledger, daily reconciliation, financial reporting |
| Auditor or Regulator | External | Read-only oversight of everything, with personal data masked |
| System Administrator | EKORails | Configuration, users, integrations. No money, no compliance, no ledger |
| Super Administrator | EKORails | Break-glass. Every use is a recorded, reviewable event |

Two separations matter more than the rest and are enforced against the *context* of an action
rather than against the permission set:

- **The person who prepares a payment cannot authorise it.** Not "should not" — the state machine
  refuses the transition and records the refusal.
- **The person who investigates a reconciliation break cannot approve its closure**, above the
  four-eyes threshold.

## 5. The transaction lifecycle

Twenty-two states and every route between them are declared as data, not implied by code. See
`07-transaction-states.md` for the complete table. The ordinary path is:

```
draft → pending_business_approval → pending_compliance → compliance_approved
      → quote_issued → quote_accepted → awaiting_funding → funding_confirmed
      → ready_for_settlement → submitted_to_partner → partner_processing
      → settled → beneficiary_confirmed → reconciled → completed
```

Every other route exists because payments go wrong. A payment can be declined by its own approver,
rejected by compliance, sent back for information, expired, cancelled before funding, refused by a
partner, partially settled, returned by the destination bank, or — the one that matters most — left
in a state where the partner never answered and nobody knows what happened. That state is
`under_investigation`, automatic retry is disabled in it, and getting out of it requires a person.

## 6. The sixteen modules

| # | Module | What it does |
|---|---|---|
| 1 | Identity and access | Authentication, second factor, sessions, roles, re-authentication for sensitive actions |
| 2 | Customer onboarding (KYB) | Business profile, beneficial ownership, documents, submission for review |
| 3 | Document management | Upload, classification, expiry tracking, encrypted storage, structural checks |
| 4 | AI-assisted extraction | Proposes fields from a document. **Never confirms anything.** A person must confirm |
| 5 | Screening | Sanctions, PEP and adverse media, against a provider. Every match is disposed of by a person |
| 6 | Compliance engine | 26 rules evaluated against every applicable subject, recorded whether or not they fire |
| 7 | Case management | Compliance cases with a service target, an assignment, notes and permanent decisions |
| 8 | Beneficiary management | Beneficiaries approved separately before first use; re-review on change |
| 9 | Transaction lifecycle | The state machine, its permissions, its preconditions and its reasons |
| 10 | FX quoting | Indicative rates with an explicit spread and expiry. Nothing is described as locked |
| 11 | Partner integration | Provider-neutral adapters with idempotency keys and injectable failure scenarios |
| 12 | Double-entry ledger | Every movement balances by currency; balances are derived; corrections are reversals |
| 13 | Reconciliation | Five daily comparisons, breaks opened as exceptions with owners and four-eyes closure |
| 14 | Reporting | Nine reports in JSON, CSV, XLSX and PDF, each export recorded with a content hash |
| 15 | Audit and oversight | Hash-chained append-only audit trail, verifiable in SQL, exportable with a manifest |
| 16 | Founder Learning Center | Ten components explaining the system, including what is not finished |

Honest build status for each is in the Product Map inside the application, and is repeated in
`25-pilot-readiness-report.md`. Nothing is reported as complete because an interface for it exists.

## 7. Requirements that are enforced rather than asserted

These are the requirements whose violation would matter most, and the mechanism that makes each one
hold. Each is exercised by an automated test; `10-requirements-traceability.md` maps them to the
tests one by one.

| Requirement | Enforced by |
|---|---|
| No real money moves in this deployment | Settlement defaults to simulation. Live funds require nine release gates set as process-level environment configuration, none reachable from any interface. `assertLiveMoneyPermitted()` throws unconditionally in this build |
| EKORails never holds customer funds | The chart of accounts contains no customer stored-value account. There is nowhere in the ledger to record it. Funding is recorded as arriving at the partner |
| Money is never a floating-point number | Every monetary column is `NUMERIC(24,6)`; every rate is `NUMERIC(24,12)`; the application's `Decimal` is BigInt-backed and refuses to construct from a JavaScript number with a fraction |
| A journal that does not balance cannot exist | A deferred constraint trigger sums each journal by currency at commit and raises if it is not zero |
| Evidence cannot be edited or deleted | Append-only triggers plus withheld `UPDATE`/`DELETE` grants on audit, ledger, decision and transition tables. The trigger raises even for the table owner |
| The audit trail cannot be silently altered | Each entry hashes its predecessor and its own contents. Verification is a SQL function, so it does not rely on the application being honest |
| One organisation cannot see another's data | Row-level security with `FORCE` on every table carrying customer data, driven by a transaction-local security context |
| An initiator cannot authorise their own payment | A declared separation rule evaluated against the transaction's initiator, refused by the state machine |
| Sensitive credentials never reach a log | A redaction layer over structured logging. A test asserts that no password, token, full identifier, account credential or key appears in log output |
| Users cannot be told a rate is guaranteed | A claims lint over every user-facing string in the repository, failing the build on prohibited language |
| AI extraction cannot decide anything | Extraction writes to a separate table with status `proposed`, is never read by the compliance engine, and requires a recorded human confirmation to reach a transaction |

## 8. The four environment modes

| Mode | Settlement | Live funds | Purpose |
|---|---|---|---|
| `DEMO` | Simulated | Impossible | Demonstrations and founder learning. Fictional data |
| `SANDBOX` | Simulated | Impossible | Internal testing and regulatory evaluation |
| `CONTROLLED_PILOT` | Simulated unless every gate is met | Gated | Supervised pilot. Not reachable today |
| `PRODUCTION` | — | Gated | Architecture planning only. The process refuses to start with any gate unmet |

The mode is read once from process configuration at start-up and cannot be changed by the API, the
interface, a feature flag or a database row. A banner stating **SANDBOX ENVIRONMENT. NO LIVE
FUNDS.** is the first element in the document on every screen, travels on every API response, and
the client blocks the page if the two disagree.

## 9. What is deliberately incomplete

Stating this in the requirements document rather than only in a report, because a requirements
document that describes a finished product nobody has built is the more common failure.

- **No corridor is confirmed.** `CORRIDOR_PLACEHOLDER_UNCONFIRMED` fires on every transaction, so
  no transaction in this build can clear compliance automatically. This is intended behaviour.
- **No partner is real.** Every partner interaction is a simulator. No agreement with any
  institution has been confirmed to this build.
- **No antivirus.** Document checks are structural. They are not virus scanning and are not
  described as such anywhere.
- **No document blob store.** Documents are metadata-tracked and encrypted; a managed object store
  is not connected.
- **No metrics, tracing or uptime monitoring**, and therefore no availability figure is claimed.
- **No independent security review.** Nothing in the risk register has reached
  `implemented_and_independently_reviewed`.
- **No restoration test.** Backups that have not been restored are not backups.

## 10. Success criteria for the MVP

An honest set, in the order they have to be true:

1. A complete transaction runs end to end without a person editing the database. **Met.**
2. Every failure path in the state machine can be produced deliberately and the system handles each
   one without losing money or losing the record. **Met** — eleven injectable partner scenarios.
3. The ledger balances in every currency after every scenario. **Met** — checked at start-up and by
   the test suite.
4. A compliance decision made today can be reconstructed a year from now from the record alone.
   **Met** — self-contained evaluations with ruleset and input hashes.
5. Every screen a role can reach renders correctly for that role, with no request the role is not
   entitled to make. **Met** — 126 page loads across nine roles in a real browser, covering
   every item each role's navigation offers, plus a write journey through initiate, submit
   and authorise.
6. No claim is made anywhere that EKORails is not entitled to make. **Met, within this repository.**
   The lint cannot police material outside it.
7. The regulatory facts are confirmed. **Not met, and not within this build's power to meet.**
