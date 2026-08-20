# 11. Privacy, terms and disclaimer — drafts

**These are drafting frameworks, not legal advice.** They must be reviewed and approved by qualified
counsel in each relevant jurisdiction, and every placeholder completed, before publication. Each page
carries a visible "draft for legal review" callout on the site itself until that sign-off happens —
remove the callout only when counsel has signed off.

Published drafts:

- `/privacy-policy` — `src/ekorails/pages/privacy-policy.html`
- `/terms-of-use` — `src/ekorails/pages/terms-of-use.html`
- `/regulatory-disclaimer` — `src/ekorails/pages/regulatory-disclaimer.html`

EkoInfrastructure.com links to all three on ekorails.com rather than duplicating them, because there is
one controller and duplicated legal text drifts.

---

## 11.1 Privacy policy — structure and open items

| § | Section | Open items |
| --- | --- | --- |
| 1 | Who we are | Registered office, company number, DPO and registration status |
| 2 | What we collect | Form data, correspondence, consented measurement data, technical data. Explicitly: no payment details, no identity documents, no financial account data, no retail customers |
| 3 | Why we process it, and on what lawful basis | Five-row table: enquiries (consent + legitimate interest), updates (consent), anti-abuse (legitimate interest), measurement (consent), legal obligations (legal obligation) |
| 4 | Who we share it with | Processor list to be completed |
| 5 | International transfers | Transfer mechanisms under NDPA 2023, and UK/EU regimes where applicable |
| 6 | How long we keep it | Retention schedule |
| 7 | Your rights | Access, rectification, erasure, restriction, portability, objection, consent withdrawal. Response target to be set |
| 8 | Cookies and measurement | Provider name and cookie table |
| 9 | Security | — |
| 10 | Changes | — |

**Counsel questions.** (a) Is the controller EKORails LTD alone across both domains? (b) Does the NDPA
2023 registration obligation apply at current processing volume? (c) Which transfer mechanism applies
between the corridor markets? (d) Does any processor require a specific disclosure by name?

## 11.2 Terms of use — structure and open items

Fourteen clauses: these terms · what this website is · no advice and no offer · accuracy and
forward-looking information · permitted use · enquiry forms · intellectual property · third-party links
· availability · liability · privacy · changes · governing law and jurisdiction · contact.

**Drafting notes.** Clause 3 must be read against the regulatory disclaimer — the two are deliberately
consistent and should be reviewed together. Clause 6 states that submitting an enquiry creates no
relationship and asks that confidential information is not sent before an NDA. Clause 10 carries
`[CONFIRM WITH EKORAILS — counsel to confirm limitation and exclusions for each jurisdiction]`.
Clause 13 needs governing law and jurisdiction, which follow the place of incorporation.

## 11.3 Regulatory disclaimer — the operative text

This is the most important legal page on either site and is reproduced here in full outline, because
its wording is fixed by the claim register.

**Summary box (verbatim, matches the site-wide footer):**
> EKORails LTD is developing financial infrastructure for institutional and enterprise use. Information
> on this website is provided for general and partnership purposes and does not constitute financial,
> investment, legal or payment-services advice. Products, pilot activities and services described may be
> subject to regulatory review, licensing, partner approval and geographic restrictions.

| § | Clause | Operative effect |
| --- | --- | --- |
| 1 | Licensing and authorisation status | Affirmatively states that EKORails LTD is not licensed, authorised, approved, endorsed, registered or supervised by the CBN or any other regulator, holds no banking, PSP, IMTO, e-money, money transmission or investment authorisation, and does not accept deposits, hold client money, provide payment services to the public or operate a settlement system |
| 2 | Regulatory sandbox application | States the applied-only position; states that an application is not an admission, approval, licence or endorsement; states that admission would not be a commercial operating licence; commits to publishing the exact status granted, or the refusal or withdrawal |
| 3 | Development status | No capability is in production; no corridor is operating; explains what "designed to", "intended to" and "subject to regulatory approval" mean |
| 4 | No offer of investment | No offer, invitation, solicitation or recommendation; no investment terms published; no token, coin or digital asset issued, offered, promoted or sold |
| 5 | No guarantee of outcome | No guarantee of speed, timing, savings, rates, availability, stability, spread reduction or availability; no representation that any transaction or participant is or will be compliant |
| 6 | Forward-looking statements | Speak only as at publication; no obligation to update except where a regulatory-status statement has become inaccurate, which is corrected promptly |
| 7 | Third parties and named organisations | References to PAPSS, SWIFT, switches and central bank systems are descriptive and imply no relationship, affiliation, endorsement, integration or approval; partners named only with written consent |
| 8 | Data, statistics and sources | Every statistic attributed and listed in the source register; unverified figures shown as placeholders; corrections route to media@ekoinfrastructure.com |
| 9 | Geographic restrictions | Not directed at any person where publication would be contrary to local law; pilot activity limited to approved markets, participants and activities |
| 10 | Contact | compliance@ekorails.com; statements about regulatory status reviewed by the named compliance officer before publication and on a defined cycle |

**Counsel questions.** (a) Does §1 need to name specific Nigerian licence categories to be effective
locally? (b) Does §4 need a jurisdiction-specific financial-promotion carve-out? (c) Should §9 name
excluded jurisdictions explicitly? (d) Is the summary box wording adequate as the site-wide footer
disclaimer in every market where the site is accessible?

## 11.4 Cookie and consent position

- No advertising cookies, no cross-site tracking, no data sale.
- One `localStorage` key, `eko.consent.v1`, holding `granted` or `denied`. Not a cookie, and not set
  before a choice is made.
- The consent bar offers two equally weighted choices: **Essential only** and **Allow measurement**.
  There is no pre-ticked option and no dark pattern.
- Measurement only initialises after `granted`; the site is fully functional under `denied`.
- Counsel to confirm whether the chosen measurement tool is exempt from consent in the relevant
  jurisdictions; if it is, the bar can be reduced to a notice.

## 11.5 Publication control

Any change to the regulatory disclaimer, or to the footer disclaimer or regulatory status statement in
either `site.json`, requires the named compliance officer's approval, recorded in
`content/regulatory-status.md`, and must be applied to both sites in the same commit.
