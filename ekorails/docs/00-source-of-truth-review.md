# Phase 0 — Source-of-Truth Review

**Entity:** EKORails LTD
**Document status:** Phase 0 complete — blocked on primary source
**Date of review:** 2026-08-20
**Reviewer:** Founding product / engineering / compliance / security team

---

## 1. Controlling source availability

The build brief names the **final EKORails CBN Regulatory Sandbox application and its supporting
documents** as the controlling source for legal entity, corridor, product, customer category,
transaction limits, settlement mechanism, architecture, compliance process, regulatory obligations,
partner roles, pilot duration, success measures and risk controls.

### Search performed

| Location | Method | Result |
|---|---|---|
| Repository `mikeinc80/gobeyondadvisory-site` (all branches) | `grep -ril "ekorails\|CBN\|sandbox"` across HTML/JS/JSON | No sandbox application. Only unrelated Go Beyond Advisory marketing articles, one of which discusses settlement rails as commentary, not as an EKORails filing. |
| Connected Google Drive | `fullText contains 'EKORails'` | 0 results |
| Connected Google Drive | `title contains 'EKO'` | 0 results |
| Connected Google Drive | `fullText contains 'Regulatory Sandbox'` | 0 results |
| Connected Google Drive | `fullText contains 'Central Bank of Nigeria'` | 0 results |

**Conclusion: the controlling source is not available to this build.**

### Consequence — the rule this build follows

Per the brief: *"If the application is unavailable or silent on a material issue, do not invent a
regulatory or commercial fact."*

Accordingly, **no regulatory or commercial fact has been invented anywhere in this codebase.**
Every fact that would normally come from the filing is represented in exactly one of three ways:

1. **A configuration placeholder** with an explicit `INSERT_APPROVED_*` sentinel value, stored in
   `system_configuration` and surfaced in the UI as an unresolved placeholder chip.
2. **A `[FOUNDER DECISION REQUIRED]` entry** in `docs/A-founder-decisions.md` and in the Founder
   Learning Center Decision Log, with one recommended option, the main risk, and an
   `awaiting_approval` status.
3. **A refusal to state the fact at all**, where even a placeholder would imply a claim
   (for example, the system nowhere states that EKORails has been admitted to the CBN sandbox).

The software is fully functional with placeholders in place. Placeholders gate *claims*, not
*function*: the settlement engine, ledger, compliance engine and reconciliation all run end to end
in DEMO and SANDBOX modes without any corridor fact being resolved.

---

## 2. What the system asserts about EKORails (the complete list)

The following is the entire set of assertions this software makes about EKORails. Anything not on
this list, the system does not claim.

| # | Assertion | Basis |
|---|---|---|
| 1 | EKORails LTD is a company building B2B cross-border settlement-orchestration software. | The build brief. |
| 2 | This deployment moves **no** real money. | Enforced in code — see §4. |
| 3 | All balances shown are simulated. | Enforced in code; every monetary display carries a `SIMULATED` marker. |
| 4 | All demonstration businesses, owners, beneficiaries and documents are fictional. | Enforced by the seeder; see `docs/13-data-classification.md`. |

### What the system explicitly does **not** claim

Rendered as a standing disclaimer at `/regulatory-boundary` in every console, and asserted by test
`test/redteam.boundary.test.ts`:

- EKORails is **not** presented as a bank.
- EKORails is **not** presented as a deposit-taking institution.
- EKORails is **not** presented as a licensed payment provider.
- EKORails is **not** presented as a custodian of customer funds.
- EKORails is **not** presented as a cryptocurrency exchange.
- EKORails is **not** presented as a consumer investment platform.
- EKORails is **not** presented as an approved or admitted CBN sandbox participant.

The word list that would breach these boundaries is enforced by an automated lint over all
user-facing strings (`scripts/lint-claims.mjs`), run in CI. It fails the build on unsupported
marketing language ("guaranteed rate", "no spread", "zero loss", "best market rate", "licensed",
"CBN-approved", "we hold your funds", and others). See `docs/B-claims-lint.md`.

---

## 3. Requirements traceability — status of each controlled fact

`UNRESOLVED` means the value is a placeholder awaiting the filing or a founder decision.
`DERIVED` means the brief itself specifies it and no regulatory source is needed.

| ID | Controlled fact | Status | Placeholder / value | Founder decision |
|---|---|---|---|---|
| SOT-01 | Legal entity | PARTIAL | `EKORails LTD` (name only — jurisdiction of incorporation, company number, registered office **not** asserted) | FD-001 |
| SOT-02 | Pilot corridor — origin jurisdiction | UNRESOLVED | `INSERT_APPROVED_ORIGIN` | FD-002 |
| SOT-03 | Pilot corridor — destination jurisdiction | UNRESOLVED | `INSERT_APPROVED_DESTINATION` | FD-002 |
| SOT-04 | Origin currency | UNRESOLVED | `INSERT_ORIGIN_CURRENCY` | FD-002 |
| SOT-05 | Destination currency | UNRESOLVED | `INSERT_DESTINATION_CURRENCY` | FD-002 |
| SOT-06 | Product description | DERIVED | B2B trade-invoice settlement orchestration | — |
| SOT-07 | Customer category | DERIVED | Verified legal businesses only. No retail, no personal wallets. | — |
| SOT-08 | Per-transaction limit | UNRESOLVED | `INSERT_PER_TXN_LIMIT` | FD-003 |
| SOT-09 | Daily aggregate limit | UNRESOLVED | `INSERT_DAILY_LIMIT` | FD-003 |
| SOT-10 | Monthly aggregate limit | UNRESOLVED | `INSERT_MONTHLY_LIMIT` | FD-003 |
| SOT-11 | Pilot-wide aggregate cap | UNRESOLVED | `INSERT_PILOT_AGGREGATE_CAP` | FD-003 |
| SOT-12 | Participant cap | UNRESOLVED | `INSERT_MAX_PILOT_PARTICIPANTS` | FD-003 |
| SOT-13 | Settlement mechanism | UNRESOLVED | Simulated partner rails only. The real mechanism (correspondent bank / licensed PSP / other) is **not** asserted. | FD-004 |
| SOT-14 | Technology architecture | DERIVED | Documented in `docs/02-system-architecture.md`. No regulatory dependency. | — |
| SOT-15 | Compliance process | PARTIAL | Built to generally-accepted AML/CFT practice. Nigerian-specific thresholds **not** asserted. | FD-005 |
| SOT-16 | Regulatory obligations (reporting forms, cadence, recipients) | UNRESOLVED | Report *shapes* are built and exportable; statutory form identifiers are placeholders. | FD-006 |
| SOT-17 | Partner roles | UNRESOLVED | Simulator roles are defined structurally (origin bank, FX/liquidity provider, settlement institution, destination bank). No named institution is asserted. | FD-004 |
| SOT-18 | Pilot duration | UNRESOLVED | `INSERT_PILOT_DURATION_DAYS` | FD-007 |
| SOT-19 | Pilot success measurements | PARTIAL | Metric definitions built and computed; target thresholds are placeholders. | FD-007 |
| SOT-20 | Risk controls | PARTIAL | Control set built and tested (`docs/09-compliance-control-matrix.md`); regulator-mandated controls **not** asserted. | FD-005 |
| SOT-21 | Data residency | UNRESOLVED | `INSERT_APPROVED_CLOUD_REGION`. The system does **not** claim African data residency. | FD-008 |
| SOT-22 | Sandbox admission status | NOT ASSERTED | The system never states EKORails is admitted. A `sandbox_admission_status` config exists and defaults to `not_confirmed`. | FD-009 |

**22 controlled facts. 13 fully unresolved, 5 partially resolved, 4 derived from the brief.**

---

## 4. Regulatory boundary — how it is enforced in code, not just in prose

A boundary that exists only in a document is a boundary a reviewer should not credit. Every item
below is enforced by a code path with a named test.

| Boundary | Enforcement | Test |
|---|---|---|
| Default to simulated settlement | `EKORAILS_ENV_MODE` defaults to `DEMO`; every settlement adapter resolves to a simulator unless mode is `PRODUCTION`. | `env-mode.test.ts` |
| Live mode not activatable through the UI | The environment mode is read from process environment only. No API route, no admin screen and no database row can change it. Attempting to `PATCH` it returns `403 ENV_MODE_IMMUTABLE`. | `env-mode.test.ts` |
| Production money movement disabled | `PRODUCTION` mode requires **nine** independent release-gate flags to be true. All nine default to false and there is no code path that sets them. Booting `PRODUCTION` with any gate false throws at startup and the process exits non-zero. | `env-mode.test.ts` |
| No custody claim | The ledger has no "customer funds held" account. Customer positions are modelled as *receivable* and *payable*, never as a custodial balance. | `ledger.accounts.test.ts` |
| Persistent banner | Every HTML response and every API response carries the environment banner; the API returns it in the `X-EKORails-Environment` header and in the `meta.banner` field of every envelope. | `banner.test.ts` |
| No unsupported claims | Claims lint over all user-facing strings. | `scripts/lint-claims.mjs` in CI |

---

## 5. Contradictions and gaps identified before architecture work

Per the brief, material architecture decisions were held until contradictions were identified.
Four were found and resolved as follows.

### C-1 — "Settlement finality" cannot be demonstrated by a simulator
The brief asks the MVP to demonstrate settlement, and separately asks that nothing be presented as
operational when it is simulated. Settlement *finality* is a legal property conferred by a
settlement system operator; no simulator can produce it.
**Resolution:** the state machine distinguishes `SETTLED` (partner reported success) from
`BENEFICIARY_CONFIRMED` (destination confirmed receipt) and never uses the word "final".
`docs/07-transaction-states.md` states plainly that finality is out of scope for the MVP.

### C-2 — Double-entry ledger vs. "no custody"
A ledger that credits a "customer balance" implies stored value, which implies custody, which
EKORails is not authorised to perform.
**Resolution:** chart of accounts uses `CUSTOMER_FUNDING_RECEIVABLE` and
`CUSTOMER_SETTLEMENT_PAYABLE` only. There is no customer wallet, no stored-value account and no
balance a customer can "hold" or withdraw. Enforced by `ledger.accounts.test.ts`.

### C-3 — AI document extraction vs. evidentiary reliability
The brief permits AI-assisted extraction but forbids presenting it as conclusive.
**Resolution:** extraction output is written to a separate `document_extraction` table with status
`proposed`, is never read by the compliance engine, and cannot reach a transaction without an
explicit human confirmation event recorded with the confirming user's ID. Enforced by
`document.extraction.test.ts`.

### C-4 — Administrator power vs. audit integrity
The brief gives system administrators configuration power and simultaneously forbids them editing
audit, compliance or ledger records.
**Resolution:** enforced at the *database* layer, not the application layer. The application's
database role has no `UPDATE`/`DELETE` grant on `audit_event`, `journal`, `journal_entry` or
`compliance_decision`, and `BEFORE UPDATE OR DELETE` triggers raise an exception even for the table
owner. An administrator with full application privileges still cannot mutate those tables.
Enforced by `audit.immutability.test.ts` and `ledger.immutability.test.ts`.

---

## 6. Founder decisions required before pilot

Ten decisions are open. Nine of them block progression from *Tested* to *Pilot Ready*; FD-010
records a choice already made and blocks nothing. They are recorded in full — with
options, recommendation, risk, reversibility and regulatory impact — in
`docs/A-founder-decisions.md` and are readable and approvable inside the Founder Learning Center
Decision Log.

| ID | Decision | Recommendation | Blocks |
|---|---|---|---|
| FD-001 | Legal entity particulars to display | Display nothing beyond the registered name until incorporation documents are attached | Regulator view, receipts |
| FD-002 | Pilot corridor and currency pair | Nigeria (NGN) → single destination, chosen by settled partner availability, not by market size | Corridor config, FX, limits |
| FD-003 | Transaction and pilot limits | Adopt the filing's limits verbatim; do not set internal limits above them | Limit engine thresholds |
| FD-004 | Settlement mechanism and named partners | Correspondent-bank settlement via a licensed partner; EKORails orchestrates only | Partner adapters, custody posture |
| FD-005 | Nigerian AML/CFT threshold set | Adopt CBN AML/CFT Regulations thresholds once cited in the filing | Rule thresholds |
| FD-006 | Regulatory report forms and cadence | Build to the filing's specified returns; do not invent form identifiers | Report headers |
| FD-007 | Pilot duration and success thresholds | Adopt the filing's duration and targets verbatim | Pilot report targets |
| FD-008 | Data residency and approved cloud region | Complete a residency assessment before selecting a region; do not claim African residency by ownership | Deployment region |
| FD-009 | Public statement of sandbox status | Say nothing until an admission letter exists | All external-facing copy |
| FD-010 | Framework choice: minimal dependencies versus a conventional stack | Keep the minimal stack through the pilot, then reassess | Nothing — recorded because a reviewer will ask why |

---

## 7. Phase 0 exit criteria

| Criterion | Status |
|---|---|
| Requirements traceability matrix produced | Complete — `docs/10-requirements-traceability.md` |
| CBN filing requirements captured | **Blocked** — filing unavailable. Placeholder regime in force. |
| Product assumptions documented | Complete — this document §2 |
| Regulatory boundary defined and code-enforced | Complete — §4 |
| Confirmed pilot corridor | **Blocked** — FD-002 |
| Partner responsibility map | Complete (structural) — `docs/19-partner-integration-guide.md` |
| Data classification | Complete — `docs/13-data-classification.md` |
| Risk register | Complete — `docs/11-risk-register.md` |
| Founder decisions raised | Complete — 10 raised, 0 approved |
| Major contradictions identified before architecture | Complete — 4 found and resolved, §5 |

**Phase 0 verdict: proceed to build with the placeholder regime. Do not proceed to CONTROLLED PILOT
under any circumstances until FD-002, FD-003, FD-004 and FD-009 are approved and the filing is
attached to this repository.**
