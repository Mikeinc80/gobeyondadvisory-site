<!--
  GENERATED FILE — do not edit.

  Produced by scripts/generate-docs.mjs from the definitions the software actually
  uses. If this document is wrong, the code is wrong: change the code and regenerate.
  `node scripts/generate-docs.mjs --check` fails the build when the two disagree.
-->

# 25 — Pilot readiness report

## Verdict: **NOT READY**

**REGULATORY DEPENDENCY** · **PARTNER DEPENDENCY** · **SECURITY DEPENDENCY** · **FOUNDER DECISION REQUIRED**

This verdict is computed when the document is generated, from the actual state of the
release gates, the blocking risks, the open founder decisions and the honest build stage
of every module. It is not a sentence somebody typed. It cannot read "ready" while any of
those says otherwise, which is the only way a readiness report stays worth reading.

| | |
|---|---|
| Release gates met | 0 of 9 |
| Risks that block a pilot | 7 of 16 |
| Founder decisions open | 10 of 10 |
| Modules at pilot-ready | 0 of 16 |

## What the verdict is not saying

It is not saying the software does not work. It does: a payment runs end to end, the
ledger balances, every failure path can be produced deliberately and is handled, and
every screen renders for every role in a real browser.

It is saying that a pilot is a regulated activity with real customers and real money, and
the things standing between this build and one are mostly not engineering.

## Release gates

Each requires named evidence. None is settable from any interface; they are process-level
configuration read once at start-up. Setting one without the evidence behind it is not a
configuration change — it is a false statement about the state of the business.

| Gate | Evidence required | Met |
|---|---|---|
| `EKORAILS_GATE_REGULATORY_APPROVAL` | Approval letter reference and date, attached to the pilot readiness report. | **no** |
| `EKORAILS_GATE_LICENCE_VERIFIED` | Licence register check per partner, dated within 90 days. | **no** |
| `EKORAILS_GATE_PARTNER_CONTRACTS` | Signed agreements stating which party bears loss at each stage, and by whom settlement finality is conferred — since EKORails cannot confer it. | **no** |
| `EKORAILS_GATE_SECURITY_REVIEW` | Test report, remediation evidence, retest confirmation. | **no** |
| `EKORAILS_GATE_PRIVACY_REVIEW` | Signed PIA and transfer assessment. | **no** |
| `EKORAILS_GATE_OPERATIONAL_CONTROLS` | Procedures signed off; named role holders; access review completed. | **no** |
| `EKORAILS_GATE_DR_TESTED` | Restoration test record showing recovered transaction history verified against a known baseline. | **no** |
| `EKORAILS_GATE_RECONCILIATION_SIGNOFF` | Reconciliation sign-off sheets for the observation period. | **no** |
| `EKORAILS_GATE_BOARD_APPROVAL` | Board or equivalent minute. | **no** |

## What blocks a pilot

### Risks (7)

| Ref | Risk | What would clear it |
|---|---|---|
| `R-01` | Operating outside the approved sandbox scope | Obtain the filing and resolve FD-002 and FD-003 before any pilot activity. |
| `R-02` | Appearing to perform a licensed activity | Legal review of all external-facing copy before any external demonstration. |
| `R-05` | Single settlement partner concentration | Identify a second settlement partner before the pilot ends. No partner is contracted today. |
| `R-08` | Exposure of personal data | Complete the privacy impact assessment and the cross-border transfer assessment (FD-008), and connect a managed key store instead of a derived key. |
| `R-12` | Document-borne malware | CONNECT A REAL ANTIVIRUS SERVICE. The current checks are structural only and are explicitly not antivirus. This is a named gap. |
| `R-14` | Backup restoration has never been tested | Perform and evidence a full restoration test, including transaction-history verification. Release gate EKORAILS_GATE_DR_TESTED depends on it. |
| `R-16` | Key-person dependency | Appoint a named compliance officer and a second engineer before the pilot begins. |

### Decisions (10)

| Ref | Decision | Blocks |
|---|---|---|
| `FD-001` | What legal entity particulars may the product display? | Regulator view, transaction receipts, PDF report footers. |
| `FD-002` | Which corridor and currency pair does the pilot run? | Corridor configuration, FX pair, limits, every compliance evaluation. |
| `FD-003` | What transaction and pilot limits apply? | The limit and velocity rules; the pilot report's breach measures. |
| `FD-004` | What is the settlement mechanism and who are the partners? | Partner adapters, custody posture, the ledger's partner account structure. |
| `FD-005` | Which AML/CFT thresholds and lists apply? | HIGH_RISK_JURISDICTION rule parameters; reporting thresholds. |
| `FD-006` | What regulatory returns must be filed, in what form, and how often? | Report headers and the regulatory export route. |
| `FD-007` | How long does the pilot run and what counts as success? | Pilot report targets and the readiness assessment. |
| `FD-008` | Where is the system deployed, and what data residency is claimed? | Infrastructure deployment, the privacy impact assessment, customer contracts. |
| `FD-009` | What may be said publicly about sandbox status? | All external-facing copy, the pitch deck, the website. |
| `FD-010` | Framework choice: minimal dependencies versus a conventional stack | Nothing. Recorded because a technical due-diligence reviewer will ask why. |

## Build status, module by module

The stage shown is the highest each module has GENUINELY reached. An interface existing
is not a stage. `security_reviewed` requires an independent review, which has not taken
place, so nothing here is above `tested`.

| Stage | Modules |
|---|---|
| `integrated` | 2 |
| `tested` | 14 |

| Module | Stage | What is simulated | Known limitations |
|---|---|---|---|
| Organisation onboarding (KYB) | `tested` | Identity verification and screening go to simulators. Documents are hashed, type-checked and basic-screened, but no antivirus service and no blob store are connected. | Ownership is captured as declared, not verified against a company register. No corporate registry integration exists. |
| Compliance engine | `tested` | Sanctions, PEP and adverse-media screening use a clearly labelled FICTIONAL list. The names on it are invented and must never be replaced with real designated persons. | The high-risk jurisdiction list is deliberately EMPTY: naming jurisdictions would assert a regulatory fact the CBN filing has not supplied. Nigerian AML thresholds are unconfirmed (FD-005). No machine-learning scoring — every rule is explicit and readable. |
| Double-entry ledger | `tested` | All balances are simulated. Partner accounts are opened with a "test liquidity" injection that exists only to make it obvious the money was invented for the demonstration. | No period-end close, no accounting-system export, and no multi-entity consolidation. Sub-ledger accounts are created on demand rather than from a maintained chart. |
| Settlement orchestration | `tested` | Every partner is a simulator. Eleven failure scenarios can be injected on demand: timeouts, insufficient liquidity, invalid beneficiary, partial settlement, returns and more. | Settlement FINALITY is out of scope. "Settled" means a partner reported the payment as made; finality is conferred by a settlement system operator and nothing here can produce it. |
| Reconciliation and exceptions | `tested` | Partner statements come from the simulator's own record of what it did — deliberately NOT from our ledger, so the two views really can disagree. A scenario can make the partner genuinely wrong, and the run genuinely catches it. | No file-based statement ingestion (MT940, CAMT.053) and no tolerance rules for expected rounding differences. |
| Access control and audit | `tested` | None. Access control and the audit trail are real, and their controls are enforced by the database rather than only by the application. | No external identity provider is connected (the design is OIDC-compatible). No hardware security key support beyond TOTP. Break-glass exists but has not been exercised in a drill. |
| Regulatory boundary | `tested` | Everything that would require a licence is simulated: funding, FX execution, settlement and the beneficiary credit. | The claims lint checks user-facing strings in this repository. It cannot police a slide deck or a conversation. |
| Document management | `integrated` | Nothing here is simulated, but two things are absent: there is NO antivirus scanning, and there is NO blob store. Documents are metadata-tracked and encrypted; the bytes are held inline rather than in a managed object store. | The structural checks are type, size and magic-byte checks. They are NOT virus scanning and are not described as such anywhere. Expiry raises a rule against the next transaction that relies on the document; it does not suspend the customer. |
| AI-assisted document extraction | `tested` | The extractor is a stub. No model is connected, and the proposals it produces are structural rather than read from the document. | No confidence threshold gates anything: a low-confidence proposal and a high-confidence one are both proposals and both need confirming. That is deliberate, because a threshold would create a class of value nobody looked at. |
| Sanctions, PEP and adverse-media screening | `tested` | The provider is a simulator with a fictional list. No commercial screening data is connected and no provider has been contracted. | No ongoing rescreening: a customer cleared today is not automatically rechecked when a list changes tomorrow. Nothing classifies what an adverse-media result contains, so a special-category result is indistinguishable from an ordinary one. |
| Compliance case management | `tested` | Nothing. Case management operates on real records of simulated transactions. | No case assignment workflow beyond an owner field, no workload balancing, and no escalation that fires on its own when a target is breached — the breach is visible and nobody is told. |
| Beneficiary management | `tested` | Screening of the beneficiary goes to the simulator. Account identifiers are fictional. | No account-name verification against the destination bank, because no destination bank is connected. That check is the one that would catch a substituted account before the money moves. |
| FX quoting | `tested` | Every rate is produced by a simulator. No liquidity provider is connected and no rate here reflects any market. | A simulated quote can never be marked as contractually locked, which a test asserts. There is no rate-of-the-day, no forward pricing and no hedging. |
| Partner integration | `tested` | EVERY partner is a simulator. No agreement with any institution has been confirmed to this build, and no partner name here is a claim that an institution has agreed to anything. | There is NO callback authentication, because no partner can call in. A signature scheme must be designed before a real partner is connected — this is a named gap in the threat model. |
| Reporting and export | `tested` | The data is real records of simulated activity. The regulatory report carries no statutory form identifier because none has been supplied. | No scheduled or automated filing, and no submission route — a report is produced and downloaded by a person. Formula injection is neutralised in CSV, but a spreadsheet remains a spreadsheet once it leaves. |
| Founder Learning Center | `integrated` | Nothing. It reports on the real state of the real system. | Assessment results are recorded and never gate anything, deliberately. The guided demonstration is a script a person follows rather than an automated tour, also deliberately — a tour that runs itself demonstrates the tour. |

## What works, stated as plainly as what does not

- A payment runs from creation to completion with a balanced ledger, without anybody
  touching the database.
- Eleven partner failure scenarios can be produced deliberately, and each is handled:
  a timeout stops rather than retries, a shortfall goes to suspense with an owner, a
  return is a new event rather than a reversal.
- The ledger balances in every currency, checked in SQL at start-up and on demand.
- The audit chain verifies, and refusals are recorded as carefully as successes.
- Separation of duties is refused at the state machine, at the service and at the
  database — three independent times.
- Every console renders for every role in a real browser, and the client makes no
  request it is not entitled to make.
- A compliance decision made today can be reconstructed from the record alone.

## What does not work, or does not exist

| | |
|---|---|
| No corridor is confirmed | A rule fires on every transaction. **No transaction in this build can clear compliance automatically.** Intended behaviour, not a defect |
| No partner is real | Every partner is a simulator. No agreement with any institution has been confirmed |
| No independent security review | Nothing in the risk register has reached `implemented_and_independently_reviewed` |
| No restoration test | The procedure exists and has never been executed. Backups that have not been restored are not backups |
| No antivirus | Document checks are structural and are not described as scanning anywhere |
| No blob store | Documents are metadata-tracked and encrypted; no managed object store is connected |
| No managed key store | The encryption key derives from process configuration on the same host as the data |
| No partner callback authentication | No signature scheme exists, because no partner can call in. Must be designed before one is connected |
| No access-pattern monitoring | Insider browsing is recorded and nobody is told |
| No uptime measurement | Therefore no availability figure is claimed anywhere |
| No subject access process | An individual has no route to request their data |
| No accounting period close | The daily reconciliation is not a close and is not presented as one |
| One person | Every separation of duties in the software is held by one pair of hands |

## The shortest path to a pilot

In dependency order. Steps 1 and 2 are not engineering, and nothing after them can start
until they are done.

1. **Attach the CBN Regulatory Sandbox application to this repository.** It resolves
   FD-002, FD-003, FD-005, FD-006 and FD-007 between them, and until it exists no
   transaction can clear compliance.
2. **Contract a settlement partner and a screening provider**, and verify the licence
   under which each activity is performed. FD-004.
3. **Appoint a compliance officer and a second engineer.** R-16. No amount of further
   engineering substitutes for this.
4. **Commission an independent security review** and close its findings.
5. **Perform and evidence a restoration test.** R-14.
6. **Connect a managed key store and a virus-scanning service.** R-08 and R-12.
7. **Complete the privacy impact assessment** and the cross-border transfer assessment.
   FD-008.
8. **Design partner callback authentication** before any partner is connected.
9. **Rehearse the incident, continuity and recovery plans.** All three are written and
   none has been practised.
10. **Replace each placeholder under maker-checker**, and re-run this report.

## The build journal

### Phase 0 — Source-of-truth review — 2026-08-20

**Built:** A complete traceability review of the 22 facts the CBN filing was supposed to control, a code-enforced regulatory boundary, a data classification, a risk register and nine founder decisions.

**Still simulated:** Nothing yet — this milestone produced analysis, not running software.

**Known limitations:** The controlling document is genuinely absent. Thirteen of twenty-two controlled facts are fully unresolved.

**Open:** FD-001 through FD-009, all awaiting approval.

**For the founder:** Can you attach the final CBN Regulatory Sandbox application to this repository? Until then no transaction can auto-clear compliance and the pilot cannot start.

### Phase 1 — Foundations — 2026-08-20

**Built:** PostgreSQL schema across eleven migrations: fixed-precision money domains, append-only guards, a deferred constraint trigger enforcing per-currency journal balance, a hash-chained audit trail with SQL-side verification, row-level security with FORCE on every customer-data table, and least-privilege grants. Authentication with scrypt, AES-256-GCM field encryption and RFC 6238 TOTP with a replay guard. Nine roles with explicit denials.

**Still simulated:** None. This layer is real.

**Known limitations:** No external identity provider is connected. Rate limiting is in-process and unsafe across instances (R-13).

**Open:** FD-010 (framework choice) recorded for technical due diligence.

**For the founder:** Do you want an external identity provider (OIDC) before the pilot, or is built-in authentication with mandatory MFA acceptable for a controlled participant group?

### Phases 2 to 5 — Onboarding, transactions, settlement, reconciliation and reporting — 2026-08-20

**Built:** KYB onboarding with beneficial ownership and screening; a 26-rule compliance engine writing reproducible immutable evaluations; beneficiaries with automatic approval invalidation on material change; a double-entry ledger with FX clearing; an auditable FX quotation engine; a 22-state settlement machine where every edge is declared and guarded; partner simulators covering eleven failure scenarios with idempotency; six reconciliation run types; exception management with four-eyes closure; eight reports exportable as CSV, XLSX and PDF; and the Founder Learning Center.

**Still simulated:** Every partner. Funding, FX execution, settlement and the beneficiary credit are all simulated. Screening uses a clearly labelled fictional list. Email and SMS have no transport configured and say so in the delivery record.

**Known limitations:** No document blob store and no antivirus service (R-12). No statement file ingestion. Settlement finality is out of scope by design.

**Open:** All ten founder decisions remain unapproved.

**For the founder:** Review the twenty-six compliance rules in the Learning Center. Are any missing for your corridor, and are any so noisy they would be cleared without being read?

### Phase 6 — The six consoles and the Founder Learning Center — 2026-08-20

**Built:** Six role-scoped interfaces — business, operations, compliance, finance, oversight and administration — plus the ten-component Learning Center. Plain ES modules under a strict Content-Security-Policy: no framework, no build step, no third-party JavaScript reaching a browser. Navigation is built from the permissions the server reports, and every route is guarded again by the API and again by row-level security.

**Still simulated:** Nothing new. The interfaces render real records of simulated activity.

**Known limitations:** The CSP permits inline styles, because the client sets style attributes from literals. script-src is properly locked with a nonce. This is recorded as an accepted finding rather than described away.

**Open:** FD-010 records the no-build-step decision and its cost.

**For the founder:** The consoles are usable and every screen renders for every role. Nobody outside the build has used them. Founder acceptance is a completion stage and no module has reached it.

### Phase 7 — Verification, documentation, and what running it found — 2026-08-20

**Built:** Twenty-nine documents, of which ten are GENERATED from the definitions the software uses — the data model, API reference, state machine, role matrix, compliance control matrix, traceability, risk register, pilot readiness, founder decisions and the claims-lint word list. Regenerating them is part of the build and a drift fails it.

**Still simulated:** Unchanged.

**Known limitations:** The prose documents — the threat model, the privacy assessment, the manuals — carry no automated check, because judgement cannot be regenerated. They will drift, and they should be re-read whenever the thing they describe changes.

**Open:** All ten founder decisions remain open. None can be resolved by the build.

**For the founder:** The four things that would move this build furthest are not engineering: attach the CBN filing, contract a partner, appoint a second person, and commission an independent security review. Which of those can you start this month?
