# 19 — Partner integration guide

**Every partner in this build is a simulator.** No agreement with any institution has been confirmed
to this build, and no partner name in this system is a claim that an institution has agreed to
anything. Founder decision FD-004 covers the settlement mechanism and the named partners.

This guide describes the interface a real partner would connect to, and what would have to be true
before one is connected.

---

## 1. Who does what

The division matters more than the interface, because it is what determines whether EKORails is
performing a licensed activity.

| Activity | Performed by | Licensed activity |
|---|---|---|
| Customer onboarding and KYB decisioning | EKORails | No |
| Sanctions, PEP and adverse-media screening | Screening provider | No |
| **Holding customer funds** | **Licensed partner institution** | **Yes** |
| **Foreign exchange execution** | **Licensed liquidity provider** | **Yes** |
| **Payment execution and settlement** | **Licensed settlement institution** | **Yes** |
| **Crediting the beneficiary** | **Destination bank** | **Yes** |
| Orchestration, ledger, reconciliation, reporting | EKORails | No |

Everything in bold is somebody else's licence. This is the reason there is no customer stored-value
account in the chart of accounts and the reason funding is recorded as arriving at the partner.

## 2. The four adapter roles

Each is an interface, not a vendor. Swapping a partner means writing an adapter, not changing the
engines.

| Role | Operations | What the adapter must guarantee |
|---|---|---|
| `origin_bank` | Report funding received | An amount and a currency that match, or a short-funding outcome that says so |
| `liquidity_provider` | Quote a rate | A rate, a spread stated separately, and an expiry. **Never a lock unless one is contractual** |
| `settlement_institution` | Submit, poll, statement | Idempotency; an unambiguous outcome or an explicit "unknown" |
| `destination_bank` | Confirm the beneficiary was credited, report returns | A return reported as a new event, never as a reversal |

## 3. Idempotency

Every outbound call carries a deterministic key derived from the transaction and the operation. The
same instruction produces the same key, always.

A partner receiving a repeated key must return the outcome of the original instruction and **must
not** execute a second payment. Our adapter treats a repeat as `duplicate_ignored` and records it.

This is the single most important thing to agree with a partner in writing, because the failure it
prevents is a duplicate payment, and the failure mode it protects against — a timeout followed by a
retry — is the ordinary case rather than the exotic one.

## 4. The outcome that is not an outcome

A partner must be able to say **"I do not know"**, and an adapter must be able to represent it.

If a partner call times out, the instruction may or may not have been executed. Treating that as a
failure and retrying is how a payment is made twice. So:

- The transaction moves to `under_investigation`.
- Automatic retry is **disabled** in that state.
- A person establishes the true position from the partner's records before anything else happens.

An integration whose interface has only "success" and "failure" cannot express this, and connecting
to one would mean guessing. Any partner contract should specify how the true position is established
after a timeout, and how quickly.

## 5. The eleven scenarios an adapter must handle

These are the failure modes the simulators can be told to produce, and each exists because it is a
thing that genuinely happens to payments. A real adapter has to handle all of them.

| Scenario | What the system must do |
|---|---|
| `success` | The ordinary path |
| `delayed_funding` | Wait visibly. Do not proceed and do not time the customer out silently |
| `compliance_failure` | The partner's own screening declines. Our approval does not override theirs |
| `insufficient_liquidity` | Fail cleanly. Do not partially execute |
| `invalid_beneficiary` | Fail with the field named, so the customer can correct it |
| `partner_timeout` | `under_investigation`. **No automatic retry** |
| `duplicate_response` | The idempotency key means the second changes nothing |
| `failed_settlement` | The obligation stands; funding is still with the partner |
| `partial_settlement` | Paid portion discharges; shortfall to suspense with an owner |
| `returned_payment` | A new event. The original settlement is **not** reversed |
| `reconciliation_mismatch` | Open a break. Do not adopt the partner's figure |

Any of these can be produced deliberately from the Administration console, which is how the
behaviour is watched rather than assumed.

## 6. What is recorded about every exchange

Permanently, for every call in either direction:

- Operation, direction, idempotency key.
- Request and response, **redacted** — no credential, token or full account identifier is written.
- Outcome, latency, and the simulation scenario if one was in force.
- Which partner, and whether that partner is simulated.

The transaction detail screen shows all of it, labelled as simulated, so nobody reads a simulator's
answer as an institution's.

## 7. Rates, and the language around them

The FX language rules are not stylistic. They exist because a rate presented as guaranteed and then
not honoured is a complaint at best.

| Situation | What may be said |
|---|---|
| Before the customer accepts | **Indicative** |
| After acceptance, where a partner has **contractually** locked the rate | "Locked until [time]" |
| Anywhere in this build | Clearly labelled as simulated |

Never: "guaranteed rate", "no spread", "zero loss", "best market rate". The claims lint fails the
build on all of them.

The spread is stored as an explicit field, separate from the provider rate, and shown separately.
A fee hidden inside a rate is still a fee, and presenting it as "no fee" is the thing the lint is
there to stop.

## 8. Before a real partner is connected

1. **An executed agreement.** `EKORAILS_GATE_PARTNER_CONTRACTS`.
2. **The licence verified** for each activity the partner performs. `EKORAILS_GATE_LICENCE_VERIFIED`.
3. **Callback authentication designed and built.** No signature scheme exists today, because no
   partner does. This is gap 4 in the threat model and it must close before a partner can call in.
4. **The timeout procedure agreed in writing**, including how the true position is established.
5. **Idempotency confirmed in writing**, including how long a key is honoured.
6. **A statement format and cadence agreed**, because reconciliation depends on it.
7. **A second partner identified.** One settlement partner is a single point of failure — `R-05`.

Until 1 and 2 are done, an adapter can be written and tested against a simulator, and nothing more.
