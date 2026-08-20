<!--
  GENERATED FILE — do not edit.

  Produced by scripts/generate-docs.mjs from the definitions the software actually
  uses. If this document is wrong, the code is wrong: change the code and regenerate.
  `node scripts/generate-docs.mjs --check` fails the build when the two disagree.
-->

# 05 — API reference

94 endpoints. A machine-readable OpenAPI 3.1 description of the same
surface is served at `GET /api/openapi.json`, generated from the same registrations.

## Conventions that hold everywhere

- **Envelope.** Every JSON response carries `data` plus a `meta` block containing the
  environment, the banner and a request id. Errors carry `error` with a `code`, a
  message safe to show a user, and `details`.
- **The banner travels on every response**, including 404s and 500s, in the
  `X-EKORails-Environment` header. A client that renders a different environment from
  the one the server reports is showing a claim the server does not support.
- **Authentication** is an opaque session token in an `HttpOnly` cookie. State-changing
  requests must additionally present the CSRF token from the readable `ekorails_csrf`
  cookie in an `X-CSRF-Token` header.
- **Permissions are checked per route**, and again in the service, and again by
  row-level security in the database. A route listing several permissions grants access
  to a caller holding ANY of them.
- **404, not 403, for another organisation's records.** Telling a caller that a record
  exists but is not theirs is itself a disclosure.
- **Rate limits** are per identity where there is a session and per hashed network
  address otherwise. Authentication endpoints are limited far more tightly than reads.

## Status codes

| Code | Means |
|---|---|
| 200 / 201 | Success. |
| 400 | The request was malformed or a required field was missing or invalid. |
| 401 | Not authenticated, or authenticated but the second factor is outstanding. |
| 403 | Permission denied, CSRF failure, a separation-of-duties refusal, or re-authentication required. |
| 404 | Not found — including records outside the caller's organisation. |
| 409 | A conflicting concurrent change. |
| 422 | An integrity guard refused the operation. The request was well formed; the system will not do it. |
| 429 | Rate limited. |

## Admin

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/admin/configuration` | `admin.config.propose` or `controls.read` or `audit.read` | System configuration, including unresolved placeholders. |
| `GET` | `/api/admin/partners` | `admin.integration.manage` or `controls.read` or `treasury.liquidity.read` or `audit.read` | Partner registry: role, what they would do live, and what is simulated. |
| `GET` | `/api/admin/roles` | `admin.roles.manage` or `controls.read` or `audit.read` | The role and permission matrix as data. |
| `POST` | `/api/admin/simulation` | `admin.simulation.control` | Directs a partner simulator to produce a specific outcome. |

## Audit

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/audit/events` | `audit.read` | Searches the append-only audit trail. |
| `GET` | `/api/audit/export` | `audit.export` | Exports an audit range with a manifest proving contiguity and integrity. |
| `GET` | `/api/audit/verify` | `audit.read` | Verifies the audit hash chain using the database's own verification function. |

## Auth

| Method | Path | Requires | What it does |
|---|---|---|---|
| `POST` | `/api/auth/login` | nothing (public) | Password authentication. Returns a pre-MFA session. |
| `POST` | `/api/auth/logout` | a session, second factor outstanding | Ends the session. |
| `POST` | `/api/auth/mfa/confirm` | a session, second factor outstanding | Confirms MFA enrolment with a code from the authenticator. |
| `POST` | `/api/auth/mfa/enrol` | a session, second factor outstanding | Starts MFA enrolment and returns the provisioning URI. |
| `POST` | `/api/auth/mfa/verify` | a session, second factor outstanding | Completes the second authentication factor. |
| `POST` | `/api/auth/password` | a session | Changes the password and revokes other sessions. |
| `POST` | `/api/auth/step-up` | a session | Re-asserts the second factor for a sensitive action. |
| `GET` | `/api/me` | a session, second factor outstanding | The authenticated principal, roles, permissions and masking profile. |

## Beneficiaries

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/beneficiaries` | `beneficiary.read` or `beneficiary.review` | Lists beneficiaries. |
| `POST` | `/api/beneficiaries` | `beneficiary.write` | Adds a beneficiary. Screening runs immediately; review is required before first use. |
| `PATCH` | `/api/beneficiaries/:id` | `beneficiary.write` | Updates a beneficiary. A material change invalidates approval automatically. |

## Cases

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/support-cases` | a session | Support and complaint cases. |
| `POST` | `/api/support-cases` | `case.support.raise` or `case.support.manage` | Raises a support case or complaint. |

## Compliance

| Method | Path | Requires | What it does |
|---|---|---|---|
| `POST` | `/api/beneficiaries/:id/review` | `beneficiary.review` | Compliance approves, rejects or queries a beneficiary. |
| `GET` | `/api/compliance/cases` | `compliance.case.read` | The compliance queue. |
| `GET` | `/api/compliance/cases/:reference` | `compliance.case.read` | One compliance case with its assessment, notes and decisions. |
| `POST` | `/api/compliance/cases/:reference/decision` | `compliance.alert.clear` or `compliance.highrisk.approve` | Records a compliance decision with a mandatory written reason. |
| `GET` | `/api/compliance/expiring-documents` | `compliance.case.read` | Documents expiring or expired across all organisations. |
| `POST` | `/api/compliance/kyb/:organizationId/decision` | `compliance.kyb.review` | KYB decision. High-risk approval requires a Compliance Manager. |
| `GET` | `/api/compliance/rules` | `compliance.case.read` or `controls.read` or `learning.read` | The compliance rule library, with plain-English explanations. |
| `POST` | `/api/compliance/screening/:id/dispose` | `compliance.screening.review` | Dispose of a screening match as cleared, escalated or blocked. |
| `POST` | `/api/transactions/:id/compliance-decision` | `compliance.alert.clear` | Compliance clears, declines, queries or suspends a transaction. |

## Documents

| Method | Path | Requires | What it does |
|---|---|---|---|
| `POST` | `/api/documents` | `document.upload` | Uploads a document. Body is the raw file; metadata is in query parameters. |
| `GET` | `/api/documents` | `document.read` or `document.read.any` | Lists documents for an organisation. |
| `POST` | `/api/documents/:id/download-url` | `document.read` or `document.read.any` | Mints a short-lived signed download URL. Every mint is audited. |
| `POST` | `/api/documents/:id/extraction` | `document.upload` | Records AI-proposed fields for a document. Advisory only. |
| `POST` | `/api/extractions/:id/confirm` | `document.extraction.confirm` | A person confirms or corrects AI-proposed document fields. |

## Fx

| Method | Path | Requires | What it does |
|---|---|---|---|
| `POST` | `/api/quotes/:id/accept` | `fx.quote.accept` | The customer accepts a quote. Posts the obligation-recognition journal. |
| `POST` | `/api/transactions/:id/quote` | `fx.quote.issue` | Treasury issues an FX quote against a compliance-approved transaction. |

## Learning

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/learning/architecture` | `learning.read` | The architecture map with a plain-English note per component. |
| `GET` | `/api/learning/assessments/:moduleKey` | `learning.read` | Five short questions confirming understanding of a module. |
| `POST` | `/api/learning/assessments/:moduleKey` | `learning.read` | Submits assessment answers. Never gates access to the system. |
| `GET` | `/api/learning/build-journal` | `learning.read` | What was built, what remains simulated, and what is still open. |
| `GET` | `/api/learning/decisions` | `learning.read` | The decision log, including every open founder decision. |
| `POST` | `/api/learning/decisions/:ref/approve` | `learning.decision.approve` | Records founder approval of a decision. |
| `GET` | `/api/learning/glossary` | `learning.read` | Settlement and compliance terms explained plainly. |
| `GET` | `/api/learning/product-map` | `learning.read` | Every module in plain English, with its honest build status. |
| `GET` | `/api/learning/risk-register` | `learning.read` or `controls.read` | The risk register, with honest control-implementation status. |
| `GET` | `/api/learning/state-machine` | `learning.read` or `controls.read` | The complete settlement state machine. |
| `GET` | `/api/learning/walkthrough/:transactionId` | `learning.read` | A guided walkthrough of one transaction across every actor and system. |

## Ledger

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/ledger/accounts` | `ledger.read` | Ledger accounts with balances derived from journal entries. |
| `POST` | `/api/ledger/journals/:id/reverse` | `ledger.post.adjustment` | Reverses a journal by posting its mirror image. |
| `GET` | `/api/ledger/transactions/:id` | `ledger.read` or `txn.read` | The journals for one transaction, with plain-English explanations. |
| `GET` | `/api/ledger/trial-balance` | `ledger.read` | The trial balance. Must net to zero in every currency. |

## Notifications

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/notifications` | a session | The in-app notification inbox. |
| `POST` | `/api/notifications/:id/read` | a session | Marks a notification read. |

## Onboarding

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/onboarding` | `org.profile.read` | The organisation onboarding state, profile, people and documents. |
| `POST` | `/api/onboarding/people` | `org.profile.write` | Adds a director, signatory or beneficial owner. |
| `PUT` | `/api/onboarding/profile` | `org.profile.write` | Creates or updates the KYB profile. |
| `POST` | `/api/onboarding/submit` | `org.kyb.submit` | Submits KYB for compliance review and runs screening. |

## Reconciliation

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/exceptions` | `treasury.exception.read` or `recon.break.investigate` or `audit.read` | Open exception cases (breaks). |
| `GET` | `/api/exceptions/:reference` | `treasury.exception.read` or `recon.break.investigate` or `audit.read` | One exception case with its investigation notes. |
| `POST` | `/api/exceptions/:reference/approve` | `recon.break.approve` | Approves a proposed resolution. Refuses self-approval. |
| `POST` | `/api/exceptions/:reference/note` | `recon.break.investigate` | Adds an investigation note. |
| `POST` | `/api/exceptions/:reference/resolve` | `recon.break.investigate` | Proposes a resolution. Above the four-eyes threshold this awaits approval. |
| `POST` | `/api/reconciliation/run` | `recon.run` | Runs the daily reconciliation suite. |
| `GET` | `/api/reconciliation/runs` | `recon.run` or `ledger.read` or `audit.read` | Recent reconciliation runs. |
| `GET` | `/api/reconciliation/runs/:reference` | `recon.run` or `ledger.read` or `audit.read` | One reconciliation run with every compared item. |

## Regulator

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/regulator/overview` | `controls.read` | The read-only regulator view: scope, activity, controls, incidents, availability. |

## Reporting

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/reports` | `report.own.read` or `report.operational.read` or `report.compliance.read` or `report.financial.read` or `report.pilot.read` | The catalogue of available reports. |
| `GET` | `/api/reports/compliance-decisions` | `report.compliance.read` | Compliance decision audit |
| `GET` | `/api/reports/compliance-summary` | `report.compliance.read` | Compliance summary |
| `GET` | `/api/reports/financial-summary` | `report.financial.read` | Financial summary |
| `GET` | `/api/reports/my-charges` | `report.own.read` | Your charges |
| `GET` | `/api/reports/my-transactions` | `report.own.read` | Your transactions |
| `GET` | `/api/reports/operational-summary` | `report.operational.read` | Operational summary |
| `GET` | `/api/reports/partner-performance` | `report.operational.read` | Partner performance |
| `GET` | `/api/reports/pilot-report` | `report.pilot.read` | Pilot report |
| `GET` | `/api/reports/reconciliation-report` | `report.financial.read` | Reconciliation report |
| `GET` | `/api/reports/transaction-register` | `report.compliance.read` | Transaction register |
| `GET` | `/api/reports/trial-balance` | `report.financial.read` | Trial balance |

## System

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/corridors` | a session | The corridors a transaction can be created against. |
| `GET` | `/api/openapi.json` | nothing (public) | The OpenAPI description of this API. |
| `GET` | `/api/system/environment` | nothing (public) | Environment mode, banner and release-gate status. |
| `GET` | `/api/system/health` | nothing (public) | Liveness and dependency health. |
| `GET` | `/api/system/regulatory-boundary` | nothing (public) | The complete list of what EKORails does and does not claim to be. |

## Transactions

| Method | Path | Requires | What it does |
|---|---|---|---|
| `GET` | `/api/transactions` | `txn.read` or `txn.read.any` | Lists transactions visible to the caller. |
| `POST` | `/api/transactions` | `txn.initiate` | Creates a draft transaction. |
| `GET` | `/api/transactions/:id` | `txn.read` or `txn.read.any` | The full lifecycle view of one transaction. |
| `POST` | `/api/transactions/:id/approve` | `txn.approve` | The second business authorisation. Refuses self-approval. |
| `POST` | `/api/transactions/:id/cancel` | `txn.cancel` | Withdraws a draft, or a payment awaiting funding. Never after funding. |
| `POST` | `/api/transactions/:id/submit` | `txn.initiate` | Submits a draft for dual authorisation. |
| `GET` | `/api/transactions/requiring-action` | `txn.read` | Transactions waiting on this user. |

## Treasury

| Method | Path | Requires | What it does |
|---|---|---|---|
| `POST` | `/api/transactions/:id/complete` | `recon.run` | Settles partner fees and completes a reconciled transaction. |
| `POST` | `/api/transactions/:id/funding/confirm` | `treasury.funding.review` | Confirms funding at the origin partner (simulated). |
| `POST` | `/api/transactions/:id/settlement/prepare` | `treasury.settlement.route` | Converts the obligation and positions liquidity. |
| `POST` | `/api/transactions/:id/settlement/submit` | `treasury.settlement.route` | Submits the settlement instruction to the partner (simulated). |

## Reports

Each report is served at `GET /api/reports/{key}` in `json`, `csv`, `xlsx` or `pdf`.
Every non-JSON export is recorded with a content hash, the parameters used and the
masking profile that produced it, so an export can be tied back to what was asked for.

| Key | Title | Family | Requires | Filters |
|---|---|---|---|---|
| `my-transactions` | Your transactions | operational | `report.own.read` | from, to |
| `my-charges` | Your charges | operational | `report.own.read` | from, to |
| `operational-summary` | Operational summary | operational | `report.operational.read` | from, to, organization_id, currency |
| `partner-performance` | Partner performance | operational | `report.operational.read` | from, to |
| `compliance-summary` | Compliance summary | compliance | `report.compliance.read` | from, to |
| `compliance-decisions` | Compliance decision audit | compliance | `report.compliance.read` | from, to, organization_id |
| `trial-balance` | Trial balance | financial | `report.financial.read` | currency |
| `financial-summary` | Financial summary | financial | `report.financial.read` | from, to, currency |
| `pilot-report` | Pilot report | pilot | `report.pilot.read` | from, to |
| `transaction-register` | Transaction register | regulatory | `report.compliance.read` | from, to, organization_id, corridor, currency |
| `reconciliation-report` | Reconciliation report | financial | `report.financial.read` | from, to |
