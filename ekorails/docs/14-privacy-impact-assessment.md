# 14 — Privacy impact assessment

**Status: NOT COMPLETE.** This is a structured self-assessment by the team that built the system.
A privacy impact assessment is a formal exercise with a named accountable person and, where the
processing warrants it, consultation with a supervisory authority. Neither has happened.

Completing it is a release gate (`EKORAILS_GATE_PRIVACY_REVIEW`) and it is not met.

What follows is what such an assessment would need to start from, written honestly enough to be
useful to whoever does it properly.

---

## 1. What is processed, and why

| Category | Individuals | Why it is needed | Would it be needed without an AML obligation? |
|---|---|---|---|
| Name, date of birth, nationality | Beneficial owners, directors, authorised users | Identifying who controls a business is the core of know-your-business | Partly — a user needs a name to sign in |
| Identification numbers | Beneficial owners, directors | Distinguishing an individual from a sanctioned individual with a similar name | **No.** This is held because of the obligation |
| Residential address | Beneficial owners | Jurisdiction risk and identity verification | **No** |
| Screening results | Beneficial owners, directors, beneficiaries | Sanctions, PEP and adverse-media obligations | **No** |
| Beneficiary account details | Named beneficiaries, who may be individuals | Instructing a payment | Yes — a payment needs a destination |
| Access records | Every user | Audit, and demonstrating who did what | Partly |

The middle column matters. Most of the personal data here exists because a regulatory obligation
requires it, not because the product wants it. That is the strongest lawful basis available, and it
is also the reason the data cannot simply be minimised away.

## 2. Lawful basis

**Unresolved.** The lawful basis depends on the jurisdiction, and neither the operating jurisdiction
nor the applicable data-protection regime is confirmed to this build. Nigeria's NDPA is the obvious
candidate given the corridor's presumed origin, but the corridor itself is a placeholder (FD-002)
and assuming the answer would be exactly the kind of invented regulatory fact this build refuses to
make.

What can be said now: for the AML-driven categories, the basis is a legal obligation rather than
consent, and treating it as consent would be a mistake — an individual cannot meaningfully refuse
screening and still have their company's payment proceed, so consent would not be freely given.

## 3. Minimisation — what is and is not collected

**Not collected, deliberately:** biometrics, device fingerprints, location, behavioural analytics,
marketing profiles, social media, credit data, or anything about a beneficial owner beyond what
identification and screening require.

**Collected but reduced:** dates of birth are stored in full because screening needs them to
distinguish individuals, and displayed as a year only. Identification numbers are stored in full for
the same reason and displayed as the last four characters.

**Collected and arguably excessive:** residential addresses are held for every beneficial owner.
Jurisdiction can usually be established from a country field alone. A proper assessment should ask
whether the full address is needed, and the honest answer is probably not for most cases.

## 4. Special-category data

Adverse-media screening can return material about criminal allegations, and in some jurisdictions
that is a special category with a higher bar. This is stored as returned by the provider and shown
to compliance roles only.

Nothing in this system attempts to classify what a screening result contains, so nothing distinguishes
an ordinary match from a special-category one. That is a gap a real assessment should address.

## 5. Retention

**Unresolved (FD-005).** Nothing is deleted on any schedule. The working assumption is seven years
for compliance and financial records.

Two honest observations:

- Keeping data longer than necessary is a privacy harm, and this system currently keeps everything
  indefinitely, which is worse than a stated seven years.
- The deletion mechanism does not exist either — audit, ledger and decision tables have no `DELETE`
  grant for the application. Building deletion before the retention rules are known would mean
  guessing at what the rules permit.

## 6. Individual rights

| Right | Position today |
|---|---|
| Access | An individual's data is visible to their own organisation. There is **no subject access request process** and no export designed for one |
| Rectification | A beneficial owner's details can be corrected by the organisation. Corrections are versioned, and the previous value remains in the record |
| Erasure | **Not available**, and largely not applicable: AML records are retained under obligation. A process for the parts not covered by that obligation does not exist |
| Restriction | Not implemented |
| Portability | Not implemented |
| Objection | Not applicable to legal-obligation processing; not implemented for anything else |
| Automated decision-making | See below |

## 7. Automated decision-making — the important one

Compliance rules run automatically and produce an outcome. Two design decisions bound what that
outcome can do:

1. **A rule can recommend; it cannot decide.** Every compliance case closes on a decision recorded
   against a named person with a written reason. There is no path by which a rule outcome alone
   rejects a customer or blocks a payment permanently.
2. **AI extraction decides nothing at all.** It proposes field values into a separate table with
   status `proposed`. The compliance engine never reads it. A person must confirm each value, and
   the confirmation is recorded with their identity.

The engine also records **why** it reached its outcome, in a form a person can read: the rule text,
the parameter values in force, the data the rule looked at, and the plain-English explanation of the
risk each rule addresses and how it can be wrong. An individual asking why a decision went against
them can be given a real answer rather than "the system said so".

**What is missing:** there is no formal process for an individual to contest an outcome, and no
recorded human review specifically framed as reviewing the automated element. The decision record
exists; the process around it does not.

## 8. Security

Covered in `12-threat-model.md`. The two gaps that matter most for privacy:

- **The encryption key derives from process configuration on the same host as the data.** An
  attacker with the host has both. A managed key store is the control and it is not connected.
- **There is no monitoring of access patterns.** A compliance analyst browsing records with no case
  to justify it leaves a complete audit record, and nobody is told.

## 9. Transfers

**Unresolved (FD-008).** No region has been selected. In a live deployment, personal data would
move to at least a screening provider and a settlement partner, in jurisdictions not yet known,
under contracts that do not yet exist.

No claim of data residency in any jurisdiction is made anywhere in this software.

## 10. What a completed assessment would have to add

1. Identify the operating jurisdiction and applicable regime — depends on FD-002.
2. State the lawful basis per category under that regime.
3. Set retention periods per category — depends on FD-005.
4. Design and build subject access, rectification and, where applicable, erasure.
5. Decide whether full residential addresses are necessary. They are probably not.
6. Address special-category handling in adverse-media results.
7. Complete a transfer assessment for each recipient jurisdiction — depends on FD-008.
8. Name an accountable person. There is currently one person, which is `R-16`.
9. Determine whether the processing warrants prior consultation with a supervisory authority.

Until at least 1, 2, 3 and 8 are done, this document is a starting point and not an assessment, and
`EKORAILS_GATE_PRIVACY_REVIEW` stays unmet.
