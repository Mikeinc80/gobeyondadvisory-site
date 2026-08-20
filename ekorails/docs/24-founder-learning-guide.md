# 24 — Founder learning guide

This is the document for the person who commissioned the system and has to be able to
defend it — to a supervisor, a partner bank, an investor, or a technical reviewer who is
looking for the seam.

It is deliberately not a summary of the other documents. It is the order in which to learn
the thing, and the questions you should be able to answer without looking anything up.

---

## The one sentence

EKORails coordinates a sequence of steps performed by licensed parties, and keeps a record
of who did what and why that nobody — including EKORails — can quietly change.

The word doing the work is *coordinates*. If you can hold on to that under pressure, most
of the difficult conversations get easier.

## Week one — understand what you are not

Start here, not with the features. Almost every serious problem a business like this has
starts with somebody describing it as something it is not.

**Read:** `01-product-requirements.md` §2, then the Supervisory view in the application.

**Be able to answer, unprompted:**

- *"Do you hold customer money?"* — No. Funds go to a licensed partner institution. There
  is no account in the chart of accounts that could hold customer money, which is a
  stronger answer than a policy. Show them the chart of accounts.
- *"Are you regulated?"* — EKORails holds no licence that has been verified. The licensed
  activities in the flow — holding funds, executing FX, settling payments, crediting the
  beneficiary — are performed by others under their licences.
- *"Are you in the CBN sandbox?"* — Admission has not been confirmed. Say only that.

The instinct under pressure is to sound more established than you are. The cost of doing so
once, in front of the wrong person, is disproportionate to any benefit.

## Week two — follow one payment

**Do:** Learning Center → Transaction walkthrough. Pick a payment that went **wrong**, not
one that went right.

A successful payment teaches you the path you already imagine correctly. A returned or
partially settled one teaches you what the system is actually for.

**Be able to answer:**

- Where is the customer's money at each state? (Answer: with them, then with the partner,
  then with the beneficiary's bank. Never with EKORails.)
- What happens if the partner does not answer? (The transaction goes to
  `under_investigation`, automatic retry switches off, and a person establishes the true
  position. Retrying is how a payment gets made twice.)
- Why is a return not a reversal? (Because the payment genuinely happened and the money
  genuinely came back. Two events. Reversing the first would make the record say the
  payment never occurred.)

## Week three — the ledger

The part founders most often delegate and most often regret delegating.

**Read:** `06-ledger-design.md`. **Do:** Learning Center → Ledger explorer, then Finance →
Trial balance.

**Be able to answer:**

- Why does every journal balance within each currency rather than across them? (A
  cross-currency payment is two conversions. It has to balance twice.)
- Why are balances never stored? (A stored balance is a second source of truth. It agrees
  with the entries until the day it does not, and then nothing tells you which is right.)
- What happens when somebody makes a mistake? (A reversal. Both the mistake and the
  correction stay visible. There is no `UPDATE` grant, so there is no other option.)
- What is `fx_clearing` and what does a balance in it mean? (Half a conversion happened.
  Somebody has an open currency position and does not know it.)

## Week four — compliance

**Read:** `09-compliance-control-matrix.md`. **Do:** open a compliance case and read every
rule that was evaluated, including the ones that did not fire.

**Be able to answer:**

- Why record rules that did not fire? (Because "checked and found nothing" is evidence and
  "never run" is a gap, and they look identical a year later if you only store the ones
  that fired.)
- Why does every transaction in this build go to compliance review? (The corridor is an
  unconfirmed placeholder. A rule fires on every transaction. When the corridor is
  confirmed, this stops.)
- Can the AI decide anything? (No. It writes proposals to a separate table the compliance
  engine never reads. A person must confirm each value, and the confirmation records their
  identity. Never say the AI "verifies" anything.)

## Week five — watch it break

The most valuable hour you will spend.

**Do:** Administration → Simulation control. Run `partner_timeout` and submit a settlement.

Watch the transaction go to `under_investigation` and watch nothing happen. That is the
system working. Then run `partial_settlement` and find the shortfall in settlement suspense.
Then run `returned_payment` and confirm the original settlement journal is untouched.

**Be able to answer:** *"What happens when it goes wrong?"* — with a demonstration rather
than a description. This is the question that separates a founder who understands their
system from one who has been told about it.

## Week six — what is not finished

**Read:** `25-pilot-readiness-report.md` and `A-founder-decisions.md`.

**Be able to answer, without hesitating:** *"What doesn't work yet?"*

The list: no corridor confirmed, no partner contracted, no independent security review, no
restoration test, no antivirus, no uptime measurement, one person, ten open decisions.

Saying that list out loud, before being asked, is the single most credible thing you can do
in a technical or supervisory conversation. Everybody in the room knows an MVP has gaps. The
only question is whether you know which ones.

---

## The ten decisions that are yours

`A-founder-decisions.md` has them in full. None can be made by the software, and each is
open because the controlling source was not available.

The four that block a pilot outright:

| | | |
|---|---|---|
| **FD-002** | The corridor and currency pair | Nothing can clear compliance until this resolves |
| **FD-003** | Transaction and pilot limits | A missing limit is currently treated as a block, not as unlimited |
| **FD-004** | The settlement mechanism and the partner | There is no product without one |
| **FD-009** | What you say publicly about sandbox status | The most reversible technically and the least reversible reputationally |

Recording an approval in the Learning Center records your choice and writes an audit event.
**It does not change the software.** The placeholder still has to be replaced through a
maker-checker configuration change, by two people. That separation is deliberate: deciding
and implementing are different acts and should leave different records.

## Six habits worth keeping

1. **Say the boundary before you are asked.** Volunteering "we don't hold customer funds"
   is worth more than answering it.
2. **Never let a rate be described as guaranteed.** Indicative until accepted. The build
   fails on the alternative, and so should you.
3. **When something goes wrong, preserve before you investigate.** The record of what
   happened is usually worth more than a fast fix.
4. **Treat a control that has never inconvenienced anyone as untested.** During this build,
   the least-privilege grants blocked the seeder, the compliance engine refused to approve a
   customer, and the password policy rejected a test passphrase. Each was fixed by
   respecting the control, not by routing around it.
5. **Do not describe a feature as done because there is a screen for it.** There are eight
   completion stages for a reason.
6. **Get a second person.** Every separation of duties in this system is currently held by
   one pair of hands. That is the largest single risk in the register and no amount of
   further engineering reduces it.

## Ten questions you should be able to answer cold

1. Where is the customer's money at each stage of a payment?
2. Why is there no customer account in the chart of accounts?
3. What stops you editing the audit trail? What would still work if somebody tried?
4. What happens when a partner does not respond?
5. Why can't the person who created a payment approve it?
6. What does "settled" mean here, and what does it not mean?
7. Why does every transaction currently need a compliance review?
8. What can the AI decide? (Nothing.)
9. What would have to be true before this moves real money?
10. What is genuinely not finished?

If you can answer all ten without notes, you can hold your own in any conversation this
system will put you in. If you cannot answer number 10, do not have the conversation yet.
