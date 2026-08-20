# EKORails

Compliance-first orchestration for business-to-business cross-border trade settlement.

> **SANDBOX ENVIRONMENT. NO LIVE FUNDS.**
>
> This deployment settles through simulators and moves no real money. Every partner, rate
> and settlement is simulated. Every business, person and document in it is fictional.

**EKORails is not** a bank, a deposit-taking institution, a licensed payment provider, a
custodian of customer funds, a cryptocurrency exchange, a consumer investment platform, or
an admitted participant in the CBN Regulatory Sandbox.

That list is not a disclaimer bolted onto a product that behaves otherwise. Each item is
enforced in code, and `docs/23-regulator-demonstration-guide.md` tells you how to verify
each one for yourself rather than take it on trust.

---

## Running it

```bash
npm install
./scripts/provision-roles.sh          # three database roles, once per cluster
./scripts/db-reset.sh                 # migrations
npm run build
npm run seed                          # fictional demonstration data
npm start                             # http://127.0.0.1:8080
```

Or `npm run demo`, which does all of it.

The seeder prints the accounts it created and a shared passphrase. Every account has a
second factor; get a current code with:

```bash
node services/api/dist/src/seed/totp.js founder@ekorails.invalid
```

`docker compose up` brings up PostgreSQL and the service together. That is a development
convenience, not a deployment topology — see `infra/terraform/README.md`.

## Verifying it

```bash
npm test                              # 181 tests against a real PostgreSQL
node scripts/lint-claims.mjs          # language this entity may not use
node scripts/check-web.mjs            # the client's links, which no bundler checks here
node scripts/check-env.mjs            # .env.example matches what the code reads
node scripts/generate-docs.mjs --check  # documents match the code they describe
node scripts/smoke-web.mjs            # six consoles, nine roles, in a real browser
```

`npm test` runs the first five. The last needs Playwright and skips cleanly without it.

## What is in here

| Path | |
|---|---|
| `db/migrations/` | The schema, and most of the enforcement |
| `services/api/src/` | The service. One runtime dependency: `pg` |
| `apps/web/public/` | Six consoles. Plain ES modules, no build step |
| `services/api/test/` | Three suites, run against a real database |
| `scripts/` | Provisioning, reset, tests, and five checks that fail the build |
| `docs/` | 25 documents, plus two appendices. Eight are generated from the code |
| `infra/terraform/` | A skeleton. Nothing has been deployed |

## The four ideas worth knowing

**The database is the enforcement layer.** A journal that does not balance cannot be
committed — a deferred constraint trigger raises. An audit record cannot be edited — an
append-only trigger raises, and the application's database role has no `UPDATE` grant to
begin with. One customer cannot see another's rows — row-level security with `FORCE`. The
application is then free to be ordinary code, because the consequences of it being wrong
are bounded.

**Money is never a floating-point number.** `NUMERIC(24,6)` in the database, a BigInt-backed
`Decimal` in the service, a string all the way to the browser. `scripts/check-web.mjs` fails
the build if any client module calls `Number()` on a field named like an amount.

**Nothing is reported as complete because an interface exists.** There are eight completion
stages and the product map reports the highest one genuinely reached. What is unfinished is
listed in `docs/25-pilot-readiness-report.md`, at the top rather than the bottom.

**No regulatory fact has been invented.** The CBN Regulatory Sandbox application is the
controlling source for the corridor, the limits, the settlement mechanism and the reporting
obligations. It was not available to this build. Rather than guess, every such fact is a
visible `INSERT_APPROVED_*` placeholder or an open decision in `docs/A-founder-decisions.md`.

One consequence is worth stating plainly: because the corridor is unconfirmed, a rule fires
on every transaction, and **no transaction in this build can clear compliance
automatically.** That is intended behaviour for a system whose regulatory scope has not been
confirmed, not a defect.

## Live money

Nine release gates, each requiring named evidence, **none settable from any interface**.
They are process configuration read once at start-up. In `PRODUCTION` mode the process
refuses to start with any gate unmet, and in this build `assertLiveMoneyPermitted()` throws
unconditionally regardless of configuration.

None of the nine is met. `docs/25-pilot-readiness-report.md` states the position on each.

## Where to start reading

| If you are | Start with |
|---|---|
| A founder | `docs/24-founder-learning-guide.md`, then the Learning Center in the application |
| A supervisor or auditor | `docs/23-regulator-demonstration-guide.md` |
| Doing technical due diligence | `docs/02-system-architecture.md`, then `docs/12-threat-model.md` |
| A security reviewer | `docs/12-threat-model.md` — the eight gaps are listed together in §4 — then `docs/26-red-team-review.md` |
| Deciding whether to pilot | `docs/25-pilot-readiness-report.md` |
| Writing code here | `docs/04-data-model.md` and `docs/07-transaction-states.md` |

## Documents

Eight are **generated from the code** and regenerating them is part of the build, because a
written role matrix and a coded one disagree eventually and whichever is wrong the damage is
the same. The rest are written by hand, because they describe judgement rather than
mechanism.

| | Generated | | Written |
|---|---|---|---|
| `04` | Data model | `00` | Source-of-truth review |
| `05` | API reference | `01` | Product requirements |
| `07` | Transaction states | `02` | System architecture |
| `08` | Role and permission matrix | `03` | Data flows |
| `09` | Compliance control matrix | `06` | Ledger design |
| `10` | Requirements traceability | `12` | Threat model |
| `11` | Risk register | `13` | Data classification |
| `A` | Founder decisions | `14` | Privacy impact assessment |
| `B` | Claims lint | `15`–`17` | Incident response, continuity, disaster recovery |
| | | `18` | Reconciliation procedures |
| | | `19` | Partner integration guide |
| | | `20`–`23` | Manuals: business, compliance, operations, regulator |
| | | `24` | Founder learning guide |
| | | `25` | Pilot readiness report |
| | | `26` | Red-team review |

## Licence

Not yet determined.
