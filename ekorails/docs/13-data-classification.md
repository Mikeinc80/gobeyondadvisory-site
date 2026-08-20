# 13 — Data classification

Four classes. Each one names what handling follows from it, and the handling is enforced in code
rather than left to a policy nobody re-reads.

---

## The classes

| Class | Definition | Where it may go | Retention |
|---|---|---|---|
| **Secret** | Compromise directly enables impersonation or decryption | Never logged, never exported, never displayed. Held only as a hash or ciphertext | Until superseded |
| **Restricted** | Personal data about an identifiable individual, or full financial identifiers | Encrypted at field level. Masked by default. Unmasking requires a specific permission and is audited | Per obligation, not yet fixed (FD-005) |
| **Internal** | Commercial and operational data about a business customer | Visible to the owning organisation and to back-office roles. Not public | 7 years assumed pending FD-005 |
| **Public** | What the system says about itself | Anywhere | Indefinite |

---

## Secret

| Data | Held as | Never |
|---|---|---|
| Passwords | scrypt hash, N=32768, per-user salt | Stored, logged, emailed or displayed in any form |
| Session tokens | SHA-256 hash in `user_session` | The plaintext exists only in the user's cookie |
| CSRF tokens | SHA-256 hash | The plaintext is readable by the client on purpose; that is what makes double-submit work |
| TOTP secrets | AES-256-GCM ciphertext | Shown once at enrolment and never retrievable afterwards |
| Encryption keys | HKDF-derived at start-up from process configuration | Written to the database, a log, or any response |

**The gap:** the encryption key derives from process configuration on the same host as the data.
An attacker with the host has both. A managed key store is the control and it is not connected.
Recorded in the threat model as gap 2 and in the risk register as part of `R-08`.

The redaction layer over structured logging is asserted by an automated test that runs the real
logging path and searches its output for anything in this class. The test also searches for money
amounts, hashes, UUIDs and timestamps that are legitimately present, so it does not pass by being
vague.

---

## Restricted

| Data | Encryption | Masking | Who may unmask |
|---|---|---|---|
| Identification numbers of beneficial owners | AES-256-GCM at field level | Last 4 characters only | `pii.unmask`, audited |
| Residential addresses | AES-256-GCM | Redacted entirely | `pii.unmask`, audited |
| Dates of birth | AES-256-GCM | Year only | `pii.unmask`, audited |
| Beneficiary account identifiers | AES-256-GCM | Last 4 characters only | `pii.unmask`, audited |
| Screening match payloads | Stored as returned | Visible to compliance roles only | — |
| Document contents | AES-256-GCM | Download requires a reason, which is audited | `document.read.any` |

Masking is a profile derived from the caller's roles, applied server-side. The client never receives
an unmasked value it is then trusted to hide, because a value that reaches the browser has already
left the building.

The Auditor and Regulator role sees masked personal data by default. The supervisory view shows
organisation **codes** rather than names for the same reason: oversight of a system rarely requires
the identity of its customers, and where it does, there is an audited path to it.

---

## Internal

Transaction records, amounts, purposes, invoice references, ledger entries, compliance case
history, reconciliation results, partner exchanges, audit events, configuration.

Handling: row-level security confines a customer to their own rows. Back-office roles see across
organisations because their job requires it, and every access is audited.

A note on amounts: a payment amount is not personal data, but it is commercially sensitive, and a
list of a business's payments describes that business precisely. Exports are recorded with a
content hash, the parameters used, and the masking profile in force when they were produced, so an
export can always be tied to what was asked for and by whom.

---

## Public

The regulatory boundary statement, the environment banner, the state machine, the compliance rule
library, the API description, and this documentation set.

These are public because it is better that they are. A system whose controls only work while
undisclosed does not have controls.

---

## Demonstration data

Every organisation, person, document, account identifier and transaction in the seeded environment
is **fictional**, and is labelled as such wherever it appears.

No real identity document, real bank-account detail or real personal data has been used anywhere in
this repository. Email addresses use the reserved `.invalid` top-level domain so that they cannot
resolve or be sent to by accident. Beneficiary identifiers are structurally valid and semantically
meaningless.

---

## Retention

**Not resolved.** Retention periods for AML records are a regulatory fact, and the controlling
source was not available to this build. Founder decision FD-005 covers it.

The working assumption everywhere in this system is seven years for anything that forms part of a
compliance or financial record, and nothing is deleted on any schedule today. That is the
conservative direction: keeping a record too long is a privacy problem, and it is a smaller one than
destroying a record a supervisor is entitled to see.

The mechanism to delete is also absent — audit, ledger and decision tables have no `DELETE` grant
for the application, deliberately. When a retention schedule is confirmed, deletion will need a
separate, audited, maker-checker path, and building it before the schedule is known would mean
guessing at the rules it enforces.

---

## Cross-border transfer

**Not resolved.** Founder decision FD-008.

No deployment region has been chosen. No claim of data residency in any jurisdiction is made
anywhere in this software, and the claims lint fails the build on the phrase "African data
residency" precisely because residency follows a deployment region and a completed assessment, and
not from where a company's owners live.
