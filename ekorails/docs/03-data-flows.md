# 03 — Data flows

Five flows, each traced from the act that starts it to the record it leaves behind. For each: what
moves, who touches it, what is written, and where it can go wrong.

---

## Flow 1 — Onboarding a business

```mermaid
sequenceDiagram
  autonumber
  participant B as Business Initiator
  participant API
  participant DB as PostgreSQL
  participant S as Screening provider (SIMULATED)
  participant CA as Compliance Analyst

  B->>API: Create profile, add beneficial owners
  API->>DB: organization, organization_person (encrypted fields)
  B->>API: Upload documents
  API->>DB: document metadata + AES-256-GCM ciphertext
  B->>API: Submit for review
  API->>S: Screen the company and each owner
  S-->>API: Matches (or none), with scores and list references
  API->>DB: screening_case, screening_result
  API->>DB: Run 26 rules → risk_assessment, rule_evaluation (all of them)
  API->>DB: Open compliance_case with an engine-authored opening note
  CA->>API: Dispose of each match, with a written reason
  CA->>API: Decide: approve, reject, request information, escalate
  API->>DB: compliance_decision (permanent), organization.onboarding_status
```

**What is written that cannot later be changed:** every rule evaluation including the ones that did
not fire, every screening result, every disposition and its reason, every decision and its reason,
and an audit event for each.

**Personal data in this flow:** names, dates of birth, nationalities, identification numbers and
addresses of beneficial owners. Identification numbers and addresses are encrypted at field level
with AES-256-GCM under a key derived through HKDF. They are masked for every role except where an
explicit unmasking permission is held, and unmasking is audited.

**Where it goes wrong:** a name collides with a sanctioned person. That is the ordinary case, not
the exception. The system never resolves it automatically — a person compares dates of birth,
nationalities and identifiers and records what distinguished them.

---

## Flow 2 — A payment, end to end

```mermaid
sequenceDiagram
  autonumber
  participant I as Initiator
  participant A as Approver
  participant CA as Compliance
  participant T as Treasury
  participant P as Partner (SIMULATED)
  participant L as Ledger

  I->>API: Create payment (beneficiary, amount, purpose, source of funds)
  Note over API: draft
  I->>API: Submit for authorisation
  Note over API: pending_business_approval
  A->>API: Authorise (re-authentication required)
  Note over API: The initiator cannot be the approver. The state machine refuses it
  API->>API: Run the compliance engine
  Note over API: pending_compliance — every transaction, because the corridor is a placeholder
  CA->>API: Decide, with a written reason
  Note over API: compliance_approved
  T->>API: Issue an indicative quote (rate, spread, fees, expiry)
  Note over API: quote_issued
  A->>API: Accept the quote
  API->>L: RECOGNISE THE OBLIGATION (first ledger entry)
  Note over API: quote_accepted → awaiting_funding
  P-->>API: Funding received at the partner
  API->>L: Funding receipt — debits the PARTNER account, not an EKORails one
  Note over API: funding_confirmed
  T->>API: Prepare settlement
  API->>L: FX conversion — two legs through FX_CLEARING
  API->>L: Partner positioning — clears FX_CLEARING to zero
  Note over API: ready_for_settlement
  T->>API: Submit to the partner (idempotency key)
  P-->>API: Settled
  API->>L: Settlement payment — discharges the obligation
  Note over API: settled → beneficiary_confirmed → reconciled → completed
```

**Ledger entries, in order:** obligation recognition, funding receipt, FX conversion (two legs),
partner positioning, settlement payment, fee payment. Every one balances within each currency; the
database refuses it otherwise.

**Where the money is at each point.** This is the question that decides whether EKORails is
performing a licensed activity, so it is worth stating flatly:

| State | Where the customer's money is |
|---|---|
| Before funding | With the customer |
| `awaiting_funding` | With the customer. EKORails has recorded an obligation, not received value |
| `funding_confirmed` | With the **licensed partner institution** |
| `ready_for_settlement` | With the partner, converted |
| `settled` | With the beneficiary's bank |

At no point is it with EKORails. There is no account in the chart of accounts that could record it
being with EKORails, which is a stronger statement than a policy.

---

## Flow 3 — A document

```mermaid
flowchart LR
  U["Upload"] --> C["Structural checks<br/>type, size, magic bytes"]
  C --> E["AES-256-GCM<br/>field and blob encryption"]
  E --> M["document row<br/>metadata, hash, expiry"]
  M --> X["AI extraction<br/>status: proposed"]
  X --> H["Human confirmation<br/>recorded with the confirming user"]
  H --> T["Usable by a transaction"]
  X -.->|never| CE["Compliance engine"]
```

The dotted line is the point of the diagram. Extraction output is written to a separate table with
status `proposed`. The compliance engine never reads it. It cannot reach a transaction without an
explicit confirmation event carrying the confirming user's identity.

The word "verified" is not used about extraction anywhere in this system, and the claims lint fails
the build on `AI verif|validat|confirm|check` unless the surrounding text says it is advisory.

**What the structural checks are not:** they are not antivirus. No scanning service is connected.
That is stated on the upload screen, in the risk register as `R-12`, and here.

---

## Flow 4 — Reconciliation

```mermaid
flowchart TB
  R["Daily run"] --> A["Transactions vs ledger"]
  R --> B["Funding vs settlement"]
  R --> C["Fees"]
  R --> D["Currency position"]
  R --> E["Ledger vs each partner statement"]
  A & B & C & D & E --> M{"Agree?"}
  M -->|yes| OK["reconciliation_item: matched"]
  M -->|no| BR["exception_case opened<br/>with an owner and a service target"]
  BR --> INV["A person investigates and proposes a resolution"]
  INV --> AP["Above the four-eyes threshold,<br/>a DIFFERENT person approves the closure"]
```

Five comparisons run daily, plus one per settlement partner. A difference never resolves itself and
is never resolved by overwriting one side. Both records stay as they are; what closes the break is
the explanation.

The result types and what each means:

| Result | Means |
|---|---|
| `matched` | Both sides agree on reference and amount |
| `amount_difference` | Both have the record, amounts differ. Somebody says which is right and why |
| `missing_partner_record` | We have it, they do not. Either it never arrived or their file is late |
| `missing_internal_record` | They have it, we do not. **The more serious direction** — money may have moved without us knowing |
| `duplicate` | The same item twice on one side. A payment risk until proven otherwise |

---

## Flow 5 — Audit

```mermaid
flowchart LR
  ACT["Any action:<br/>succeeded, refused or failed"] --> AE["audit_event"]
  AE --> H["entry_hash = SHA-256 over the record<br/>prev_hash = predecessor's entry_hash"]
  H --> CH["A chain, verifiable in SQL"]
  CH --> V["verify_audit_chain()<br/>recomputes both hashes in the database"]
  CH --> X["Export with a manifest<br/>proving contiguity and integrity"]
```

Every entry carries the hash of its predecessor and a hash over its own contents. Verification is a
SQL function: it recomputes both inside the database and does not depend on the application being
honest about anything.

The application's database role holds no `UPDATE` or `DELETE` grant on the table, and an
append-only trigger raises even for the table owner. There is a deliberately permissive RLS policy
for `UPDATE` and `DELETE` so that an attempt reaches the trigger and fails **loudly**, rather than
being silently filtered to zero rows — a silent no-op looks like success to whoever tried.

**Refusals are recorded exactly as carefully as successes.** A separation-of-duties refusal, a
denied permission, a failed sign-in and a rejected step-up all leave a record. An audit trail
containing only successes tells you nothing about what somebody tried to do.

---

## Cross-cutting: what never enters a log

Enforced by a redaction layer over structured logging, and asserted by an automated test that
exercises the real logging path and searches its output.

Never logged, in any form:

- passwords, or anything derived from one
- authentication tokens, session tokens or CSRF tokens
- complete identification numbers
- full bank-account credentials
- private cryptographic keys or the material they are derived from
- unmasked sensitive documents or their contents

What is logged instead: a hashed network address, a hashed user agent, a request id, a correlation
id, the route, the outcome and the duration. Enough to investigate; not enough to impersonate.
