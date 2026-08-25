# Annex — Technical and control description

**Applicant:** EKORAILS LIMITED (RC 9490673), previously ECO INFRASTRUCTURE LIMITED
**Incorporated:** 15 April 2026, Federal Republic of Nigeria, under the Companies and Allied
Matters Act 2020. Name changed by special resolution 16 August 2026.
**Tax Identification Number:** 2623794513058
**Prepared:** 24 August 2026
**Status of the applicant:** **Not an admitted participant.** This is an application.

---

## 1. What is being applied for, and what already exists

EKORails has built and tested a compliance-first orchestration layer for business-to-business
cross-border trade settlement. The system is complete enough to be examined today: it runs, it
carries 185 automated tests against a real database, and every screen has been exercised by every
role in a browser.

What it does **not** have is a corridor, a partner or an approval — which is what this application
is for. The build was deliberately constructed so that those three gaps are visible in the software
rather than papered over, and §6 explains how.

## 2. What EKORails is, and what it is not

| | |
|---|---|
| **Is** | Software that coordinates a sequence of steps performed by licensed institutions: customer due diligence, screening, approval, quotation, instruction and reconciliation |
| **Is not** | A bank; a deposit-taking institution; a licensed payment provider; a custodian of customer funds; a cryptocurrency exchange; a consumer investment platform |
| **Has not been** | Admitted to the CBN Regulatory Sandbox. This is an application; no admission is claimed or implied anywhere in the software |

**These are not undertakings. They are properties of the build, and each is verifiable.** The
strongest example: EKORails cannot record holding a customer's money, because there is no account
in the chart of accounts that could hold it — not disabled, absent. The relevant categories are
`customer_funding_receivable` (what a customer owes), `customer_settlement_payable` (what we have
undertaken to deliver) and `partner_funding_account` (what the **partner institution** holds).

## 3. Division of regulated activity

| Activity | Performed by | Requires a licence |
|---|---|---|
| Customer onboarding and KYB decisioning | EKORails | No |
| Sanctions, PEP and adverse-media screening | Screening provider | No |
| **Holding customer funds** | **Licensed partner institution** | **Yes** |
| **Foreign exchange execution** | **Licensed liquidity provider** | **Yes** |
| **Payment execution and settlement** | **Licensed settlement institution** | **Yes** |
| **Crediting the beneficiary** | **Destination bank** | **Yes** |
| Orchestration, ledger, reconciliation, reporting | EKORails | No |

Everything in bold is performed under somebody else's licence. Funding is recorded in the ledger as
arriving at the partner, never at EKORails, at the point the customer funds a payment.

## 4. Architecture

Three layers, with the guarantees deliberately placed below the application so that a defect in
application code cannot breach them.

| Layer | What it is |
|---|---|
| Interface | Six role-scoped consoles under a strict Content-Security-Policy. No third-party JavaScript reaches a user's browser |
| Service | Node.js. One runtime dependency. Authentication, authorisation, the compliance engine, the double-entry ledger, the settlement state machine, reconciliation, reporting |
| Data | PostgreSQL 16. Row-level security with FORCE, deferred balance constraints, append-only triggers, a hash-chained audit trail |

Three database roles, and the application connects as the least privileged of them: not a
superuser, no BYPASSRLS, and **no UPDATE or DELETE grant** on the audit, ledger, compliance-decision
or transition tables. A provisioning script asserts that posture and refuses to proceed if it is
not so.

## 5. Controls, and how each is enforced

The distinction that matters throughout is between a control that is *written down* and one that is
*enforced by a mechanism*. These are the second kind.

| Control | Mechanism |
|---|---|
| Customer segregation | Row-level security with FORCE on every table carrying customer data, driven by a transaction-local security context. A query that omits its organisation filter still returns nothing extra |
| Dual authorisation | The initiator of a payment cannot authorise it. Refused at the state machine, again in the service, and again by the database |
| Compliance cannot be bypassed | No transition edge in the state machine reaches settlement without a recorded compliance decision |
| Decision reproducibility | Each evaluation stores the rule text, the parameter values in force, the data read, an input hash and a ruleset hash. It is not read back from current configuration, so a later rule change cannot alter what a past decision appears to have rested on |
| Rules that did not fire are recorded | "Checked and found nothing" is evidence; "never run" is a gap. Storing only triggered rules would make them indistinguishable |
| Ledger integrity | A deferred constraint trigger sums every journal by currency at commit and refuses an imbalance. Balances are never stored — always derived |
| Corrections | By reversal only. Both the error and the correction remain visible. No UPDATE grant exists |
| Audit integrity | Each entry hashes its predecessor and its own contents; verification is a SQL function, so it does not depend on the application being truthful |
| Refusals are recorded | A denied permission, a separation-of-duties refusal and a failed sign-in each leave a record. A trail of successes alone says nothing about what was attempted |
| Personal data | AES-256-GCM field encryption; masking applied server-side by role; unmasking is a distinct permission and is audited |
| Automated decisions | Rules recommend; a named person decides with a written reason. AI extraction proposes into a separate table the compliance engine never reads, and a person must confirm each value |

## 6. Why nothing in this build clears compliance automatically

The corridor, the limits, the settlement mechanism and the reporting obligations are facts this
application seeks to establish. They were therefore not available while the system was built.

Rather than assume them, they are held as explicit placeholders, and a rule —
`CORRIDOR_PLACEHOLDER_UNCONFIRMED` — fires on **every** transaction. The consequence is that no
transaction in this build can clear compliance without a person looking at it.

This is intended behaviour, and it is offered as evidence of the applicant's posture rather than
apologised for. A system that invented a corridor in order to demonstrate a smooth flow would be
demonstrating something other than what it would do in supervision.

## 7. What is simulated, and what that means

Every partner is a simulator. No agreement with any institution has been executed, so no partner
name in the system asserts a commercial relationship. Simulated results are labelled as such on
every screen that displays them.

The simulators implement eleven failure modes, each because it is a thing that happens to payments:
timeout with no response, partner-side compliance refusal, insufficient liquidity, invalid
beneficiary, duplicate instruction, failed settlement, partial settlement, return after settlement,
delayed funding, statement mismatch, and success.

Any of them can be produced on demand, which is how the system's behaviour under failure is
demonstrated rather than described. The one worth watching is the timeout: the payment moves to
`under_investigation` and **automatic retry is disabled**, because retrying an instruction whose
outcome is unknown is how a payment gets made twice.

## 8. Live funds

Live money movement is not reachable. It requires nine release gates, each demanding named
evidence, and **none is settable from any interface** — they are process-level configuration read
once at start-up. In production mode the service refuses to start with any gate unmet, and in this
build the function that would permit live money throws unconditionally regardless of configuration.

None of the nine is currently met.

| Gate | Evidence required |
|---|---|
| Regulatory approval | A written approval or admission letter |
| Licence verified | Verification of the licence under which each activity is performed |
| Partner contracts | Executed agreements with each partner in the flow |
| Security review | An independent review, findings closed |
| Privacy review | A completed privacy impact and cross-border transfer assessment |
| Operational controls | Documented and rehearsed procedures |
| Disaster recovery tested | An evidenced restoration test |
| Reconciliation sign-off | Reconciliation signed off over a sustained period |
| Board approval | A recorded board decision |

## 9. Reporting to the supervisor

A read-only supervisory console shows pilot scope, participants, transaction activity, control
effectiveness, incidents and availability. It displays organisation codes rather than names and
contains no individual personal data.

Reports export in JSON, CSV, XLSX and PDF. Each export is recorded with a content hash, the
parameters used and the masking profile that produced it, so an export can be tied back to what was
requested and by whom.

**The statutory return forms and their cadence are not asserted.** No form identifier has been
invented; the fields carry a placeholder pending the Commission's specification.

## 10. What the applicant states is incomplete

Offered here rather than left to be discovered.

| | |
|---|---|
| No corridor confirmed | The subject of this application |
| No partner contracted | First discussions are under way; nothing is executed |
| No independent security review | The threat model is the builder's own assessment |
| No restoration test performed | The procedure exists; it has never been executed |
| No antivirus on document upload | Checks are structural and are described as such, not as scanning |
| No uptime measurement | Therefore no availability figure is claimed anywhere |
| Data residency unresolved | No region selected. **No claim of Nigerian or African data residency is made**, because residency follows a deployment region and an assessment, not the ownership of the company |
| Retention periods unresolved | Pending the applicable schedule |
| One person | Separation of duties is enforced in the software and is not yet reflected in the organisation |

## 11. What the Commission can verify directly

Every claim in §5 has a screen or a query behind it. A supervisory session of roughly 45 minutes
covers: the boundary statement and release gates; the chart of accounts showing no customer
stored-value account; a payment authored and refused for self-approval in the room; a compliance
case showing every rule evaluated including those that did not fire; a partner timeout produced
deliberately; the trial balance; a refusal in the audit trail; and the honest build status of each
module.

The full script, with what would disprove each claim, is at `docs/23-regulator-demonstration-guide.md`.
