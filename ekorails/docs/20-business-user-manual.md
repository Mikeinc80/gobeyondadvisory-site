# 20 — Business user manual

For the two customer roles: **Business Initiator** and **Business Approver**.

**Before anything else:** this environment settles through simulators and moves no real money. Every
rate, partner and settlement you see is simulated, and the balances are not real. The banner at the
top of every screen says so and cannot be turned off.

---

## Signing in

1. Your work email and your password.
2. A six-digit code from your authenticator application.

The first time, you will be asked to set up the authenticator. The secret is shown **once**. If you
lose it, an administrator has to reset it; there is no way to retrieve it.

You will be asked for a code again — not just at sign-in — when you do something sensitive, such as
authorising a payment. That is deliberate: it means an unattended session cannot be used to
authorise money movement.

## Getting your business approved

Under **Onboarding**.

1. **Profile** — registered name, registration number, country, industry, and what your business
   actually does. Be specific about the last one; "trading" tells a compliance analyst nothing and
   will come back as a question.
2. **People** — every beneficial owner and director, with dates of birth and nationalities. This is
   the part people most often get wrong by listing only the directors. Beneficial ownership means
   who ultimately owns or controls the business.
3. **Documents** — certificate of incorporation, ownership register, proof of address, and any
   licence your activity requires. Documents with expiry dates are tracked, and you will be asked to
   replace them before they lapse.
4. **Submit.**

What then happens: your company and every person you listed are screened against sanctions, PEP and
adverse-media sources. A compliance analyst reviews the results and decides. The possible outcomes
are approved, rejected, more information required, or escalated to a manager.

**A match is not an accusation.** Names collide constantly. If your company or a director matches a
listed entity, an analyst compares dates of birth, nationalities and identifiers and records what
distinguished you. That record is permanent and is what protects you from being asked again.

## Adding a beneficiary

Under **Beneficiaries**.

A beneficiary is who you are paying. Each one is reviewed and approved **before** it can be paid.
This is the control that prevents the most common fraud in cross-border trade payments: a
substituted account, usually arriving in an email that looks like it came from your supplier.

If you change a beneficiary's account details, it goes back for review. That is not friction for
its own sake — a changed account is precisely the event the control exists for.

## Making a payment

Under **Transactions → New transaction**.

| Field | What it is for |
|---|---|
| Beneficiary | Must be approved and unchanged |
| Amount | In the corridor's currency. A plain decimal, e.g. `5000000.00` |
| Purpose | What the payment is for. "Supplier invoice" is thin; "settlement of invoice INV-2026-0001 for packaging materials received on 14 August" is not |
| Invoice number | Where there is one. Used to detect the same invoice being paid twice |
| Source of funds | Where the money came from. At least 20 characters, and be specific |

Source of funds is a due-diligence requirement, not a formality. "Business revenue" will be
questioned. "Export receipts from confirmed contracts with [customer], received into the operating
account in July" will not.

Then:

1. **Submit for authorisation.** A colleague has to authorise it. **You cannot authorise your own
   payment** — the system refuses, and the refusal is recorded.
2. **Your approver authorises it**, re-entering their authenticator code.
3. **Compliance reviews it.** In this build, every payment goes to compliance review, because the
   corridor is not confirmed. That is intended.
4. **You are offered a rate.** It is **indicative** until you accept it, and it expires. Accepting is
   the point at which an obligation is recorded.
5. **You fund it** — to the partner institution, not to EKORails.
6. **It settles**, and you are told.

## Following a payment

Open any payment to see:

- **Lifecycle** — every state it has been in, who moved it, when, and the reason they gave.
- **Ledger** — the accounting entries, each with a plain-English explanation of what it means.
- **Partner interactions** — every exchange, labelled as simulated.
- **Audit trail** — everything recorded about it.

"Explain this transaction" opens a guided walkthrough of the same payment, which answers five
questions at every step: who is responsible, what is happening, why it matters, what could go wrong,
and what evidence is kept.

## Withdrawing a payment

You can withdraw a payment while it is a **draft**, and while it is **awaiting funding**. You are
asked why, and the reason is permanent.

You cannot withdraw after funding. At that point your money is with the partner, and unwinding it is
a **return** — a different thing, with its own accounting treatment and its own record. If you need
one, raise a support case.

## Reports

Under **Reports**. Your own activity only. Available as JSON, CSV, XLSX and PDF, and every export is
recorded with a content hash so it can be tied back to what was asked for.

## Support and complaints

Under **Support cases**. A case has a category, a priority and a service target. A complaint is a
category of case, and it is tracked to a resolution rather than to a reply.

## Things that will surprise you, and why

**"Why does every payment go to compliance?"** Because the corridor this pilot would run on has not
been confirmed. A rule fires on every transaction to ensure a person looks at it. When the corridor
is confirmed, most payments will clear automatically.

**"Why can't I authorise my own payment?"** Because one person able to both create and authorise a
payment is how most internal payment fraud happens. It is refused by the database, not by a setting
somebody could change.

**"Why do I have to enter my code again?"** Because a session left open on an unlocked laptop should
not be able to move money.

**"Why does changing a beneficiary's account send it back for review?"** Because that is exactly
what an attacker does after compromising your supplier's email.

**"Why can't I edit a payment after submitting it?"** Because your approver authorised what they
read. If something is wrong, withdraw it and create a new one.
