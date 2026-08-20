<!--
  GENERATED FILE — do not edit.

  Produced by scripts/generate-docs.mjs from the definitions the software actually
  uses. If this document is wrong, the code is wrong: change the code and regenerate.
  `node scripts/generate-docs.mjs --check` fails the build when the two disagree.
-->

# A — Founder decisions required

10 decisions. **All are open.** None has been approved.

## Why these exist

The CBN Regulatory Sandbox application is the controlling source for the corridor, the
limits, the settlement mechanism, the partner roles, the reporting obligations and the
pilot terms. It was not available to this build.

The instruction in that situation was explicit: do not invent a regulatory or commercial
fact. So none has been invented. Each fact that would have come from the filing is either
an `INSERT_APPROVED_*` placeholder that the software carries visibly through to every
screen, or a decision below, or a statement the system simply refuses to make.

Each decision carries one recommendation, not a menu. A menu is a way of not deciding.

## What an approval here does and does not do

Recording an approval in the Founder Learning Center records the founder's choice and
writes an audit event. **It does not change any configuration.** The placeholder the
decision governs must still be replaced through a maker-checker configuration change, by
two different people. That separation is deliberate: a decision and its implementation
are different acts and should leave different records.

## Summary

| Ref | Decision | Recommendation | Reversibility | Blocks |
|---|---|---|---|---|
| `FD-001` | What legal entity particulars may the product display? | Display only the registered name until incorporation documents are attached to this repository. | easily reversible | Regulator view, transaction receipts, PDF report footers. |
| `FD-002` | Which corridor and currency pair does the pilot run? | One corridor. Nigeria as origin, with the destination chosen by which licensed settlement partner is contractually available — not by which market is largest. | costly to reverse | Corridor configuration, FX pair, limits, every compliance evaluation. |
| `FD-003` | What transaction and pilot limits apply? | Adopt the filing's limits verbatim, and never set an internal limit above them. Below is a commercial choice; above is a breach. | easily reversible | The limit and velocity rules; the pilot report's breach measures. |
| `FD-004` | What is the settlement mechanism and who are the partners? | Correspondent-bank settlement through a licensed partner, with EKORails orchestrating only. This keeps EKORails outside every licensed activity for the pilot. | effectively irreversible | Partner adapters, custody posture, the ledger's partner account structure. |
| `FD-005` | Which AML/CFT thresholds and lists apply? | Adopt the thresholds and lists the filing cites. Until then the rule exists, is visible, and reports honestly that it cannot fire. | easily reversible | HIGH_RISK_JURISDICTION rule parameters; reporting thresholds. |
| `FD-006` | What regulatory returns must be filed, in what form, and how often? | Build to the filing's returns. Do not invent form identifiers. | easily reversible | Report headers and the regulatory export route. |
| `FD-007` | How long does the pilot run and what counts as success? | Adopt the filing's duration and targets verbatim for external reporting. Keep any internal stretch targets internal. | easily reversible | Pilot report targets and the readiness assessment. |
| `FD-008` | Where is the system deployed, and what data residency is claimed? | Complete a data residency and cross-border transfer assessment first. Choose the region from that assessment, and describe residency only in terms of where data actually sits. | costly to reverse | Infrastructure deployment, the privacy impact assessment, customer contracts. |
| `FD-009` | What may be said publicly about sandbox status? | Say nothing about sandbox status until an admission letter exists. | easily reversible | All external-facing copy, the pitch deck, the website. |
| `FD-010` | Framework choice: minimal dependencies versus a conventional stack | Keep the minimal stack through the pilot, then reassess. The security and supply-chain argument is strongest exactly when the system is under regulatory scrutiny and the team is small. | costly to reverse | Nothing. Recorded because a technical due-diligence reviewer will ask why. |

## Detail

### FD-001 — What legal entity particulars may the product display?

**Status:** awaiting approval

**The issue**

Receipts, the regulator view and customer-facing documents normally carry the registered name, company number, jurisdiction of incorporation and registered office. No incorporation document was supplied to this build.

**Options considered**

| Option | What follows from it |
|---|---|
| Display only the registered name until documents are attached | Some documents look incomplete; nothing false is stated. |
| Display particulars the founder provides verbally | Fast, but an unverified company number on a regulatory document is a serious problem. |
| Omit entity details entirely | Receipts become less useful to customers and to their auditors. |

**Recommended:** Display only the registered name until incorporation documents are attached to this repository.

**Main risk:** An incorrect company number or jurisdiction on a document that reaches a regulator or a bank is difficult to explain and undermines everything else in the file.

| | |
|---|---|
| Regulatory impact | Low if handled as recommended. High if particulars are invented. |
| Cost impact | None. |
| Reversibility | easily reversible |
| Blocks | Regulator view, transaction receipts, PDF report footers. |

### FD-002 — Which corridor and currency pair does the pilot run?

**Status:** awaiting approval

**The issue**

The controlling source for the corridor is the CBN Regulatory Sandbox application, which was not available. The corridor is seeded with INSERT_APPROVED_* placeholders and the demonstration data is denominated in NGN and USD purely so the engine can be exercised.

**Options considered**

| Option | What follows from it |
|---|---|
| Choose the destination by settled partner availability | Slower to announce, but the corridor is real on day one. |
| Choose the destination by market size | Attractive commercially, but a corridor with no partner is not a corridor. |
| Run two corridors from the start | Doubles the compliance, partner and reconciliation surface during a pilot. |

**Recommended:** One corridor. Nigeria as origin, with the destination chosen by which licensed settlement partner is contractually available — not by which market is largest.

**Main risk:** Announcing a corridor before a partner is contracted. Partner availability, not demand, is the binding constraint in cross-border settlement.

| | |
|---|---|
| Regulatory impact | HIGH. The corridor defines the scope of the sandbox permission. Operating outside it is operating without permission. |
| Cost impact | Each additional corridor multiplies partner, compliance and reconciliation work. |
| Reversibility | costly to reverse |
| Blocks | Corridor configuration, FX pair, limits, every compliance evaluation. |

### FD-003 — What transaction and pilot limits apply?

**Status:** awaiting approval

**The issue**

Per-transaction, daily, monthly and pilot-aggregate limits, plus the participant cap, come from the filing. Provisional demonstration limits are configured and marked as such.

**Options considered**

| Option | What follows from it |
|---|---|
| Adopt the filing's limits verbatim | No divergence between what was approved and what the system enforces. |
| Set internal limits below the filing's | More conservative; a customer hitting the internal limit may not understand why. |
| Set internal limits above the filing's | Unacceptable — a breach of the sandbox conditions. |

**Recommended:** Adopt the filing's limits verbatim, and never set an internal limit above them. Below is a commercial choice; above is a breach.

**Main risk:** A limit breach is a reportable event, not an internal exception. Until the filing supplies the limits, the LIMIT_NOT_CONFIGURED rule holds every transaction for manual review, which is the intended behaviour rather than a defect.

| | |
|---|---|
| Regulatory impact | HIGH. Exceeding an agreed cap is the clearest possible breach of pilot conditions. |
| Cost impact | Lower limits reduce revenue per customer during the pilot. |
| Reversibility | easily reversible |
| Blocks | The limit and velocity rules; the pilot report's breach measures. |

### FD-004 — What is the settlement mechanism and who are the partners?

**Status:** awaiting approval

**The issue**

Everything in this build settles through simulators. The real mechanism — correspondent banking, a licensed PSP, or something else — is not asserted anywhere.

**Options considered**

| Option | What follows from it |
|---|---|
| Correspondent-bank settlement through a licensed partner | Well understood by regulators and banks; slower and more expensive. |
| A licensed payment institution as settlement agent | Potentially faster; the partner's own permissions become a dependency. |
| Apply for EKORails' own licence | Removes the dependency; adds years and substantial capital. |

**Recommended:** Correspondent-bank settlement through a licensed partner, with EKORails orchestrating only. This keeps EKORails outside every licensed activity for the pilot.

**Main risk:** Partner concentration. A single settlement partner is a single point of failure for the entire product, and correspondent relationships are withdrawn with little notice.

| | |
|---|---|
| Regulatory impact | HIGH. This determines whether EKORails is performing a licensed activity. Get it wrong and the question becomes an enforcement one. |
| Cost impact | Correspondent settlement carries higher per-transaction cost and requires pre-funding. |
| Reversibility | effectively irreversible |
| Blocks | Partner adapters, custody posture, the ledger's partner account structure. |

### FD-005 — Which AML/CFT thresholds and lists apply?

**Status:** awaiting approval

**The issue**

Rules implement generally accepted controls, but Nigerian reporting thresholds and the applicable high-risk jurisdiction list are unconfirmed. The jurisdiction list ships EMPTY rather than invented.

**Options considered**

| Option | What follows from it |
|---|---|
| Adopt the CBN AML/CFT Regulations thresholds once the filing cites them | Correct, but the rule cannot fire until then. |
| Use an international default list | Plausible but wrong — it would assert a regulatory fact nobody has given us. |
| Set no jurisdiction rule at all | Removes a control rather than deferring it. |

**Recommended:** Adopt the thresholds and lists the filing cites. Until then the rule exists, is visible, and reports honestly that it cannot fire.

**Main risk:** An out-of-date list produces false NEGATIVES, which are invisible. The list must be a versioned rule parameter with a stated review cadence, not a code constant.

| | |
|---|---|
| Regulatory impact | HIGH. Screening against the wrong list is close to not screening. |
| Cost impact | A maintained list service is a recurring subscription. |
| Reversibility | easily reversible |
| Blocks | HIGH_RISK_JURISDICTION rule parameters; reporting thresholds. |

### FD-006 — What regulatory returns must be filed, in what form, and how often?

**Status:** awaiting approval

**The issue**

The report shapes are built and exportable in CSV, XLSX and PDF. No statutory form identifier is asserted, because inventing one would be inventing a regulatory fact.

**Options considered**

| Option | What follows from it |
|---|---|
| Build to the filing's specified returns once supplied | Correct; a short mapping exercise per return. |
| Guess the likely forms now | A plausible-looking form identifier on a submitted return is worse than none. |

**Recommended:** Build to the filing's returns. Do not invent form identifiers.

**Main risk:** A missed return is a supervisory failure in its own right, regardless of the underlying data.

| | |
|---|---|
| Regulatory impact | MEDIUM to HIGH depending on the cadence required. |
| Cost impact | Low — the data already exists; only the presentation layer changes. |
| Reversibility | easily reversible |
| Blocks | Report headers and the regulatory export route. |

### FD-007 — How long does the pilot run and what counts as success?

**Status:** awaiting approval

**The issue**

The pilot report computes participants, volumes, completion rate, cost, processing time, exceptions, complaints and incidents. No target thresholds are asserted.

**Options considered**

| Option | What follows from it |
|---|---|
| Adopt the filing's duration and targets verbatim | What you are measured against is what you agreed. |
| Set internal stretch targets above the filing's | Motivating internally; risks appearing to have failed against your own numbers. |

**Recommended:** Adopt the filing's duration and targets verbatim for external reporting. Keep any internal stretch targets internal.

**Main risk:** Reporting against targets you invented, and appearing to miss them, damages credibility more than the underlying performance would.

| | |
|---|---|
| Regulatory impact | MEDIUM. Success measures determine whether the pilot progresses. |
| Cost impact | A longer pilot costs more to run but produces more evidence. |
| Reversibility | easily reversible |
| Blocks | Pilot report targets and the readiness assessment. |

### FD-008 — Where is the system deployed, and what data residency is claimed?

**Status:** awaiting approval

**The issue**

The deployment region is a placeholder. The system makes NO residency claim. In particular it does not claim African residency on the basis of African ownership.

**Options considered**

| Option | What follows from it |
|---|---|
| Complete a residency assessment, then choose a region | Slower; defensible. |
| Choose an African region and market it as African residency | Marketable, but a claim you cannot support if backups or support access sit elsewhere. |
| Choose the cheapest region | May place data outside what the regulator or customers will accept. |

**Recommended:** Complete a data residency and cross-border transfer assessment first. Choose the region from that assessment, and describe residency only in terms of where data actually sits.

**Main risk:** Residency is about where data physically is and whose law reaches it — including backups, logs and support access. A claim that ignores any of those is false.

| | |
|---|---|
| Regulatory impact | HIGH. Data localisation requirements vary and are enforced. |
| Cost impact | Regional pricing varies; some regions lack managed services. |
| Reversibility | costly to reverse |
| Blocks | Infrastructure deployment, the privacy impact assessment, customer contracts. |

### FD-009 — What may be said publicly about sandbox status?

**Status:** awaiting approval

**The issue**

Admission has not been confirmed to this build. The configuration defaults to not_confirmed and nothing in the product implies otherwise.

**Options considered**

| Option | What follows from it |
|---|---|
| Say nothing until an admission letter exists | Less impressive in a pitch; entirely safe. |
| Say "engaged with the CBN sandbox process" | Ambiguous, and ambiguity is read generously by listeners and harshly by regulators. |
| Assert admission to the sandbox in external copy | Unacceptable unless and until an admission letter exists. |

**Recommended:** Say nothing about sandbox status until an admission letter exists.

**Main risk:** Overstating regulatory status is one of the fastest ways to lose both a regulator's and a bank partner's confidence, and it is very hard to recover.

| | |
|---|---|
| Regulatory impact | HIGH. Misrepresenting regulatory status is itself a serious matter. |
| Cost impact | None. |
| Reversibility | easily reversible |
| Blocks | All external-facing copy, the pitch deck, the website. |

### FD-010 — Framework choice: minimal dependencies versus a conventional stack

**Status:** awaiting approval

**The issue**

The brief recommends Next.js and NestJS. This build uses TypeScript on Node with one runtime dependency (the PostgreSQL driver), a hand-written router, and a no-build web client. Spreadsheet, PDF and cryptographic functions are implemented directly.

**Options considered**

| Option | What follows from it |
|---|---|
| Keep the minimal stack | Very small attack surface and no dependency advisories to triage; less familiar to new hires; more code owned in-house. |
| Migrate to Next.js and NestJS | Conventional and hireable; adds roughly a thousand transitive dependencies to a system that moves money. |
| Hybrid: NestJS API, minimal front end | Splits the difference and the drawbacks. |

**Recommended:** Keep the minimal stack through the pilot, then reassess. The security and supply-chain argument is strongest exactly when the system is under regulatory scrutiny and the team is small.

**Main risk:** Hiring and onboarding are harder, and hand-written infrastructure carries bugs a mature framework would not. This is a genuine trade, not a free win.

| | |
|---|---|
| Regulatory impact | LOW directly, but dependency scanning findings are a standard security-review question. |
| Cost impact | Lower running cost; higher cost to onboard an engineer unfamiliar with the codebase. |
| Reversibility | costly to reverse |
| Blocks | Nothing. Recorded because a technical due-diligence reviewer will ask why. |
