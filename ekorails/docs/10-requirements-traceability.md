<!--
  GENERATED FILE — do not edit.

  Produced by scripts/generate-docs.mjs from the definitions the software actually
  uses. If this document is wrong, the code is wrong: change the code and regenerate.
  `node scripts/generate-docs.mjs --check` fails the build when the two disagree.
-->

# 10 — Requirements traceability

25 requirements. 24 carry at least one automated test.
112 named tests across 173 in the suites.

## Why this document checks itself

The failure mode of every traceability matrix is a row asserting coverage by a test that
was renamed away two quarters ago. So each test named below is matched against the actual
`test(...)` names in the suites when this document is generated, and a name that does not
resolve **fails the build**.

It does not prove the tests are good. It proves they exist and are named here honestly.

## Requirements with a gap (2)

Listed first, because a matrix whose gaps are at the bottom is a matrix nobody reads to
the bottom of.

- **REQ-23** — A backup restores with its history, its ledger balance and its audit chain intact.
  - The test proves the mechanism. NO RESTORATION OF A REAL DEPLOYMENT HAS EVER BEEN PERFORMED. See R-14 and EKORAILS_GATE_DR_TESTED.
- **REQ-25** — No claim is made that EKORails is not entitled to make.
  - Verified by scripts/lint-claims.mjs in the build rather than by a test in the suites. The lint covers this repository only; it cannot police a slide deck, a website or a conversation. See R-15.

## Matrix

| Ref | Area | Requirement | Tests |
|---|---|---|---|
| `REQ-01` | Regulatory boundary | This deployment moves no real money, and live functionality cannot be activated through any interface. | 5 |
| `REQ-02` | Regulatory boundary | The environment banner appears on every screen and every response, and cannot be suppressed. | 2 |
| `REQ-03` | Regulatory boundary | EKORails is never presented as a bank, a custodian of customer funds, or an admitted sandbox participant. | 3 |
| `REQ-04` | Money | Monetary amounts are stored using fixed-precision decimal types. Floating point is never used for money. | 6 |
| `REQ-05` | Ledger | Every journal balances within each currency, and an unbalanced journal cannot exist. | 5 |
| `REQ-06` | Ledger | Ledger entries cannot be edited or deleted. Corrections are made by reversal. | 6 |
| `REQ-07` | Audit | The audit trail is append-only and tamper-evident, and refusals are recorded as carefully as successes. | 7 |
| `REQ-08` | Access control | One organisation cannot read another organisation's data. | 4 |
| `REQ-09` | Access control | The nine specified roles exist, each with its stated permissions and its explicit denials. | 8 |
| `REQ-10` | Access control | The person who initiates a transaction cannot authorise it. | 4 |
| `REQ-11` | Authentication | Multi-factor authentication, with re-authentication before value-moving actions. | 7 |
| `REQ-12` | Web security | CSRF protection, strict security headers, and rate limiting. | 7 |
| `REQ-13` | Logging | Passwords, tokens, complete identification numbers, bank credentials, private keys and unmasked documents are never logged. | 3 |
| `REQ-14` | Compliance | Every applicable rule is evaluated and recorded, whether or not it fires, and a decision can be reconstructed later. | 7 |
| `REQ-15` | Compliance | A transaction cannot bypass compliance review, and prohibited outcomes block rather than warn. | 8 |
| `REQ-16` | AI | AI extraction proposes; it never confirms. A human must confirm extracted information. | 4 |
| `REQ-17` | Settlement | An unknown partner outcome does not retry automatically, and the same instruction cannot cause a second payment. | 4 |
| `REQ-18` | Settlement | Settlement finality is never claimed, and a return does not erase the settlement it follows. | 3 |
| `REQ-19` | Reconciliation | Differences open a break with an owner, and closure above the threshold requires a second person. | 2 |
| `REQ-20` | FX | A rate is indicative until accepted, never described as locked without a contractual lock, and an expired quote is refused. | 3 |
| `REQ-21` | Reporting | Reports export in multiple formats, safely, with each export recorded. | 7 |
| `REQ-22` | Privacy | Personal data is encrypted at field level and masked by default, and oversight views expose no personal names. | 5 |
| `REQ-23` | Continuity | A backup restores with its history, its ledger balance and its audit chain intact. | 1 |
| `REQ-24` | Honesty | No feature is reported as complete because its interface exists, and unfinished work is not concealed. | 1 |
| `REQ-25` | Honesty | No claim is made that EKORails is not entitled to make. | **none** |

## Detail

### REQ-01 — This deployment moves no real money, and live functionality cannot be activated through any interface.

**Area:** Regulatory boundary

**Source:** Brief — "The MVP must default to simulated settlement. Live-mode functionality must remain disabled behind a configuration flag and must not be activatable through the user interface."

**Enforced by:** Nine release gates read from process configuration at start-up; assertLiveMoneyPermitted() throws unconditionally in this build.

**Verified by 5 test(s):**

- `assertLiveMoneyPermitted throws in this build`
- `the environment mode cannot be changed through the API`
- `every single gate must be met; eight of nine is still a refusal`
- `PRODUCTION with unmet gates REFUSES to start`
- `there are nine release gates, each with stated evidence`

### REQ-02 — The environment banner appears on every screen and every response, and cannot be suppressed.

**Area:** Regulatory boundary

**Source:** Brief — persistent banner "SANDBOX ENVIRONMENT. NO LIVE FUNDS."

**Enforced by:** First element in the document; a response header on every request; the client blocks the page if the rendered banner disagrees with the server.

**Verified by 2 test(s):**

- `the environment banner is on every response, including errors`
- `the response envelope always carries the banner and simulation flag`

### REQ-03 — EKORails is never presented as a bank, a custodian of customer funds, or an admitted sandbox participant.

**Area:** Regulatory boundary

**Source:** Brief — regulatory boundary list.

**Enforced by:** No customer stored-value account exists in the chart of accounts; a public boundary statement; a claims lint over every user-facing string.

**Verified by 3 test(s):**

- `the chart of accounts contains no customer stored-value account`
- `the regulatory boundary is served publicly and states what EKORails is not`
- `a business user has no ledger read permission and sees only their own accounts`

### REQ-04 — Monetary amounts are stored using fixed-precision decimal types. Floating point is never used for money.

**Area:** Money

**Source:** Brief — "Store monetary amounts using fixed-precision decimal types. Never use floating-point storage for money."

**Enforced by:** NUMERIC(24,6) columns; a BigInt-backed Decimal that refuses construction from a fractional JavaScript number; amounts travel to the browser as strings.

**Verified by 6 test(s):**

- `fractional JS numbers cannot be used to construct money`
- `constructing from a value with too many decimals is REFUSED, not truncated`
- `the classic float failure does not occur`
- `very large amounts do not lose precision`
- `addition and subtraction are exact at scale`
- `the canonical string form round-trips exactly`

### REQ-05 — Every journal balances within each currency, and an unbalanced journal cannot exist.

**Area:** Ledger

**Source:** Brief — double-entry ledger.

**Enforced by:** A deferred CONSTRAINT TRIGGER that sums by currency at commit and raises otherwise.

**Verified by 5 test(s):**

- `an unbalanced journal is refused at commit by the database`
- `a cross-currency journal must balance within EACH currency`
- `a single-line journal is refused`
- `the trial balance nets to zero in every currency`
- `the application layer refuses an imbalance before it reaches the database`

### REQ-06 — Ledger entries cannot be edited or deleted. Corrections are made by reversal.

**Area:** Ledger

**Source:** Brief — audit-log protection; accounting integrity.

**Enforced by:** No UPDATE/DELETE grant for the application role; append-only triggers that raise even for the table owner.

**Verified by 6 test(s):**

- `the application role cannot UPDATE a journal entry`
- `the application role cannot DELETE a journal entry`
- `even the schema owner cannot UPDATE a journal entry`
- `even the schema owner cannot DELETE a journal entry`
- `a partner rejection unwinds the positioning by reversal, not deletion`
- `a return is a new event; the original settlement journal stands`

### REQ-07 — The audit trail is append-only and tamper-evident, and refusals are recorded as carefully as successes.

**Area:** Audit

**Source:** Brief — audit-log protection.

**Enforced by:** Hash-chained entries verified by a SQL function; append-only triggers; withheld grants; deliberately permissive RLS on UPDATE/DELETE so an attempt raises loudly rather than matching zero rows.

**Verified by 7 test(s):**

- `the audit hash chain verifies and detects tampering`
- `the application role has no UPDATE privilege on the audit trail`
- `the application role has no DELETE privilege on the audit trail`
- `even the schema owner is refused by the append-only trigger on UPDATE`
- `even the schema owner is refused by the append-only trigger on DELETE`
- `the audit record is genuinely unchanged after the attempts`
- `every login attempt, successful or not, is recorded`

### REQ-08 — One organisation cannot read another organisation's data.

**Area:** Access control

**Source:** Brief — least privilege; role "cannot" statements.

**Enforced by:** Row-level security with FORCE on every table carrying customer data, driven by a transaction-local security context.

**Verified by 4 test(s):**

- `organisation A cannot see organisation B's transactions, at the database level`
- `the isolation holds across every organisation-scoped table`
- `a request with no security context sees nothing at all`
- `a cross-organisation quote acceptance returns not-found, not forbidden`

### REQ-09 — The nine specified roles exist, each with its stated permissions and its explicit denials.

**Area:** Access control

**Source:** Brief — nine user roles with can/cannot lists.

**Enforced by:** Roles declared as data, seeded into the database, denials stated explicitly rather than implied by absence.

**Verified by 8 test(s):**

- `all nine roles from the specification exist`
- `every role states what it explicitly cannot do`
- `every role permission exists in the permission catalogue`
- `a business initiator cannot approve, clear compliance or touch the ledger`
- `a treasury operator cannot clear a compliance alert`
- `an analyst cannot approve a high-risk KYB case`
- `the auditor role is read-only: it holds no write permission at all`
- `a System Administrator holds no permission that could reach a compliance decision`

### REQ-10 — The person who initiates a transaction cannot authorise it.

**Area:** Access control

**Source:** Brief — dual authorisation.

**Enforced by:** A separation rule evaluated against the transaction's initiator, refused by the state machine and again by the database.

**Verified by 4 test(s):**

- `the state machine refuses the approve edge for the initiator`
- `the service layer refuses a self-approval and audits the attempt`
- `the database refuses a self-approval even if the service layer is bypassed`
- `separation-of-duties rules fire on the involved user`

### REQ-11 — Multi-factor authentication, with re-authentication before value-moving actions.

**Area:** Authentication

**Source:** Brief — MFA; step-up for sensitive operations.

**Enforced by:** RFC 6238 TOTP with a step replay guard; step-up required by declared transitions; scrypt passwords; lockout.

**Verified by 7 test(s):**

- `TOTP generates and verifies, and refuses a replayed step`
- `TOTP tolerates one step of clock drift but not two`
- `the value-moving edges require step-up authentication`
- `failed logins lock the account after the threshold`
- `a wrong password and an unknown email give the same response`
- `password hashes verify and differ per salt`
- `the password policy weights length and rejects contextual words`

### REQ-12 — CSRF protection, strict security headers, and rate limiting.

**Area:** Web security

**Source:** Brief — OWASP ASVS / API Top 10; CSRF; CSP; rate limiting.

**Enforced by:** Double-submit CSRF token; CSP with a nonce and no inline script; per-identity rate limits.

**Verified by 7 test(s):**

- `a state-changing request without the CSRF header is refused`
- `a request with the WRONG CSRF token is refused`
- `a GET does not require a CSRF token`
- `security headers are strict`
- `the login endpoint is rate limited`
- `an oversized body is refused`
- `a malformed JSON body is rejected cleanly`

### REQ-13 — Passwords, tokens, complete identification numbers, bank credentials, private keys and unmasked documents are never logged.

**Area:** Logging

**Source:** Brief — "Never log: Passwords, Authentication tokens, Complete identification numbers, Full bank-account credentials, Private cryptographic keys, Unmasked sensitive documents."

**Enforced by:** A redaction layer over structured logging, asserted against real logging output.

**Verified by 3 test(s):**

- `the redaction layer removes credentials and masks identifiers`
- `no audit event in the database contains an unredacted secret`
- `no integration event payload contains an unmasked account identifier`

### REQ-14 — Every applicable rule is evaluated and recorded, whether or not it fires, and a decision can be reconstructed later.

**Area:** Compliance

**Source:** Brief — compliance rule library; reproducible decisions.

**Enforced by:** Self-contained evaluations storing the rule text, parameters, data used, an input hash and a ruleset hash.

**Verified by 7 test(s):**

- `every required check from the specification is present`
- `every rule states its subject scope`
- `every rule carries the plain-English fields the Learning Center renders`
- `rule keys and versions are unique`
- `the high-risk jurisdiction list is empty and says why`
- `no rule cites a regulation the filing has not supplied without saying so`
- `the case the engine opened carries its reasoning, authored by the engine and not by a person`

### REQ-15 — A transaction cannot bypass compliance review, and prohibited outcomes block rather than warn.

**Area:** Compliance

**Source:** Brief — compliance-first.

**Enforced by:** No transition edge skips compliance; prohibited-severity rules reject or suspend.

**Verified by 8 test(s):**

- `no edge exists that would skip compliance`
- `prohibited-severity rules reject or suspend, never merely review`
- `the compliance engine also treats suspension as prohibited`
- `a suspended organisation is refused at creation and the attempt is audited`
- `a match against the simulated list suspends rather than silently allowing`
- `a PEP hit routes to enhanced due diligence and requires a manager`
- `a missing limit is treated as a block, never as unlimited`
- `an amount over the per-transaction limit is rejected, not merely flagged`

### REQ-16 — AI extraction proposes; it never confirms. A human must confirm extracted information.

**Area:** AI

**Source:** Brief — "Do not claim AI verification is conclusive... A human must confirm extracted information."

**Enforced by:** Extraction writes to a separate table with status proposed; the compliance engine never reads it; a recorded human confirmation is required.

**Verified by 4 test(s):**

- `a proposal is recorded as proposed and says it has no effect`
- `an unconfirmed proposal cannot influence a compliance outcome`
- `confirming records the person, and the audit event says the proposal was advisory`
- `a transaction without source-of-funds evidence cannot auto-clear`

### REQ-17 — An unknown partner outcome does not retry automatically, and the same instruction cannot cause a second payment.

**Area:** Settlement

**Source:** Brief — settlement failure handling.

**Enforced by:** Deterministic idempotency keys; an unknown-outcome state with retry disabled, reachable only by non-user actors.

**Verified by 4 test(s):**

- `a timeout produces an UNKNOWN outcome, a suspense posting and a critical exception`
- `resubmitting the same idempotency key does not instruct a second payment`
- `the unknown-outcome edge exists and is reachable only by non-users`
- `a partner cannot take a compliance or approval edge`

### REQ-18 — Settlement finality is never claimed, and a return does not erase the settlement it follows.

**Area:** Settlement

**Source:** Brief — do not overstate what settlement means.

**Enforced by:** A disclaimer carried by the state machine description; the returned-payment edge posts a new journal rather than a reversal.

**Verified by 3 test(s):**

- `finality is never claimed anywhere in the machine`
- `the state-machine view disclaims settlement finality`
- `the returned-payment edge does NOT reverse the settlement journal`

### REQ-19 — Differences open a break with an owner, and closure above the threshold requires a second person.

**Area:** Reconciliation

**Source:** Brief — reconciliation and exception handling.

**Enforced by:** Reconciliation opens exception cases; four-eyes approval refused for the investigator.

**Verified by 2 test(s):**

- `a partner statement that disagrees with the ledger produces a break`
- `closing a break above the threshold requires a second person`

### REQ-20 — A rate is indicative until accepted, never described as locked without a contractual lock, and an expired quote is refused.

**Area:** FX

**Source:** Brief — forbidden FX language; "Locked until [time]" only where contractually locked.

**Enforced by:** Simulated quotes cannot carry a lock; expiry enforced at acceptance; the claims lint fails the build on prohibited language.

**Verified by 3 test(s):**

- `a simulated quote can never be marked as contractually locked`
- `an expired quote cannot be accepted`
- `an FX spread is computed in basis points from reference and provider rates`

### REQ-21 — Reports export in multiple formats, safely, with each export recorded.

**Area:** Reporting

**Source:** Brief — reporting and export.

**Enforced by:** CSV/XLSX/PDF writers with formula-injection neutralisation and precision preservation; exports recorded with a content hash and masking profile.

**Verified by 7 test(s):**

- `a report exports as CSV, XLSX and PDF, and each export is recorded`
- `CSV neutralises formula injection`
- `CSV quotes correctly per RFC 4180`
- `XLSX keeps very long numbers as text so precision is not lost`
- `PDF paginates rather than truncating`
- `the report catalogue is filtered by the caller's permissions`
- `a customer can run a report of their own activity`

### REQ-22 — Personal data is encrypted at field level and masked by default, and oversight views expose no personal names.

**Area:** Privacy

**Source:** Brief — data protection; masking.

**Enforced by:** AES-256-GCM field encryption; masking profiles derived from roles and applied server-side.

**Verified by 5 test(s):**

- `field encryption round-trips and is authenticated`
- `masking profiles are correct for each realm`
- `the regulator overview exposes no personal names`
- `off-platform notifications refuse to carry financial detail`
- `no stored notification body violates the off-platform rule`

### REQ-23 — A backup restores with its history, its ledger balance and its audit chain intact.

**Area:** Continuity

**Source:** Brief — disaster recovery.

**Enforced by:** A dedicated read-only backup role, because FORCE row-level security silently empties a dump taken as the owner.

**Verified by 1 test(s):**

- `a logical backup restores with history, ledger balance and audit chain intact`

**Gap:** The test proves the mechanism. NO RESTORATION OF A REAL DEPLOYMENT HAS EVER BEEN PERFORMED. See R-14 and EKORAILS_GATE_DR_TESTED.

### REQ-24 — No feature is reported as complete because its interface exists, and unfinished work is not concealed.

**Area:** Honesty

**Source:** Brief — "Never report a feature as complete merely because the interface exists." / "Do not conceal incomplete functionality."

**Enforced by:** Eight completion stages; the product map reports the highest stage genuinely reached; the build journal and risk register state what is unfinished.

**Verified by 1 test(s):**

- `the product map reports honest completion stages`

### REQ-25 — No claim is made that EKORails is not entitled to make.

**Area:** Honesty

**Source:** Brief — forbidden FX language; regulatory boundary.

**Enforced by:** A claims lint over every user-facing string in the repository, failing the build on prohibited language.

**Gap:** Verified by scripts/lint-claims.mjs in the build rather than by a test in the suites. The lint covers this repository only; it cannot police a slide deck, a website or a conversation. See R-15.
