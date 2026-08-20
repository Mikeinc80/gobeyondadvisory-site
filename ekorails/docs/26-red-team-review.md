# 26 — Red-team review

Eleven perspectives, each asking the question that perspective actually asks. Written after
probing the running system rather than after reading it, because the two produce different
answers — and the difference is where the findings were.

**Four findings.** Three are fixed and covered by tests; one is accepted with a stated
condition. Each names how it was found, because a finding whose provenance is "we thought
about it" is weaker evidence than one whose provenance is a transcript.

---

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| F-1 | The rate limiter could be turned off with a header | **High** | Fixed, 7 tests |
| F-2 | The Documents screen was broken for every back-office role | Medium | Fixed |
| F-3 | The compliance engine failed for every real customer action | **High** | Fixed earlier in the build, 3 tests |
| F-4 | `style-src` permits inline styles, so the CSP is not as strict as described | Low | Accepted, with a condition |

### F-1 — The rate limiter could be turned off with a header

**How it was found:** by running the attack, not by reading the code.

```
ten wrong passwords, one address:      401 x10, then 429 429 429 429
ten wrong passwords, rotating address: 401 x14, and it kept going
```

The limiter keyed on `X-Forwarded-For`, which the service believed unconditionally. That
header is set by the client unless something in front overwrites it, so the limiter was one
an attacker turns off by varying a header. Unauthenticated and trivial.

**What still held.** Per-account lockout was unaffected: five failures locked the account
whatever address was claimed, and the correct password was then refused. Credential
stuffing against one account stayed bounded. What was not bounded was password spraying
across many accounts at one attempt each, and every other endpoint's limits.

**Fixed.** The header is believed only when the socket it arrived on is named in
`EKORAILS_TRUSTED_PROXIES`, which is empty by default. Verified both ways: rotation refused
with none configured, honoured with the loopback declared.

The failure modes are asymmetric, which is why the default is empty. Behind an unconfigured
proxy, every request looks like one caller and the limits bite far too early — loud, and
fixed by configuration. Trusting the header fails silently and is fixed by nothing.

Seven tests cover the resolution, including that a caller naming the proxy in its own header
is still untrusted: the trust is in the socket, not in anything the request says.

### F-2 — The Documents screen was broken for every back-office role

**How it was found:** probing `GET /api/documents` as a compliance analyst returned **400**,
not 200 and not 403.

The route requires a global-scope caller to name the organisation. The client did not, so
any back-office role opening Documents — which their navigation offered them — got an error
notice. The browser smoke test had not caught it because the paths were hand-written per
role and no role's list happened to include `/documents`.

**Fixed, in three parts:**

1. The navigation offers Documents on the own-documents permission only. A back-office role
   reaches a customer's documents through the case that justifies looking at them.
2. The screen explains that, rather than erroring, and links to the queue.
3. **The smoke test now derives each role's paths from the role's own rendered navigation**
   instead of a list. A hand-written list is a list somebody forgets to add to; a menu item
   that exists is now a menu item that gets opened.

The third fix matters more than the first two. It closes the class, not the instance.

### F-3 — The compliance engine failed for every real customer action

Found earlier in the build, by the same method: walking the journey a customer walks, in a
browser, rather than driving the services directly.

Both engines authored their opening case note by resolving a service account out of
`app_user`. That table has row-level security with `FORCE`, so inside a customer's
organisation scope the subselect matched nothing, the author came back `NULL`, and the
`NOT NULL` constraint rejected the insert. **Authorising a payment returned 500 every time.**

The seeded database was full of compliance cases regardless, because the seeder runs in
system scope. The demonstration data looked exactly as it should while the path that
produces it was broken — which is the most dangerous shape a defect can take.

**Fixed.** A note now records the engine as its author, with a `CHECK` keeping a human note
carrying a user and an engine note carrying none. The service account is gone: it had been
seeded active, with the demonstration passphrase the seeder prints, and no second factor.

### F-4 — The CSP permits inline styles

```
style-src 'self' 'unsafe-inline'
```

`script-src` is properly locked down with a per-response nonce and no `unsafe-inline` or
`unsafe-eval`. `style-src` is not, because the client sets `style` attributes from literals
in code.

**Accepted, with a condition.** The exploitable path would be attacker-controlled data
reaching a style attribute, and `h()` only ever sets `style` from string literals written in
the source — never from API data. The condition is that this stays true: if a view is ever
written that passes server data into `style`, the CSP stops being a backstop for it.

Recorded honestly rather than described as strict, because `02-system-architecture.md`
previously implied the whole policy was.

---

## The eleven perspectives

### 1. An external attacker with no credentials

**Asks:** what can I do before I have anything?

Found F-1. Otherwise: parameterised queries throughout; the SPA fallback does not serve
files outside the web root; sign-in does not distinguish an unknown email from a wrong
password; error responses carry a code and a safe message and no internals; the session
cookie is `HttpOnly`, `Secure`, `SameSite=Strict`.

**Remaining:** no volumetric protection. There is no CDN or WAF, and that is a deployment
decision this repository cannot make.

### 2. An attacker with a stolen customer session

**Asks:** I am inside as a Business Initiator. Can I move money?

No, and it takes five independent failures to change that. A payment needs an approved
beneficiary (approval is a separate compliance act), a second authorisation the initiator
cannot give, re-authentication from that approver, and a compliance review. Probed: forcing
`organization_id` on both the transaction list and a report returned only the caller's own
rows, and fetching another organisation's transaction by id returned **404**, not 403.

**The realistic attack is not technical.** It is persuading a real approver to authorise a
real payment to a beneficiary that looks legitimate. Nothing here stops that. What it does
is leave a complete record of who approved what and why.

### 3. A malicious insider

**Asks:** I work here. What can I get away with?

Probed as an auditor: every write attempted returned `403 PERMISSION_DENIED`; beneficiaries
returned 403; the masking profile was `masked`; the supervisory view contained no personal
names. A pre-MFA session reached `/api/me` and nothing else.

An administrator cannot move money, clear an alert, post to the ledger or read customer
transactions. They **can** grant themselves a role, which is audited and which nothing
prevents.

**The honest position:** against a determined insider with the database owner role, the
controls are weak, and the mitigation is organisational rather than technical. There is one
person. That is `R-16` and it blocks a pilot.

### 4. A fraudster who is a legitimate customer

**Asks:** can I use this system to launder money or defraud my own company?

Structuring below a limit is what the velocity and aggregation rules exist for. Paying a
substituted beneficiary is what separate beneficiary approval and re-review-on-change exist
for. Self-approval is refused three times over — state machine, service, database.

**Remaining:** no account-name verification against the destination bank, because no
destination bank is connected. That is the check that would catch a substituted account
before the money moves, and it is the most valuable single control this system does not have.

### 5. A supervisor

**Asks:** show me you did what you say you do.

`23-regulator-demonstration-guide.md` is written for exactly this and names what would
disprove each claim. Every rule that applied is recorded whether or not it fired; decisions
are permanent and carry a named person and a written reason; refusals are recorded as
carefully as successes.

**The answer a supervisor will not like:** no corridor is confirmed, so nothing here has
been operated within an approved scope, because there is no approved scope.

### 6. An auditor

**Asks:** can I rely on the record?

The audit chain verifies in SQL. The ledger balances in every currency and the service
refuses to start if it does not. Corrections are reversals; there is no `UPDATE` grant on
`journal`, `journal_entry` or `audit_event` for any application role, and the append-only
trigger raises for the schema owner too.

**The limit, stated plainly:** with no off-host copy of a chain head, an attacker with the
owner role can rewrite records and recompute every subsequent hash, and verification passes.
A break proves tampering; the absence of one does not prove its absence.

### 7. A data protection authority

**Asks:** what is your lawful basis, and how long do you keep this?

Both unresolved. `14-privacy-impact-assessment.md` is labelled NOT COMPLETE because it is,
and the release gate is unmet. Nothing is deleted on any schedule, and the mechanism to
delete does not exist either.

Full residential addresses are held for every beneficial owner and are probably not
necessary. That is written in the assessment rather than defended.

### 8. A partner bank's due-diligence team

**Asks:** would we be comfortable settling for these people?

The division of licensed activity is explicit and structural: there is no account in the
chart of accounts that could hold customer money. Idempotency is deterministic. A timeout
produces "unknown" and disables retry rather than guessing.

**What would concern them:** no partner callback authentication exists, because no partner
can call in. It must be designed before one is connected, not after.

### 9. A technical due-diligence reviewer

**Asks:** is this real, or a demonstration with a database behind it?

181 tests against a real PostgreSQL, including cases that assert the database refuses things
the application would otherwise allow. Documents that describe mechanism are generated from
the code and the build fails when they drift. The traceability matrix fails the build if it
names a test that does not exist.

**Where they would push:** the client has no build step, so no bundler catches a renamed
export — which is why `check-web.mjs` exists and is itself verified against deliberate
breakage. And the worker is single-process, so this does not scale horizontally today.

### 10. Operations under stress

**Asks:** it is 3am and something is wrong. Can I work out what?

The audit trail is filterable by category, actor and window. Every partner exchange carries
its idempotency key, outcome and latency. Every state change carries a reason.

**What is missing, and it is a lot:** no monitoring, no alerting, no on-call, no paging, no
metrics, no tracing. An incident is noticed when somebody looks. All three response plans are
written and none has been rehearsed.

### 11. The founder, six months from now

**Asks:** can I still explain this, and did anything quietly become untrue?

Five checks fail the build rather than allowing drift: the claims lint, the web link check,
the environment check, the generated-document check and the traceability check. The last two
mean a document cannot silently stop describing the system.

**What will decay anyway:** the manuals, the threat model and the privacy assessment are
prose, and prose drifts. They carry no automated check because judgement cannot be
regenerated, and they should be re-read whenever the thing they describe changes.

---

## What this review did not do

- **No independent review.** This was written by the team that built the system. Everything
  above is a builder's assessment of their own work, which is exactly the thing an
  independent review exists to correct. `EKORAILS_GATE_SECURITY_REVIEW` is unmet.
- **No penetration test.** The probes were targeted at specific hypotheses. Nobody has spent
  a week trying to break this.
- **No dependency audit worth the name.** There is one runtime dependency, which makes the
  supply chain short rather than audited.
- **No load or soak testing.** Behaviour under concurrency and over time is unknown.
- **No review of the deployment**, because there is no deployment.

The method that found three of the four findings was the same each time: **run the thing a
real person would run, as the role that would run it.** Reading the code found none of them.
That is the most transferable conclusion here, and it is the reason `smoke-web.mjs` now
derives its paths from the navigation rather than from a list somebody maintains.
