<!--
  GENERATED FILE — do not edit.

  Produced by scripts/generate-docs.mjs from the definitions the software actually
  uses. If this document is wrong, the code is wrong: change the code and regenerate.
  `node scripts/generate-docs.mjs --check` fails the build when the two disagree.
-->

# 11 — Risk register

16 risks. 7 would block a pilot.

## The column that matters

`Control status` is the honest column, and it is the reason this register is worth
reading. A risk register that lists a control for every risk tells you nothing: the
question is always whether the control exists, whether anyone has tested it, and whether
anyone independent has looked at it. The five values are:

| Status | Means |
|---|---|
| `not_implemented` | Nothing is in place. The control is an intention. |
| `documented_only` | It is written down. No code enforces it. |
| `implemented_untested` | Code exists. Nothing proves it works. |
| `implemented_tested` | Code exists and an automated test exercises it, including its failure mode. |
| `implemented_and_independently_reviewed` | As above, and somebody who did not build it has examined it. |

**Nothing in this build has reached the fifth status.** No independent security review has
taken place, which is itself a release gate (`EKORAILS_GATE_SECURITY_REVIEW`) and is why
the highest honest status here is `implemented_tested`.

2 of 16 risks carry a control that is not fully implemented.

## Risks that block a pilot

| Ref | Risk | Why it blocks | What would clear it |
|---|---|---|---|
| `R-01` | Operating outside the approved sandbox scope | The corridor, currencies and limits come from a filing that was not available to this build. Transacting outside the approved scope would be operating without permission. | Obtain the filing and resolve FD-002 and FD-003 before any pilot activity. |
| `R-02` | Appearing to perform a licensed activity | Software that appears to hold funds, execute FX or settle payments invites the question of whether EKORails is performing those activities without authorisation. | Legal review of all external-facing copy before any external demonstration. |
| `R-05` | Single settlement partner concentration | One settlement partner is a single point of failure for the entire product. Correspondent relationships are withdrawn with little notice. | Identify a second settlement partner before the pilot ends. No partner is contracted today. |
| `R-08` | Exposure of personal data | Identity documents, ownership registers and screening payloads contain significant personal data about identifiable individuals. | Complete the privacy impact assessment and the cross-border transfer assessment (FD-008), and connect a managed key store instead of a derived key. |
| `R-12` | Document-borne malware | A customer uploads a document containing active content or malware, which reaches a compliance analyst's machine. | CONNECT A REAL ANTIVIRUS SERVICE. The current checks are structural only and are explicitly not antivirus. This is a named gap. |
| `R-14` | Backup restoration has never been tested | Backups that have not been restored are not backups. No restoration has been performed for this system. | Perform and evidence a full restoration test, including transaction-history verification. Release gate EKORAILS_GATE_DR_TESTED depends on it. |
| `R-16` | Key-person dependency | A single founder currently holds the product, compliance and technical knowledge of this system. | Appoint a named compliance officer and a second engineer before the pilot begins. |

## Summary

| Ref | Category | Risk | Inherent | Control status | Residual | Owner | Treatment | Blocks pilot |
|---|---|---|---|---|---|---|---|---|
| `R-01` | regulatory | Operating outside the approved sandbox scope | possible / severe | `implemented_tested` | unlikely / severe | Founder / Compliance | mitigate | **yes** |
| `R-02` | licensing | Appearing to perform a licensed activity | possible / critical | `implemented_tested` | rare / critical | Founder / Legal | mitigate | **yes** |
| `R-03` | settlement | Duplicate settlement | likely / major | `implemented_tested` | unlikely / major | Engineering / Treasury | mitigate | no |
| `R-04` | custody | Inadvertent custody of customer funds | unlikely / critical | `implemented_tested` | rare / critical | Engineering / Legal | avoid | no |
| `R-05` | partner_dependency | Single settlement partner concentration | possible / severe | `implemented_untested` | possible / severe | Founder | mitigate | **yes** |
| `R-06` | cyber | Account takeover leading to fraudulent payment | likely / major | `implemented_tested` | unlikely / major | Engineering / Security | mitigate | no |
| `R-07` | cyber | Malicious insider altering records | unlikely / critical | `implemented_tested` | rare / critical | Engineering / Security | mitigate | no |
| `R-08` | data_protection | Exposure of personal data | possible / major | `implemented_tested` | unlikely / major | Engineering / Privacy | mitigate | **yes** |
| `R-09` | accounting | Ledger and transaction state diverging | unlikely / major | `implemented_tested` | rare / major | Engineering / Finance | mitigate | no |
| `R-10` | fx | Unhedged currency exposure | possible / moderate | `implemented_tested` | unlikely / moderate | Treasury | mitigate | no |
| `R-11` | operational | Alert fatigue in compliance review | likely / major | `implemented_untested` | possible / major | Compliance | mitigate | no |
| `R-12` | cyber | Document-borne malware | possible / major | `implemented_untested` | possible / major | Engineering / Security | mitigate | **yes** |
| `R-13` | operational | Single-instance operational limits | almost_certain / moderate | `documented_only` | likely / moderate | Engineering | mitigate | no |
| `R-14` | operational | Backup restoration has never been tested | possible / critical | `documented_only` | possible / critical | Engineering | mitigate | **yes** |
| `R-15` | reputational | Unsupported claims in external material | likely / severe | `implemented_tested` | possible / severe | Founder | mitigate | no |
| `R-16` | concentration | Key-person dependency | almost_certain / major | `implemented_untested` | likely / major | Founder | mitigate | **yes** |

## Detail

### `R-01` — Operating outside the approved sandbox scope

Category: regulatory · **blocks a pilot**

The corridor, currencies and limits come from a filing that was not available to this build. Transacting outside the approved scope would be operating without permission.

| | |
|---|---|
| **Inherent** | possible likelihood, severe impact |
| **Controls in place** | Corridor is held as an explicit placeholder; the CORRIDOR_PLACEHOLDER_UNCONFIRMED rule fires on every transaction so none can auto-clear compliance; a missing limit is treated as a block rather than as unlimited. |
| **Control status** | `implemented_tested` |
| **Residual** | unlikely likelihood, severe impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Founder / Compliance |
| **Treatment** | mitigate |
| **Further action** | Obtain the filing and resolve FD-002 and FD-003 before any pilot activity. |

### `R-02` — Appearing to perform a licensed activity

Category: licensing · **blocks a pilot**

Software that appears to hold funds, execute FX or settle payments invites the question of whether EKORails is performing those activities without authorisation.

| | |
|---|---|
| **Inherent** | possible likelihood, critical impact |
| **Controls in place** | No customer stored-value account in the chart of accounts; funding is recorded at the partner; a claims lint over user-facing text fails the build on prohibited language; a standing regulatory-boundary statement is served from the API. |
| **Control status** | `implemented_tested` |
| **Residual** | rare likelihood, critical impact |
| **Movement** | Likelihood reduced by 2 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Founder / Legal |
| **Treatment** | mitigate |
| **Further action** | Legal review of all external-facing copy before any external demonstration. |

### `R-03` — Duplicate settlement

Category: settlement

An instruction is sent, the outcome is not learned, and a retry results in the beneficiary being paid twice. Usually unrecoverable.

| | |
|---|---|
| **Inherent** | likely likelihood, major impact |
| **Controls in place** | Deterministic idempotency keys derived from the transaction reference; a duplicate submission returns the original result; an unknown outcome is never auto-retried and raises a critical exception; the settlement reconciliation run counts submissions per transaction. |
| **Control status** | `implemented_tested` |
| **Residual** | unlikely likelihood, major impact |
| **Movement** | Likelihood reduced by 2 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Engineering / Treasury |
| **Treatment** | mitigate |
| **Further action** | Confirm the real partner honours idempotency keys and document their semantics. |

### `R-04` — Inadvertent custody of customer funds

Category: custody

A future change introduces an account or flow in which EKORails holds customer money, triggering client-money obligations it is not authorised for.

| | |
|---|---|
| **Inherent** | unlikely likelihood, critical impact |
| **Controls in place** | The account category enumeration is a database CHECK constraint. Adding a custody account requires a visible schema migration, not a configuration change. |
| **Control status** | `implemented_tested` |
| **Residual** | rare likelihood, critical impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Engineering / Legal |
| **Treatment** | avoid |
| **Further action** | Add a review gate on any migration touching ledger_account. |

### `R-05` — Single settlement partner concentration

Category: partner_dependency · **blocks a pilot**

One settlement partner is a single point of failure for the entire product. Correspondent relationships are withdrawn with little notice.

| | |
|---|---|
| **Inherent** | possible likelihood, severe impact |
| **Controls in place** | Adapters are provider-neutral and resolved by configuration, so a second partner is a configuration and adapter change rather than a rewrite. |
| **Control status** | `implemented_untested` |
| **Residual** | possible likelihood, severe impact |
| **Movement** | The controls did not reduce either likelihood or impact. They make the risk visible rather than smaller. |
| **Owner** | Founder |
| **Treatment** | mitigate |
| **Further action** | Identify a second settlement partner before the pilot ends. No partner is contracted today. |

### `R-06` — Account takeover leading to fraudulent payment

Category: cyber

A compromised customer credential is used to add a beneficiary and pay it.

| | |
|---|---|
| **Inherent** | likely likelihood, major impact |
| **Controls in place** | Mandatory MFA; step-up re-authentication before quote acceptance and settlement release; maker-checker on every payment; a new-beneficiary cooling-off rule; device and network signals feeding the compliance engine; session invalidation on password change. |
| **Control status** | `implemented_tested` |
| **Residual** | unlikely likelihood, major impact |
| **Movement** | Likelihood reduced by 2 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Engineering / Security |
| **Treatment** | mitigate |
| **Further action** | Add hardware security key support and out-of-band beneficiary confirmation. |

### `R-07` — Malicious insider altering records

Category: cyber

A member of staff with legitimate access alters a compliance decision, a ledger entry or the audit trail to conceal an action.

| | |
|---|---|
| **Inherent** | unlikely likelihood, critical impact |
| **Controls in place** | The application database role holds no UPDATE or DELETE privilege on audit, ledger-entry or compliance-decision tables; append-only triggers refuse mutation even for the table owner; the audit trail is hash-chained and verifiable in SQL. |
| **Control status** | `implemented_tested` |
| **Residual** | rare likelihood, critical impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Engineering / Security |
| **Treatment** | mitigate |
| **Further action** | Separate the database administrator role from the application team, and ship audit records to write-once external storage. Neither is done today. |

### `R-08` — Exposure of personal data

Category: data_protection · **blocks a pilot**

Identity documents, ownership registers and screening payloads contain significant personal data about identifiable individuals.

| | |
|---|---|
| **Inherent** | possible likelihood, major impact |
| **Controls in place** | Field-level AES-256-GCM encryption for identification and account numbers; hashed network identifiers; a redaction layer on every log and audit write; role-based masking in reports; audited document access with a stated reason for external roles. |
| **Control status** | `implemented_tested` |
| **Residual** | unlikely likelihood, major impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Engineering / Privacy |
| **Treatment** | mitigate |
| **Further action** | Complete the privacy impact assessment and the cross-border transfer assessment (FD-008), and connect a managed key store instead of a derived key. |

### `R-09` — Ledger and transaction state diverging

Category: accounting

A transaction reaches a state with accounting consequences without its journal being posted.

| | |
|---|---|
| **Inherent** | unlikely likelihood, major impact |
| **Controls in place** | State transitions and journal postings occur in one database transaction; the transaction-to-ledger reconciliation checks required journals per state daily; the service refuses to start if the trial balance does not net to zero. |
| **Control status** | `implemented_tested` |
| **Residual** | rare likelihood, major impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Engineering / Finance |
| **Treatment** | mitigate |
| **Further action** | None outstanding. |

### `R-10` — Unhedged currency exposure

Category: fx

An obligation is converted without the matching liquidity being positioned, leaving EKORails exposed to rate movement.

| | |
|---|---|
| **Inherent** | possible likelihood, moderate impact |
| **Controls in place** | Conversion and positioning post through an FX clearing account that must return to zero; the currency-position reconciliation reports any residual balance as a break. |
| **Control status** | `implemented_tested` |
| **Residual** | unlikely likelihood, moderate impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Treasury |
| **Treatment** | mitigate |
| **Further action** | Agree an exposure limit and an escalation path with the FX partner once contracted. |

### `R-11` — Alert fatigue in compliance review

Category: operational

Every transaction currently requires manual review because the corridor is a placeholder. At volume this trains analysts to clear alerts without reading them.

| | |
|---|---|
| **Inherent** | likely likelihood, major impact |
| **Controls in place** | Rules carry an explicit false-positive assessment; the compliance report tracks trigger rates and decision times per rule so drift is visible. |
| **Control status** | `implemented_untested` |
| **Residual** | possible likelihood, major impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Compliance |
| **Treatment** | mitigate |
| **Further action** | Resolve FD-002 so genuinely clean transactions can auto-clear, and review trigger rates weekly during the pilot. |

### `R-12` — Document-borne malware

Category: cyber · **blocks a pilot**

A customer uploads a document containing active content or malware, which reaches a compliance analyst's machine.

| | |
|---|---|
| **Inherent** | possible likelihood, major impact |
| **Controls in place** | Strict file-type allowlist; magic-byte verification against the declared type; refusal of PDFs containing JavaScript, launch actions or embedded files; content hashing. |
| **Control status** | `implemented_untested` |
| **Residual** | possible likelihood, major impact |
| **Movement** | The controls did not reduce either likelihood or impact. They make the risk visible rather than smaller. |
| **Owner** | Engineering / Security |
| **Treatment** | mitigate |
| **Further action** | CONNECT A REAL ANTIVIRUS SERVICE. The current checks are structural only and are explicitly not antivirus. This is a named gap. |

### `R-13` — Single-instance operational limits

Category: operational

Rate limiting is in-process and the background worker is single-process. Neither is safe across multiple instances.

| | |
|---|---|
| **Inherent** | almost_certain likelihood, moderate impact |
| **Controls in place** | Documented; the job table supports a distributed lock but no shared store is deployed. |
| **Control status** | `documented_only` |
| **Residual** | likely likelihood, moderate impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Engineering |
| **Treatment** | mitigate |
| **Further action** | Deploy a shared cache for rate limiting and a distributed lock for the worker before scale-out. |

### `R-14` — Backup restoration has never been tested

Category: operational · **blocks a pilot**

Backups that have not been restored are not backups. No restoration has been performed for this system.

| | |
|---|---|
| **Inherent** | possible likelihood, critical impact |
| **Controls in place** | A restoration test procedure is written and a test exists; it has not been run against real infrastructure. |
| **Control status** | `documented_only` |
| **Residual** | possible likelihood, critical impact |
| **Movement** | The controls did not reduce either likelihood or impact. They make the risk visible rather than smaller. |
| **Owner** | Engineering |
| **Treatment** | mitigate |
| **Further action** | Perform and evidence a full restoration test, including transaction-history verification. Release gate EKORAILS_GATE_DR_TESTED depends on it. |

### `R-15` — Unsupported claims in external material

Category: reputational

Marketing or pitch material describes capabilities or regulatory status the system does not have.

| | |
|---|---|
| **Inherent** | likely likelihood, severe impact |
| **Controls in place** | A claims lint runs in CI over user-facing strings in this repository. |
| **Control status** | `implemented_tested` |
| **Residual** | possible likelihood, severe impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Founder |
| **Treatment** | mitigate |
| **Further action** | The lint cannot police a slide deck. Apply the same word list to all external material by review before publication. |

### `R-16` — Key-person dependency

Category: concentration · **blocks a pilot**

A single founder currently holds the product, compliance and technical knowledge of this system.

| | |
|---|---|
| **Inherent** | almost_certain likelihood, major impact |
| **Controls in place** | The Founder Learning Center, the decision log, the build journal and extensive in-code documentation exist specifically to reduce this. |
| **Control status** | `implemented_untested` |
| **Residual** | likely likelihood, major impact |
| **Movement** | Likelihood reduced by 1 band(s). Impact is unchanged: if this happens anyway, it is just as bad. |
| **Owner** | Founder |
| **Treatment** | mitigate |
| **Further action** | Appoint a named compliance officer and a second engineer before the pilot begins. |
