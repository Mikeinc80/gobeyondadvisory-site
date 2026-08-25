# Adapter specification — settlement institution

For a bank's engineering team. This is the interface EKORails would connect to, written so that
the awkward cases are agreed before anything is built rather than discovered in production.

Nothing here is implemented against a real institution. Every partner in the current build is a
simulator, and this document describes what a real connection would need.

---

## 1. Shape

Four adapter roles, each an interface rather than a vendor. A bank may fill one or several.

| Role | Operations |
|---|---|
| `origin_bank` | Report funding received from the customer |
| `liquidity_provider` | Quote a rate |
| `settlement_institution` | Submit an instruction, poll its status, supply statements |
| `destination_bank` | Confirm the beneficiary was credited; report returns |

## 2. Idempotency — the term to settle first

Every outbound instruction carries a deterministic key derived from the transaction and the
operation. The same instruction always produces the same key.

**What we need agreed in writing:**

- A repeated key returns the outcome of the original instruction and **instructs no second payment**.
- How long the key is honoured. If it expires, we need to know the window, because after it a
  repeat is a new payment.
- What is returned on a repeat: the original outcome, or a distinct "duplicate" status. Either
  works; we need to know which.

This is the single most important item in this document. The failure it prevents — a timeout
followed by a retry — is the ordinary case, not the exotic one.

## 3. The outcome that is not an outcome

An interface with only "success" and "failure" cannot express the state that matters most.

If a submission times out, the instruction may or may not have executed. Treating that as a failure
and retrying is how a payment is made twice. So:

- We move the transaction to `under_investigation`.
- **Automatic retry is disabled** in that state and cannot be enabled by configuration.
- A person establishes the true position from the bank's records before anything else happens.

**What we need agreed:** how the true position is established after a timeout, through which
channel, and within what time. A documented procedure with a name and a number on it.

## 4. Operations

Illustrative shapes. The transport, authentication and exact field names are yours to specify; the
semantics below are what the orchestration depends on.

### Submit a settlement instruction

```
POST /settlement
Idempotency-Key: <deterministic, stable across retries>

{ "reference": "TXN-...", "amount": "3300.00", "currency": "USD",
  "beneficiary": { ... }, "value_date": "2026-08-26", "purpose": "..." }
```

Outcomes we must be able to distinguish:

| | Meaning to us |
|---|---|
| `accepted` | Received and queued. Not yet settled |
| `settled` | Paid. **Note: we treat this as "the partner reported it as made", not as settlement finality** |
| `rejected` | Declined, with a reason code we can show the customer |
| `partially_settled` | Less than instructed, with the amount actually settled |
| `duplicate` | This key was seen before; here is the original outcome |
| *(timeout)* | No response. Handled per §3 |

### Report funding received

An amount and a currency that match what was expected — or an explicit short-funding outcome
carrying the amount that actually arrived. We do not infer short funding from a smaller number; it
needs to say so.

### Statements

The reconciliation input. We need: a stable reference matching what we submitted, the amount, the
currency, the value date, and the status. Format and cadence to be agreed; daily is our assumption.

### Returns

A return is reported as a **new event** with a reference to the original. We do not reverse the
original settlement, because it genuinely happened and erasing it would hide a real operational
event.

## 5. Callback authentication — not yet designed

If the bank pushes status updates rather than being polled, the callbacks must be authenticated.
**No scheme exists in the current build**, deliberately: none could be designed sensibly without a
counterparty.

This must be agreed before any connection. Our expectation is a signature over the raw body with a
shared or asymmetric key, a timestamp, and a replay window — but the bank's existing standard
takes precedence if there is one.

## 6. What we record about every exchange

Permanently, in both directions: the operation, the direction, the idempotency key, the request and
response **with credentials and full account identifiers redacted**, the outcome, and the latency.

No credential, token or full account number is ever written to a log or an audit record. That is
enforced by a redaction layer and asserted by an automated test that searches real logging output.

## 7. Failure modes we test against

Our simulators produce each of these on demand, so the orchestration's behaviour under failure is
observed rather than assumed. A real adapter must handle all of them.

| Scenario | Required behaviour |
|---|---|
| Success | The ordinary path |
| Delayed funding | Wait visibly. Do not time the customer out silently |
| Partner compliance refusal | The bank's own screening declines. Our approval does not override it |
| Insufficient liquidity | Fail cleanly. Never partially execute |
| Invalid beneficiary | Fail with the field named, so the customer can correct it |
| **Timeout** | `under_investigation`. **No automatic retry** |
| Duplicate instruction | The idempotency key means the second changes nothing |
| Failed settlement | Obligation stands; funding is still with the partner |
| Partial settlement | Paid portion discharges; shortfall to suspense with an owner |
| Return after settlement | A new event. The original settlement stands |
| Statement mismatch | Open a reconciliation break. Adopt neither figure |

## 8. FX and the language around it

Not a stylistic preference. A rate presented as guaranteed and then not honoured is a complaint at
best.

- Before the customer accepts, a rate is **indicative**.
- It may be described as locked only where the bank has contractually locked it. Absent that, it is
  not described that way, and our build fails its own checks if that language appears.
- The spread is recorded as a separate field from the provider rate and is shown separately to the
  customer. A fee inside a rate is still a fee.

## 9. Sequence

1. Confirm the licence under which each activity is performed.
2. Agree §2 (idempotency) and §3 (timeout) in writing.
3. Agree the statement format and cadence.
4. Design §5 (callback authentication).
5. Execute the agreement.
6. Provide a test endpoint; we write the adapter against it.
7. Exercise every scenario in §7 against that endpoint before any live traffic.

Steps 1 and 5 are release gates in our system. Until both are met, our software refuses to move
live money regardless of what anybody configures.
