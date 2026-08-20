# 16 — Business continuity plan

**Status: written, never rehearsed, and materially dependent on a single person.**

Business continuity is about staying able to serve customers when something the business depends on
stops working. Most of what follows is therefore about people and partners rather than servers;
servers are `17-disaster-recovery-plan.md`.

---

## 1. What this business actually depends on

| Dependency | If it stops | Current position |
|---|---|---|
| The settlement partner | No payment can settle. The product does nothing | **No partner is contracted.** One would be a single point of failure — `R-05` |
| The screening provider | No customer can be onboarded and no payment can clear compliance | No provider is contracted |
| The founder | Product, compliance and engineering knowledge stops | **This is the real continuity risk** — `R-16` |
| The cloud region | Everything stops | No region selected — FD-008 |
| The database | Everything stops | Recovery is `17` |

The first two are commercial, not technical, and neither exists yet. That is worth stating plainly:
this system's continuity plan is largely unwritten because the relationships it would be about have
not been formed.

## 2. The dependency nobody can engineer around

One person currently holds the product knowledge, the compliance knowledge and the technical
knowledge of this system. If that person is unavailable for a week, nothing progresses. If they are
unavailable permanently, the system is operable — it is documented — but nobody can make a judgement
call about a compliance case, a reconciliation break or a partner failure.

The software has separation of duties built into it. In practice there is one person holding every
role, which means the separations are not operating. A control that exists in the code and not in
the organisation is not a control.

**What closes it:** a named compliance officer and a second engineer, before a pilot. Nothing else
does. This is why `R-16` blocks a pilot and why no amount of further engineering changes that.

## 3. Continuity by scenario

### The settlement partner withdraws

Correspondent relationships end at short notice and often for reasons that have nothing to do with
the customer.

- **In flight:** payments already instructed are the partner's obligation. Payments not yet
  instructed stop where they are; nothing is lost, because funding sits at the partner and the
  obligation is recorded.
- **Immediate:** stop accepting new payments on that corridor. There is no configuration flag for
  this today — a corridor's status can be set to `disabled`, which is the mechanism, and it has not
  been exercised.
- **Recovery:** a second partner. Onboarding one is a matter of months, not days, which is why
  identifying a second partner before the pilot ends is `R-05`'s action.

### The screening provider is unavailable

- **In flight:** compliance evaluation cannot complete. Transactions wait rather than proceeding
  without screening. That is the correct behaviour and it should not be configurable.
- **Manual fallback:** a compliance analyst can record a decision with a written reason describing
  how screening was performed by other means. The system permits this because refusing entirely
  would be worse; the reason field makes it visible in every later review.
- **What must never happen:** proceeding without screening and without a recorded reason.

### The founder is unavailable

- **Day 1–3:** the system continues. Nothing in the running system requires intervention.
- **Day 4+:** compliance cases accumulate with nobody authorised to decide them. Reconciliation
  breaks accumulate with nobody to investigate. Customers cannot be onboarded.
- **Mitigation today:** none that is effective. The documentation set is complete enough that a
  competent engineer could operate the system, and no documentation substitutes for authority to
  make a compliance decision.

### Sustained unavailability of the service

- Customers cannot initiate or track payments. Payments already with a partner are unaffected — the
  partner settles or does not, independently of us.
- The reconciliation that would have run can run late; it is a comparison of records, not a
  time-critical operation.
- There is no status page and no customer notification mechanism for an outage.

## 4. Recovery objectives

Stated as targets, and marked honestly as untested.

| Measure | Target | Tested |
|---|---|---|
| Recovery time objective (service) | 4 hours | **No** |
| Recovery point objective (data) | 15 minutes | **No** |
| Time to restore from backup | 2 hours | **No** — no restoration has ever been performed |
| Time to a decision on a compliance case | 24 hours in normal operation | Not measured |

The last column is the important one. Untested targets are aspirations. `R-14` covers this and it
blocks a pilot.

## 5. What continuity looks like when it works

A short description of the target state, so the gaps above have something to be gaps from:

- Two settlement partners, either of which can carry the corridor.
- A screening provider with a contractual availability commitment and a documented manual fallback
  that has been used at least once in a rehearsal.
- At least three people: an engineer, a compliance officer, and someone who can cover either.
- A tested restoration, repeated on a schedule, with the result recorded.
- Monitoring that tells somebody the service is down before a customer does.
- A rehearsal of each scenario in §3 at least annually, with the plan updated by what the rehearsal
  found rather than by what it was supposed to find.

None of this is true today. All of it is achievable, and none of it is achievable by writing more
software.
