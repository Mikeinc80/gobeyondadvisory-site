<!--
  GENERATED FILE — do not edit.

  Produced by scripts/generate-docs.mjs from the definitions the software actually
  uses. If this document is wrong, the code is wrong: change the code and regenerate.
  `node scripts/generate-docs.mjs --check` fails the build when the two disagree.
-->

# B — Claims lint

## What it is for

The most likely way this project causes harm is not a technical failure. It is a
sentence: a screen, a report or a slide claiming that EKORails holds customer funds,
or has a regulatory approval it does not have, or guarantees a rate. None of those is
true, and each is easy to write by accident when you are trying to sound confident.

So the phrases are a lint, and the lint runs in the build. It scans every user-facing
string in the repository and fails on language the entity is not entitled to use.

## How a phrase is excused

Three ways, all visible in review:

1. The text NEGATES the phrase — "EKORails is not a bank" is not a claim to be a bank.
2. The text QUOTES it as blocked language, which is what the lint's own word list does.
3. The line, or the line above it, carries an explicit `claims-lint-allow: <reason>`
   marker. This is the escape hatch, and it is deliberately noisy: a reviewer sees the
   marker and the stated reason in the diff.

## What it cannot do

It covers this repository. It cannot police a slide deck, a website, an email or a
conversation, and the same word list has to be applied to those by review before
publication. That gap is recorded in the risk register.

It also cannot catch a claim made in words it does not know. The list below is a
starting point, not a proof of innocence.

## The word list

### Prohibited (15) — always a failure

| Pattern | Why it is refused |
|---|---|
| `/\bguaranteed\s+(rate\|fx\|exchange\s+rate\|price)\b/i` | No rate is guaranteed. A rate is indicative until accepted, and locked only where a partner has contractually locked it. |
| `/\b(no\|zero)\s+spread\b/i` | There is a spread, and it is stored as an explicit field. Claiming otherwise is untrue. |
| `/\bzero\s+(loss\|fees?)\b/i` | Fees exist and are itemised. "Zero fees" usually means the fee is hidden in the rate. |
| `/\bbest\s+(market\s+)?rate\b/i` | An unprovable superlative. Show the reference rate and the spread instead. |
| `/\bcbn[- ]?(approved\|licensed\|authorised\|authorized\|regulated)\b/i` | Sandbox admission is not confirmed (founder decision FD-009). Nothing may imply it. |
| `/\bsandbox\s+participant\b/i` | EKORails does not claim to be an admitted sandbox participant. |
| `/\b(we\|ekorails)\s+(hold\|holds\|custody\s+of\|safeguard\|safeguards)\s+(your\s+)?(customer\s+)?funds?\b/i` | EKORails is not authorised to hold customer funds. Funds are held by licensed partners. |
| `/\byour\s+ekorails\s+(balance\|wallet\|account\s+balance)\b/i` | There is no customer stored-value balance. Implying one implies custody. |
| `/\bekorails\s+(is\s+)?(a\s+)?(licensed\|regulated\|authorised\|authorized)\b/i` | EKORails holds no licence that has been verified to this build. |
| `/\binstant\s+settlement\b/i` | Settlement timing depends on partners and corridors and cannot be promised. |
| `/\bfully\s+compliant\b/i` | Compliance is assessed by a supervisor, not asserted by a vendor. |
| `/\bbank[- ]grade\s+(security\|encryption)\b/i` | A marketing phrase with no definition. State the actual control instead. |
| `/\bmilitary[- ]grade\s+encryption\b/i` | Meaningless. Name the algorithm and the key length. |
| `/\bafrican\s+data\s+residency\b/i` | Residency follows the deployment region and a completed assessment (FD-008), not ownership. |
| `/\b100%\s+(secure\|safe\|accurate\|uptime)\b/i` | Nothing is 100% secure or accurate, and uptime is not measured in this build. |

### Suspect (4) — fine in context, wrong without it

These are phrases that are frequently, but not always, a misstatement. Each requires a
qualifier on the same line or in the comment above it; without one it fails.

| Pattern | Qualifier that excuses it | Why it is watched |
|---|---|---|
| `/\bsettlement\s+finality\b/i` | `/(not\|cannot\|no simulator\|out of scope\|conferred by\|legal property\|does not)/i` | Settlement finality is a legal property this system cannot confer. Mentioning it requires an adjacent disclaimer. |
| `/\blocked\s+(rate\|until)\b/i` | `/(contractual\|partner has\|lock_evidence\|cannot lock\|only where\|simulated)/i` | A rate may be described as locked only where a partner has contractually locked it. |
| `/\breal[- ]time\b/i` | `/(not\|simulated\|would be\|in a live\|aspiration)/i` | Nothing in this build is real-time; partner interactions are simulated. |
| `/\bAI\s+(verif\|validat\|confirm\|check)/i` | `/(not conclusive\|proposal\|advisory\|human\|never used\|must confirm\|proposed)/i` | AI extraction is advisory. It must never be described as verifying or confirming anything. |

## Running it

```
node scripts/lint-claims.mjs
```

It runs as part of `./scripts/test.sh` and in CI. A violation fails the build.
