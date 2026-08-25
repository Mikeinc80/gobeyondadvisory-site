# Partner pack — settlement partnership

**EKORAILS LIMITED** · RC 9490673 · TIN 2623794513058
Incorporated 15 April 2026, Federal Republic of Nigeria, under CAMA 2020
Previously ECO INFRASTRUCTURE LIMITED; name changed by special resolution 16 August 2026

*Prepared for a first discussion. Nothing in this document assumes or implies an existing
relationship.*

---

## 1. The one-paragraph version

EKORails is software that prepares a business-to-business cross-border trade payment to the point
where a licensed institution can execute it: the customer is identified, the beneficiary is
approved, the source of funds is evidenced, screening is disposed of by a named analyst, and a
complete record exists of who decided what and why. **EKORails does not hold funds, does not
execute FX and does not settle.** Those are yours. What we are asking for is the settlement leg,
and what we bring is a customer file that survives examination.

## 2. What we are asking the bank to do

| | Who | Note |
|---|---|---|
| Hold customer funds pending settlement | **Bank** | Funds go from the customer to you. They never touch EKORails, and our ledger has no account that could record them doing so |
| Execute the currency conversion | **Bank or its liquidity provider** | We quote indicatively and record your rate and spread separately |
| Execute the payment | **Bank** | We send an instruction with an idempotency key |
| Report the outcome and provide statements | **Bank** | We reconcile daily against them |
| Everything before and after | EKORails | Onboarding, screening, approval, ledger, reconciliation, reporting |

## 3. Why this reduces your work rather than adding to it

The honest pitch. A correspondent relationship with a fintech is usually a compliance burden
because the bank inherits questions about a customer base it cannot see.

- **You can see it.** A read-only oversight role exists, with personal data masked by default and
  an audited path to unmasking. Your compliance team can look at any case file directly.
- **Every decision is reconstructable.** A compliance decision stores the rule text, the parameter
  values in force at the time, the data read and a hash of both. It is not read back from current
  configuration, so a rule change next month cannot alter what a decision last month rested on.
- **Rules that did not fire are recorded too.** "Checked and found nothing" is evidence. "Never
  run" is a gap. If only triggered rules were stored, you could not tell them apart a year later.
- **We cannot quietly edit anything.** The application's database role holds no UPDATE or DELETE
  grant on the audit, ledger or compliance-decision tables, and append-only triggers refuse even
  the schema owner. The audit trail is hash-chained and verified inside the database.
- **Dual authorisation is structural.** The person who creates a payment cannot authorise it. It is
  refused three separate times — state machine, service, database — not discouraged by policy.

## 4. The operational questions your team will ask

Answered directly, including where the answer is "we need this from you".

| Question | Answer |
|---|---|
| What happens if you send an instruction twice? | Every instruction carries a deterministic idempotency key. We need your written confirmation that a repeated key returns the original outcome and instructs no second payment, and for how long the key is honoured |
| What happens if we time out? | The payment moves to a state where **automatic retry is disabled** and a person must establish the true position from your records. We need an agreed procedure and a target time for that |
| What if you settle less than instructed? | The paid portion discharges that much of the obligation; the shortfall posts to a settlement suspense account with a named owner. It is never written off silently |
| What if the payment is returned? | A return is recorded as a **new event**. The original settlement is not reversed, because erasing it would hide what happened |
| What if your statement disagrees with our ledger? | Reconciliation opens a break and adopts neither figure. A person explains the difference, and above a threshold a second person approves the closure |
| How do we send you statements? | Format and cadence to be agreed. Reconciliation depends on it, so it is on the critical path |
| How would you authenticate a callback from us? | **Not yet built**, deliberately: no scheme exists because no partner can call in. It must be designed with you before any connection, not retrofitted after |

## 5. What we would need from you, in order

1. **Confirmation of the licence** under which each activity in §2 is performed.
2. **An executed agreement**, including the idempotency and timeout procedures in §4.
3. **A statement format and cadence.**
4. **A test or sandbox endpoint**, so the adapter is written against something real.
5. **A callback authentication scheme**, designed jointly.

Items 1 and 2 are release gates in our own system: until they are met, our software refuses to
move live money, whatever anybody configures.

## 6. Where we honestly are

Stated plainly, because you will find out anyway and it is better coming from us.

| | |
|---|---|
| The software | Built and tested. 185 automated tests against a real database; every screen exercised by every role in a browser |
| Corridor | **Not confirmed.** A CBN Regulatory Sandbox application is being submitted. Until it is settled, every transaction in our system routes to a human compliance review by design |
| Sandbox admission | **Not admitted.** We are applying. Nothing in our software states or implies otherwise |
| Partners | **None contracted.** You are among the first conversations. Every partner in the system today is a simulator and is labelled as one |
| Independent security review | **Not yet commissioned.** Our threat model is our own assessment and names eight gaps in it |
| Team | Currently one person. A compliance officer and a second engineer are being appointed before any pilot |
| Live money | Not reachable. Nine release gates, none met, none settable from any interface |

## 7. What we can show you on Wednesday

Roughly 30 minutes, and the parts worth your time are the failures rather than the happy path.

| | What it shows |
|---|---|
| The chart of accounts | There is no customer stored-value account. Not disabled — absent. This is the custody position expressed structurally rather than promised |
| A payment, authored and then refused | The initiator attempts to authorise their own payment. The system refuses, and the refusal is recorded |
| A compliance case | Every rule evaluated, including those that did not fire, with the parameters in force at the time |
| **A partner timeout, produced on purpose** | The payment stops. Automatic retry switches off. This is the scenario that causes duplicate payments elsewhere |
| A partial settlement | The shortfall lands in suspense with an owner rather than being written off |
| The trial balance | Balanced in every currency, checked in SQL, and the service refuses to start if it is not |
| The audit trail | Including a refused action, and the hash-chain verification |

## 8. Contact

EKORAILS LIMITED · RC 9490673
Certificate of Incorporation and TIN certificate available on request.
