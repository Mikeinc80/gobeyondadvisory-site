# 2. Final homepage copy — EKORails.com

Live at `dist/ekorails/index.html`. This document is the copy of record; if the two differ, this
document wins and the page must be corrected.

---

## Hero

**Eyebrow:** EKORAILS LTD

**H1:** Settlement infrastructure for African trade.

**Supporting text:** EKORails is developing a compliance-first settlement and interoperability
platform designed to help regulated institutions and businesses move value across selected African and
global trade corridors.

**Status line (bordered, always visible):** Proposed pilot activities remain subject to regulatory and
partner approval. EKORails LTD is not licensed or supervised by any financial services regulator.

**Primary CTA:** Explore Institutional Partnerships → `/partners`
**Secondary CTA:** Review the Platform → `/platform`
**Third link:** Visit Eko Infrastructure Research → `https://ekoinfrastructure.com`

**Corridor visual.** One corridor only. Origination node labelled `ORIGINATION / NIGERIA MARKET`;
counterparty node drawn as a dashed outline labelled `COUNTERPARTY / TO BE PUBLISHED`; three markers
on the route for compliance validation, FX/value conversion and partner settlement. Caption: *One
proposed corridor. This schematic shows the single initial corridor described in EKORails LTD's
regulatory filing. It is not a network map, and no corridor shown is operating. Counterparty market:*
`[CONFIRM WITH EKORAILS]`.

No global network, no map of Africa, no flags, no animated coins.

---

## Section 1 — The problem

**Eyebrow:** THE PROBLEM

**H2:** Moving value across African trade corridors is still slower, costlier and harder to reconcile
than it should be.

**Intro:** Existing infrastructure is improving. Regional systems, domestic switches and bank networks
have all advanced in the last decade. What remains difficult is the specific, corridor-level work of
getting a business payment validated, converted, settled and evidenced end to end.

| Card | Heading | Body |
| --- | --- | --- |
| 01 — Cost | Costs remain high in many Sub-Saharan corridors | The average cost of sending money to and within Sub-Saharan Africa remains among the highest of any region measured by the World Bank's Remittance Prices Worldwide database, and business payments carry their own layered bank, correspondent and conversion charges. Corridor-level costs vary widely, and any figure EKORails publishes will be cited and dated. `[INSERT VERIFIED FIGURE — corridor cost baseline]` |
| 02 — FX availability | Currency access, not just currency price | For many businesses the binding constraint is not the quoted rate but whether the currency is available at the size and time required. Queuing for allocation, splitting orders across providers and holding balances defensively all impose real working-capital costs that do not appear in a headline spread. |
| 03 — Reconciliation | Payments arrive without the data that explains them | When a payment crosses several intermediaries, the invoice reference, the purchase order and the remittance detail frequently do not survive the journey. Finance teams then reconstruct by hand what the payment was for, which delays release of goods and inflates the true cost of the transaction well beyond the fee charged. |
| 04 — Compliance load | Duplicated checks at every hop | Each institution in a chain runs its own screening and due diligence, often on partial information. The result is repeated work, avoidable false positives, payments held for review and a support burden that falls on the customer rather than the chain. |
| 05 — Last mile | Final payout depends on local reach | Settlement between institutions is only part of the problem. Reaching the counterparty's account at a domestic bank, on a domestic switch, within domestic cut-off times, requires a licensed local partner in every market. Reach is earned market by market. |
| 06 — Fragmentation | Systems that do not yet speak to one another | Regional and domestic systems each solve part of the problem well. The gap that persists is interoperability: connecting a specific pair of markets, with a specific pair of institutions, under a specific set of rules, and evidencing the whole flow to a regulator's standard. |

**Footnote:** Every market statistic used on this website is sourced, dated and listed in the Eko
Infrastructure source register. Where a figure has not yet been verified against a primary source, it
is shown as a placeholder rather than published.

---

## Section 2 — What EKORails is building

**Eyebrow:** WHAT EKORAILS IS BUILDING
**H2:** Six capabilities, built in the order a regulated transaction actually needs them.
**Intro:** Each capability below is described exactly as it appears in EKORails LTD's regulatory filing
and supporting technical documentation. Nothing here is offered as a live service. Status labels are
applied consistently across this website.

| Capability | Status chip | Body |
| --- | --- | --- |
| Transaction orchestration | In development | A single instruction model that sequences validation, authorisation, conversion, settlement and confirmation across the parties to a transaction, and holds the state of that transaction until every leg is either complete or unwound. |
| Compliance and identity controls | In development | Verification of the originating and receiving parties, sanctions and watchlist screening, risk scoring and the transmission of required originator and beneficiary information with each instruction, so that partners receive complete data rather than partial data. |
| FX and liquidity coordination | Proposed | Coordination with licensed banks, authorised dealers and liquidity providers so that the conversion leg of a transaction is quoted, reserved and executed by an appropriately licensed counterparty. EKORails does not propose to act as a principal in currency conversion. |
| Corridor routing | Proposed | Selection of an approved route for a given corridor, currency pair and value band from the set of partners that are licensed and operationally available for that route, with the selection recorded and reportable. |
| Settlement confirmation | In development | Confirmation that the settlement leg has been completed by the licensed partner responsible for it, matched to the original instruction, and returned to both sides with the reference data needed to reconcile against an invoice or purchase order. |
| Audit and regulatory reporting | In development | An immutable, time-stamped record of every state change in a transaction, retained under a defined schedule, and reporting formats designed to meet the requirements agreed with the relevant regulator and partners for any approved pilot. |

**Status label callout:** *In development* means the component is being built and tested in a
non-production environment. *Proposed* means the design is documented and filed but implementation
depends on partner or regulatory outcomes. Nothing on this website is described as live, in production,
or carrying real customer value.

---

## Section 3 — Initial use cases

**H2:** Designed for institutional and business flows, within an approved pilot scope.
**Intro:** The customer groups and transaction types that would be included in any pilot are limited to
those set out in EKORails LTD's regulatory filing and agreed with partners. EKORails does not promote
unrestricted retail remittance.

Five cards — B2B trade invoice settlement · Institutional treasury movement · Approved supplier and
merchant payments · Regulated partner settlement · Corridor reconciliation and reporting — each with
three control bullets. A sixth card states the exclusions: *No unrestricted consumer remittance
product, no investment or savings product, no token offering, no lending, and no service marketed
directly to retail customers outside an approved pilot scope.*

---

## Section 4 — How a transaction would work

**H2:** Six steps — and a clear line between what EKORails does and what licensed partners do.
**Intro:** The description below is a design, not a live service. It is shown so that banks, regulators
and enterprise reviewers can see exactly where responsibility sits at every step.

| # | Step | EKORails does | Licensed partner does |
| --- | --- | --- | --- |
| 01 | Initiation | Instruction capture, validation, state | Originating account relationship |
| 02 | Identity and compliance validation | Screening orchestration, risk rules, case creation | Regulated customer due diligence, final AML decisioning |
| 03 | Transaction authorisation | Limit and workflow enforcement | Funds confirmation and debit authority |
| 04 | FX or value conversion | Quote request, rate capture, record | Execution as principal, rate provision, licensing |
| 05 | Partner settlement | Instruction, status tracking, exception handling | Custody of funds, settlement finality, local payout |
| 06 | Confirmation and audit reporting | Confirmation, audit record, reporting extracts | Statement entry, regulatory filings of record |

**Sidebar — Where the boundary sits:** EKORails is being designed as an orchestration, compliance and
record-keeping layer. In the model above it does not hold customer funds, does not act as principal in
currency conversion, does not provide settlement finality and does not operate a payout licence.

**Sidebar — Settlement asset and mechanism:** The settlement asset and mechanism proposed for the pilot
corridor are those set out in EKORails LTD's regulatory filing and are subject to regulatory review.
`[CONFIRM WITH EKORAILS — settlement asset as filed]` `[SUBJECT TO REGULATORY APPROVAL]`

---

## Section 5 — Regulatory pathway

**H2:** Where we actually are — stated plainly, and updated only when a stage is evidenced.
**Intro:** This tracker is maintained against documentary evidence. A stage is only marked complete when
EKORails LTD holds a document confirming it. No stage is ever shown ahead of its evidence.

| Stage | Chip | Note |
| --- | --- | --- |
| Entity incorporated | **Complete** | EKORails LTD is incorporated as the legal applicant and operating entity. Company number and registered office: `[CONFIRM WITH EKORAILS]` |
| Sandbox application | **Submitted** | EKORails LTD has applied to participate in the Central Bank of Nigeria Regulatory Sandbox. Date of submission and reference: `[CONFIRM WITH EKORAILS]` |
| Regulatory review | **Pending** | Participation, scope and conditions are determined by the regulator. EKORails LTD has received no decision, admission, approval or endorsement, and will publish the exact status granted if and when it is confirmed in writing. |
| Partner integration | **Not started** | Integration with licensed banking, liquidity and payout partners for the proposed corridor. Partner names are not published until each partner has agreed in writing to be named. |
| Controlled pilot | **Not started** | A limited pilot with a defined participant set, value caps, transaction caps and reporting obligations, conducted only if and as approved. |
| Post-pilot licensing pathway | **Not started** | Any move beyond a pilot would require the appropriate authorisation or licence in each market of operation. EKORails LTD holds no such licence today. |

If the sandbox application has been prepared but **not** submitted, change the second row's chip to
"Prepared" and the note to "Application prepared; not yet submitted", and change
`site.json → regulatory_status_html` on **both** sites in the same commit.

---

## Section 6 — Initial corridor

**H2:** One corridor, chosen deliberately, before any question of scale.
Definition list covering: the corridor · why it was selected · intended institutional users · the market
friction identified · required partners · proposed settlement flow · regulatory dependencies · pilot
success measurements. Success is defined by control effectiveness, not volume.

---

## Section 7 — Compliance by design

**H2:** The control framework is the product, not a layer added after it.
**Intro:** The controls below are the framework EKORails LTD is building and would operate under an
approved pilot. EKORails LTD does not hold any compliance or security certification, and does not claim
one. Where an audit or certification is completed, it will be named and dated.

Nine cards: customer and business verification · AML and CFT controls · sanctions screening ·
transaction monitoring · limits and velocity controls · suspicious activity escalation · data
protection · cybersecurity · audit trails and reporting.

---

## Section 8 — Institutional partnerships

**H2:** Infrastructure of this kind is built with institutions, not around them.
Seven category cards (banks and licensed payment institutions · enterprise and trade partners · FX and
liquidity providers · technology and cybersecurity providers · identity and compliance providers ·
regulators and policy institutions · research and development partners) plus a CTA card: **Discuss a
Partnership**.

---

## Section 9 — Leadership

**H2:** Named people, with responsibilities that can be checked.
Three cards: Mike Ogbebor (Founder), Compliance leadership (named compliance officer), Technology
leadership (named technology lead). Titles, qualifications and appointment dates are
`[CONFIRM WITH EKORAILS]` until supplied. No phrase of the "CBN-adjacent relationships" type appears
anywhere in the build.

---

## Section 10 — Eko Infrastructure bridge

**H2:** The research platform behind the thesis.
**Body:** Eko Infrastructure is the research, policy and market-intelligence platform operated by
EKORails LTD. It explains clearing, settlement, corridors and compliance in plain terms, with sources,
dates and named authors — including where existing systems already work well.

---

## Section 11 — Final CTA

**H2:** Help build the infrastructure behind African trade.
**Body:** Whether you supervise this market, operate in it, or depend on it, we would rather have a
precise conversation than a promotional one.

Buttons: **Institutional Partnership** (`/partners?type=institution`) · **Regulatory Inquiry**
(`/partners?type=regulator`) · **Enterprise Pilot Interest** (`/partners?type=enterprise`).

---

## Footer (every page, both sites)

**Regulatory status.** EKORails LTD has applied to participate in the Central Bank of Nigeria
Regulatory Sandbox. Participation and all proposed pilot activities remain subject to regulatory review
and approval. EKORails LTD is not licensed, authorised, approved, endorsed or supervised by the Central
Bank of Nigeria or by any other financial services regulator, and does not hold a payment services,
banking or money transmission licence in any jurisdiction. See the Regulatory Disclaimer.

**Disclaimer.** EKORails LTD is developing financial infrastructure for institutional and enterprise
use. Information on this website is provided for general and partnership purposes and does not
constitute financial, investment, legal or payment-services advice. Products, pilot activities and
services described may be subject to regulatory review, licensing, partner approval and geographic
restrictions.
