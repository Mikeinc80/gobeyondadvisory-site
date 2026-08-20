<!--
  GENERATED FILE — do not edit.

  Produced by scripts/generate-docs.mjs from the definitions the software actually
  uses. If this document is wrong, the code is wrong: change the code and regenerate.
  `node scripts/generate-docs.mjs --check` fails the build when the two disagree.
-->

# 08 — Role and permission matrix

9 roles, 63 permissions, 6 separation-of-duties rules.

## How to read this

Permissions are additive; separation-of-duties rules are subtractive and win. A user who
somehow holds two roles does not thereby acquire a capability that neither role has,
because the separation rules are evaluated against the CONTEXT of the action — who
initiated the thing being approved, who investigated the break being closed — and not
against the permission set.

Every role also carries explicit denials. An absent permission is an oversight waiting to
happen; a stated "cannot" is a control somebody has to deliberately remove.

The same structure is seeded into the `role`, `permission` and `role_permission` tables,
so an auditor can read the effective matrix out of the database and compare it with this
document without trusting either.

## Roles

### Business Initiator

`business_initiator` · realm: business · re-authentication for sensitive actions: not required

Manages the business profile and initiates transactions on its behalf.

**Cannot:**

- Cannot approve a compliance review of its own organisation.
- Cannot create, edit or delete a ledger entry.
- Cannot override a transaction limit.
- Cannot read any data belonging to another organisation.
- Cannot provide the dual authorisation for a transaction it initiated.

**Holds 16 permissions:** `org.profile.read`, `org.profile.write`, `org.kyb.submit`, `org.users.manage`, `beneficiary.read`, `beneficiary.write`, `document.upload`, `document.read`, `document.extraction.confirm`, `txn.read`, `txn.initiate`, `txn.cancel`, `fx.quote.request`, `report.own.read`, `case.support.raise`, `learning.read`

### Business Approver

`business_approver` · realm: business · re-authentication for sensitive actions: required

Provides the second authorisation on transactions initiated by colleagues.

**Cannot:**

- Cannot approve a transaction it initiated itself.
- Cannot clear a compliance alert.
- Cannot read any data belonging to another organisation.

**Holds 10 permissions:** `org.profile.read`, `beneficiary.read`, `document.read`, `txn.read`, `txn.approve`, `fx.quote.request`, `fx.quote.accept`, `report.own.read`, `case.support.raise`, `learning.read`

### Compliance Analyst

`compliance_analyst` · realm: backoffice · re-authentication for sensitive actions: not required

Reviews KYB cases, screening results and transaction alerts.

**Cannot:**

- Cannot approve a high-risk case; that requires a Compliance Manager.
- Cannot approve its own escalation.
- Cannot change a risk rule.
- Cannot route a settlement or accept an FX quote.

**Holds 17 permissions:** `org.read.any`, `document.read.any`, `txn.read.any`, `beneficiary.review`, `compliance.case.read`, `compliance.kyb.review`, `compliance.screening.review`, `compliance.alert.clear`, `compliance.information.request`, `compliance.case.escalate`, `txn.suspend`, `report.compliance.read`, `report.operational.read`, `report.pilot.read`, `case.support.manage`, `audit.read`, `learning.read`

### Compliance Manager

`compliance_manager` · realm: backoffice · re-authentication for sensitive actions: required

Approves high-risk cases, reviews analyst decisions and files regulatory reports.

**Cannot:**

- Cannot review its own analyst decision.
- Cannot post a ledger entry.
- Cannot set a risk threshold outside the range authorised by configuration.

**Holds 25 permissions:** `org.read.any`, `org.suspend`, `document.read.any`, `txn.read.any`, `beneficiary.review`, `compliance.case.read`, `compliance.kyb.review`, `compliance.screening.review`, `compliance.alert.clear`, `compliance.information.request`, `compliance.case.escalate`, `compliance.highrisk.approve`, `compliance.rules.configure`, `compliance.decision.review`, `compliance.report.file`, `txn.suspend`, `report.compliance.read`, `report.operational.read`, `report.pilot.read`, `report.financial.read`, `case.support.manage`, `audit.read`, `audit.export`, `pii.unmask`, `learning.read`

### Treasury and Settlement Operator

`treasury_operator` · realm: backoffice · re-authentication for sensitive actions: required

Manages funding, FX quotes, settlement routing and liquidity.

**Cannot:**

- Cannot clear a compliance alert without compliance authorisation.
- Cannot approve a KYB case.
- Cannot release a settlement for a transaction whose compliance review is outstanding.
- Cannot post an unrestricted ledger entry; only reconciliation adjustments, and only with finance approval.

**Holds 14 permissions:** `org.read.any`, `txn.read.any`, `fx.quote.issue`, `treasury.funding.review`, `treasury.settlement.route`, `treasury.liquidity.read`, `treasury.exception.read`, `ledger.read`, `recon.run`, `report.operational.read`, `report.financial.read`, `report.pilot.read`, `case.support.manage`, `learning.read`

### Finance and Reconciliation Analyst

`finance_analyst` · realm: backoffice · re-authentication for sensitive actions: not required

Owns the ledger, daily reconciliation and financial reporting.

**Cannot:**

- Cannot clear a compliance alert.
- Cannot route a settlement.
- Cannot approve the closure of a break it investigated itself.
- Cannot delete or edit a journal; corrections are made by reversal.

**Holds 14 permissions:** `txn.read.any`, `ledger.read`, `ledger.post.adjustment`, `recon.run`, `recon.break.investigate`, `recon.break.approve`, `treasury.liquidity.read`, `treasury.exception.read`, `report.financial.read`, `report.operational.read`, `report.pilot.read`, `case.support.manage`, `audit.read`, `learning.read`

### Auditor or Regulator

`auditor_regulator` · realm: external · re-authentication for sensitive actions: not required

Read-only oversight across transactions, decisions, ledger, audit and controls.

**Cannot:**

- Cannot write anything, anywhere. Every route is read-only for this role.
- Sees personal data masked unless a specific unmasking authorisation is recorded.
- Cannot download a customer document without an access reason, which is audited.

**Holds 12 permissions:** `org.read.any`, `txn.read.any`, `compliance.case.read`, `ledger.read`, `audit.read`, `audit.export`, `controls.read`, `report.operational.read`, `report.compliance.read`, `report.financial.read`, `report.pilot.read`, `learning.read`

### System Administrator

`system_administrator` · realm: platform · re-authentication for sensitive actions: required

Manages users, roles, configuration and integrations.

**Cannot:**

- Cannot edit transaction history.
- Cannot edit or delete a compliance decision.
- Cannot edit or delete a ledger record.
- Cannot edit or delete an audit record. The database role has no privilege to do so.
- Cannot approve its own configuration change.
- Cannot read customer documents or personal data.

**Holds 9 permissions:** `admin.users.manage`, `admin.roles.manage`, `admin.config.propose`, `admin.integration.manage`, `admin.simulation.control`, `controls.read`, `audit.read`, `breakglass.request`, `learning.read`

### Super Administrator

`super_administrator` · realm: platform · re-authentication for sensitive actions: required · **break glass**

Emergency access only. Time-limited, separately approved, fully audited.

**Cannot:**

- Has no standing access. Every session requires an approved, time-limited break-glass grant.
- Cannot edit transaction history, compliance decisions, ledger records or audit records.
- Cannot approve its own break-glass request.

**Holds 14 permissions:** `admin.users.manage`, `admin.roles.manage`, `admin.config.propose`, `admin.config.approve`, `admin.integration.manage`, `org.suspend`, `controls.read`, `audit.read`, `audit.export`, `breakglass.request`, `breakglass.approve`, `breakglass.use`, `learning.read`, `learning.decision.approve`

## Matrix

| Permission | Sensitive | business initiator | business approver | compliance analyst | compliance manager | treasury operator | finance analyst | auditor regulator | system administrator | super administrator |
|---|---|---|---|---|---|---|---|---|---|---|
| `org.profile.read` |  | X | X |  |  |  |  |  |  |  |
| `org.profile.write` |  | X |  |  |  |  |  |  |  |  |
| `org.kyb.submit` |  | X |  |  |  |  |  |  |  |  |
| `org.users.manage` | yes | X |  |  |  |  |  |  |  |  |
| `org.read.any` | yes |  |  | X | X | X |  | X |  |  |
| `org.suspend` | yes |  |  |  | X |  |  |  |  | X |
| `beneficiary.read` |  | X | X |  |  |  |  |  |  |  |
| `beneficiary.write` |  | X |  |  |  |  |  |  |  |  |
| `beneficiary.review` | yes |  |  | X | X |  |  |  |  |  |
| `document.upload` |  | X |  |  |  |  |  |  |  |  |
| `document.read` |  | X | X |  |  |  |  |  |  |  |
| `document.read.any` | yes |  |  | X | X |  |  |  |  |  |
| `document.extraction.confirm` |  | X |  |  |  |  |  |  |  |  |
| `txn.read` |  | X | X |  |  |  |  |  |  |  |
| `txn.read.any` | yes |  |  | X | X | X | X | X |  |  |
| `txn.initiate` |  | X |  |  |  |  |  |  |  |  |
| `txn.approve` | yes |  | X |  |  |  |  |  |  |  |
| `txn.cancel` |  | X |  |  |  |  |  |  |  |  |
| `txn.suspend` | yes |  |  | X | X |  |  |  |  |  |
| `fx.quote.request` |  | X | X |  |  |  |  |  |  |  |
| `fx.quote.accept` | yes |  | X |  |  |  |  |  |  |  |
| `fx.quote.issue` | yes |  |  |  |  | X |  |  |  |  |
| `treasury.funding.review` | yes |  |  |  |  | X |  |  |  |  |
| `treasury.settlement.route` | yes |  |  |  |  | X |  |  |  |  |
| `treasury.liquidity.read` |  |  |  |  |  | X | X |  |  |  |
| `treasury.exception.read` |  |  |  |  |  | X | X |  |  |  |
| `compliance.case.read` | yes |  |  | X | X |  |  | X |  |  |
| `compliance.kyb.review` | yes |  |  | X | X |  |  |  |  |  |
| `compliance.screening.review` | yes |  |  | X | X |  |  |  |  |  |
| `compliance.alert.clear` | yes |  |  | X | X |  |  |  |  |  |
| `compliance.information.request` |  |  |  | X | X |  |  |  |  |  |
| `compliance.case.escalate` | yes |  |  | X | X |  |  |  |  |  |
| `compliance.highrisk.approve` | yes |  |  |  | X |  |  |  |  |  |
| `compliance.rules.configure` | yes |  |  |  | X |  |  |  |  |  |
| `compliance.decision.review` | yes |  |  |  | X |  |  |  |  |  |
| `compliance.report.file` | yes |  |  |  | X |  |  |  |  |  |
| `ledger.read` | yes |  |  |  |  | X | X | X |  |  |
| `ledger.post.adjustment` | yes |  |  |  |  |  | X |  |  |  |
| `recon.run` | yes |  |  |  |  | X | X |  |  |  |
| `recon.break.investigate` | yes |  |  |  |  |  | X |  |  |  |
| `recon.break.approve` | yes |  |  |  |  |  | X |  |  |  |
| `report.own.read` |  | X | X |  |  |  |  |  |  |  |
| `report.operational.read` |  |  |  | X | X | X | X | X |  |  |
| `report.compliance.read` | yes |  |  | X | X |  |  | X |  |  |
| `report.financial.read` | yes |  |  |  | X | X | X | X |  |  |
| `report.pilot.read` |  |  |  | X | X | X | X | X |  |  |
| `case.support.raise` |  | X | X |  |  |  |  |  |  |  |
| `case.support.manage` |  |  |  | X | X | X | X |  |  |  |
| `audit.read` | yes |  |  | X | X |  | X | X | X | X |
| `audit.export` | yes |  |  |  | X |  |  | X |  | X |
| `controls.read` |  |  |  |  |  |  |  | X | X | X |
| `pii.unmask` | yes |  |  |  | X |  |  |  |  |  |
| `admin.users.manage` | yes |  |  |  |  |  |  |  | X | X |
| `admin.roles.manage` | yes |  |  |  |  |  |  |  | X | X |
| `admin.config.propose` | yes |  |  |  |  |  |  |  | X | X |
| `admin.config.approve` | yes |  |  |  |  |  |  |  |  | X |
| `admin.integration.manage` | yes |  |  |  |  |  |  |  | X | X |
| `admin.simulation.control` | yes |  |  |  |  |  |  |  | X |  |
| `breakglass.request` | yes |  |  |  |  |  |  |  | X | X |
| `breakglass.approve` | yes |  |  |  |  |  |  |  |  | X |
| `breakglass.use` | yes |  |  |  |  |  |  |  |  | X |
| `learning.read` |  | X | X | X | X | X | X | X | X | X |
| `learning.decision.approve` | yes |  |  |  |  |  |  |  |  | X |

## Permissions

| Permission | Domain | Sensitive | What it allows | Held by |
|---|---|---|---|---|
| `org.profile.read` | organisation | no | View own organisation profile | 2 of 9 roles |
| `org.profile.write` | organisation | no | Create and edit own organisation profile | 1 of 9 roles |
| `org.kyb.submit` | organisation | no | Submit KYB information for review | 1 of 9 roles |
| `org.users.manage` | organisation | yes | Add and remove authorised users within own organisation | 1 of 9 roles |
| `org.read.any` | organisation | yes | View any organisation | 4 of 9 roles |
| `org.suspend` | organisation | yes | Suspend an organisation or user | 2 of 9 roles |
| `beneficiary.read` | beneficiary | no | View own beneficiaries | 2 of 9 roles |
| `beneficiary.write` | beneficiary | no | Add and edit own beneficiaries | 1 of 9 roles |
| `beneficiary.review` | beneficiary | yes | Approve or reject a beneficiary | 2 of 9 roles |
| `document.upload` | document | no | Upload documents | 1 of 9 roles |
| `document.read` | document | no | View and download own documents | 2 of 9 roles |
| `document.read.any` | document | yes | View documents across organisations | 2 of 9 roles |
| `document.extraction.confirm` | document | no | Confirm AI-proposed document fields | 1 of 9 roles |
| `txn.read` | transaction | no | View own transactions | 2 of 9 roles |
| `txn.read.any` | transaction | yes | View transactions across organisations | 5 of 9 roles |
| `txn.initiate` | transaction | no | Initiate a transaction | 1 of 9 roles |
| `txn.approve` | transaction | yes | Provide business dual authorisation | 1 of 9 roles |
| `txn.cancel` | transaction | no | Cancel own transaction before funding | 1 of 9 roles |
| `txn.suspend` | transaction | yes | Suspend a transaction pending investigation | 2 of 9 roles |
| `fx.quote.request` | fx | no | Request an FX quote | 2 of 9 roles |
| `fx.quote.accept` | fx | yes | Accept an FX quote on behalf of the customer | 1 of 9 roles |
| `fx.quote.issue` | fx | yes | Issue or reject an FX quote as treasury | 1 of 9 roles |
| `treasury.funding.review` | treasury | yes | Review funding status | 1 of 9 roles |
| `treasury.settlement.route` | treasury | yes | Route a settlement to a partner | 1 of 9 roles |
| `treasury.liquidity.read` | treasury | no | Monitor liquidity positions | 2 of 9 roles |
| `treasury.exception.read` | treasury | no | Review settlement exceptions | 2 of 9 roles |
| `compliance.case.read` | compliance | yes | View compliance cases | 3 of 9 roles |
| `compliance.kyb.review` | compliance | yes | Review a KYB case | 2 of 9 roles |
| `compliance.screening.review` | compliance | yes | Review sanctions, PEP and adverse-media results | 2 of 9 roles |
| `compliance.alert.clear` | compliance | yes | Clear or escalate an alert with a written reason | 2 of 9 roles |
| `compliance.information.request` | compliance | no | Request additional information from a customer | 2 of 9 roles |
| `compliance.case.escalate` | compliance | yes | Escalate a case to a manager | 2 of 9 roles |
| `compliance.highrisk.approve` | compliance | yes | Approve a high-risk case | 1 of 9 roles |
| `compliance.rules.configure` | compliance | yes | Propose risk-rule changes within authorised limits | 1 of 9 roles |
| `compliance.decision.review` | compliance | yes | Review an analyst decision | 1 of 9 roles |
| `compliance.report.file` | compliance | yes | File or export a regulatory report | 1 of 9 roles |
| `ledger.read` | ledger | yes | View ledger accounts and balances | 3 of 9 roles |
| `ledger.post.adjustment` | ledger | yes | Post a reconciliation adjustment or reversal | 1 of 9 roles |
| `recon.run` | finance | yes | Run reconciliation | 2 of 9 roles |
| `recon.break.investigate` | finance | yes | Investigate a reconciliation break | 1 of 9 roles |
| `recon.break.approve` | finance | yes | Approve the closure of a reconciliation break | 1 of 9 roles |
| `report.own.read` | reporting | no | View and export own organisation reports | 2 of 9 roles |
| `report.operational.read` | reporting | no | View operational reports | 5 of 9 roles |
| `report.compliance.read` | reporting | yes | View compliance reports | 3 of 9 roles |
| `report.financial.read` | reporting | yes | View financial reports | 4 of 9 roles |
| `report.pilot.read` | reporting | no | View pilot reports | 5 of 9 roles |
| `case.support.raise` | cases | no | Raise a support case | 2 of 9 roles |
| `case.support.manage` | cases | no | Own and progress support cases | 4 of 9 roles |
| `audit.read` | audit | yes | Read the audit trail | 6 of 9 roles |
| `audit.export` | audit | yes | Export the audit trail | 3 of 9 roles |
| `controls.read` | audit | no | View system controls and their status | 3 of 9 roles |
| `pii.unmask` | audit | yes | View unmasked personal data where specifically authorised | 1 of 9 roles |
| `admin.users.manage` | administration | yes | Manage users across the platform | 2 of 9 roles |
| `admin.roles.manage` | administration | yes | Manage roles and permissions | 2 of 9 roles |
| `admin.config.propose` | administration | yes | Propose system configuration changes | 2 of 9 roles |
| `admin.config.approve` | administration | yes | Approve system configuration changes | 1 of 9 roles |
| `admin.integration.manage` | administration | yes | Manage integration and adapter settings | 2 of 9 roles |
| `admin.simulation.control` | administration | yes | Control partner simulator scenarios | 1 of 9 roles |
| `breakglass.request` | break_glass | yes | Request emergency access | 2 of 9 roles |
| `breakglass.approve` | break_glass | yes | Approve an emergency access request | 1 of 9 roles |
| `breakglass.use` | break_glass | yes | Exercise approved emergency access | 1 of 9 roles |
| `learning.read` | learning | no | Use the Founder Learning Center | 9 of 9 roles |
| `learning.decision.approve` | learning | yes | Approve a founder decision in the decision log | 1 of 9 roles |

## Separation of duties

| Rule | Action | What is refused |
|---|---|---|
| `SOD_TXN_SELF_APPROVAL` | `txn.approve` | A user cannot provide the dual authorisation for a transaction they initiated. |
| `SOD_COMPLIANCE_SELF_REVIEW` | `compliance.decision.review` | A manager cannot review their own analyst decision. |
| `SOD_BREAK_SELF_APPROVAL` | `recon.break.approve` | A break cannot be approved for closure by the person who investigated it. |
| `SOD_CONFIG_SELF_APPROVAL` | `admin.config.approve` | A configuration change cannot be approved by the person who proposed it. |
| `SOD_BREAKGLASS_SELF_APPROVAL` | `breakglass.approve` | An emergency access request cannot be approved by the requester. |
| `SOD_TREASURY_COMPLIANCE` | `compliance.alert.clear` | A treasury operator who routed a settlement cannot then clear its compliance alert. |
