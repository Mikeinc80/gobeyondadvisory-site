# Corporate and controls sheet

For a bank's onboarding or compliance team assessing EKORails as a customer and counterparty.
Answers are direct, and where the answer is "not yet" it says so.

---

## 1. The entity

| | |
|---|---|
| Registered name | **EKORAILS LIMITED** |
| Previous name | ECO INFRASTRUCTURE LIMITED (changed by special resolution, 16 August 2026) |
| Registration number | **RC 9490673** |
| Jurisdiction | Federal Republic of Nigeria |
| Registry | Corporate Affairs Commission |
| Statute | Companies and Allied Matters Act 2020 |
| Incorporated | 15 April 2026 |
| Certificate issued | 23 August 2026, at Abuja |
| Tax Identification Number | 2623794513058 |
| Registered office | *To be supplied* — the certificate does not carry one, and the system does not assert one |
| Directors and beneficial owners | *To be supplied* |

Certificate of Incorporation available on request.

## 2. Business model

Software that orchestrates business-to-business cross-border trade settlement. Revenue is a fee on
orchestrated transactions, recorded in the ledger as `fee_revenue` at the point a quote is
accepted.

**EKORails does not hold customer funds, execute FX or settle payments.** Those are performed by
licensed institutions. This is structural rather than contractual: the chart of accounts contains
no account that could record holding a customer's money.

Customers are registered businesses paying foreign suppliers against invoices. There is no path in
the software by which an individual can onboard, and no account type that would fit one.

## 3. Regulatory status

| | |
|---|---|
| Licences held | **None verified.** EKORails does not hold or claim any licence |
| CBN Regulatory Sandbox | **Not admitted.** An application is being submitted. Nothing in the product states or implies admission |
| Activities performed under others' licences | Holding funds, FX execution, settlement, crediting the beneficiary |
| Live money movement today | **None.** Nine release gates, none met, none settable from any interface |

## 4. AML and financial crime controls

| Control | Position |
|---|---|
| Customer due diligence | Business profile, beneficial ownership, documents, submitted for review before any transacting |
| Screening | Sanctions, PEP and adverse media, at onboarding and per transaction. Provider **simulated** today; none contracted |
| Disposition of matches | Every match disposed of by a named person with a written reason. No automatic clearance at any score |
| Transaction monitoring | 26 rules, evaluated against every applicable subject, recorded whether or not they fire |
| Decision record | Permanent, attributable, and self-contained: rule text, parameters in force, data read, input and ruleset hashes |
| Beneficiary control | Approved separately before first use; re-reviewed automatically when account details change |
| Dual authorisation | The initiator of a payment cannot authorise it. Refused at three independent layers |
| Record retention | **Unresolved.** Working assumption seven years; nothing is deleted on any schedule today |
| Named compliance officer | **Not yet appointed.** Being appointed before any pilot |
| Suspicious transaction reporting | Case and decision records support it; **no filing route is configured**, pending the applicable forms |

## 5. Information security

| Control | Position |
|---|---|
| Authentication | Password (scrypt, N=32768) plus TOTP second factor. Lockout after five failures |
| Re-authentication | Required before value-moving actions, so an unattended session cannot authorise a payment |
| Authorisation | Nine roles with explicit denials; checked at the route, in the service, and by row-level security in the database |
| Customer segregation | Row-level security with FORCE. A query omitting its organisation filter still returns nothing extra |
| Encryption in transit | TLS, HSTS, strict security headers, a Content-Security-Policy with no inline script and no external origins |
| Encryption at rest | AES-256-GCM field encryption on identity numbers, addresses, dates of birth and account identifiers |
| Key management | **Gap.** The key derives from process configuration on the same host as the data. A managed key store is required and not connected |
| Audit trail | Append-only, hash-chained, verified in SQL. The application role holds no UPDATE or DELETE grant |
| Logging | Passwords, tokens, complete identification numbers, account credentials and private keys are never written. Enforced by a redaction layer and asserted by test |
| Penetration test | **Not performed** |
| Independent security review | **Not performed.** Our threat model is our own assessment and names eight gaps |
| Antivirus on uploads | **Not connected.** Checks are structural and are not described as scanning |
| Monitoring and alerting | **Not deployed.** An incident is noticed when somebody looks |

## 6. Operational resilience

| | |
|---|---|
| Incident response plan | Written. **Never rehearsed** |
| Business continuity plan | Written. **Never rehearsed** |
| Disaster recovery procedure | Written. **Never executed.** A restoration test is required before any pilot |
| Backups | Design specified, including a dedicated read-only role — a dump taken as the schema owner silently produces no rows under our row-level security, which is a backup that appears to succeed and restores nothing. **Not yet configured in a deployment** |
| Recovery objectives | 4 hours RTO, 15 minutes RPO. **Targets, not measured** |
| Uptime | **Not measured**, and therefore no figure is claimed |

## 7. Key-person risk

One person currently holds the product, compliance and engineering knowledge. Every separation of
duties in the software is held by one pair of hands, which means the separations are enforced by
the system and not yet by the organisation.

A compliance officer and a second engineer are being appointed before any pilot. This is recorded
in our own risk register as blocking, and no amount of further engineering changes it.

## 8. Data protection

| | |
|---|---|
| Personal data held | Names, dates of birth, nationalities, identification numbers and addresses of beneficial owners and directors; beneficiary account details; screening results |
| Not held | Biometrics, device fingerprints, location, behavioural analytics, marketing profiles, credit data |
| Basis | Predominantly legal obligation (AML). Formal determination pending the confirmed operating jurisdiction |
| Masking | Applied server-side by role. Unmasking is a separate permission and is audited |
| Cross-border transfer | **Unresolved.** No deployment region selected. **No claim of Nigerian or African data residency is made** — residency follows a deployment region and a completed assessment, not the ownership of the company |
| Privacy impact assessment | **Not complete.** A structured self-assessment exists and is labelled as incomplete |
| Subject access process | **Not built** |

## 9. Summary for a credit or onboarding committee

**In favour:** the controls that matter are enforced by mechanism rather than policy, and are
demonstrable in a room. Nothing about custody, licensing or regulatory status is overstated
anywhere in the product — a build-time check fails the release if it is. The gaps below are
disclosed rather than found.

**Against:** a company incorporated in April 2026, one person, no licence, no admitted sandbox
status, no contracted partner, no independent security review, no tested restore, and no
production deployment.

**Fair characterisation:** a well-built system at the point where the remaining work is
institutional rather than technical.
