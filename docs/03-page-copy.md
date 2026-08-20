# 3. Final copy — every main page

The authoritative copy is the built HTML. This document records the **intent, structure and
non-negotiable sentences** of each page so that a reviewer can check the build against a specification
rather than against taste, and so that copy can be edited without losing the reasoning.

Homepage copy is in `docs/02-homepage-copy.md`.

---

# EKORails.com

## /platform — Platform

**H1:** A coordination layer for regulated cross-border transactions.
**Lede:** EKORails is being designed to sit between the institutions that already hold licences, funds
and market access — orchestrating the sequence, enforcing the controls and holding the record, without
taking on the functions that licensed institutions are there to perform.
**Status band:** The platform is in development. No component described on this page is operating in
production or carrying customer value.

Sections, in order:

1. **Platform overview** — a payment is a sequence of dependent actions by different institutions; the
   difficulty is holding the sequence together and being able to explain it afterwards.
2. **Participants** — eight-row table: originating business, originating bank, EKORails, FX/liquidity
   counterparty, settlement partner, payout institution, beneficiary business, regulator. Each row
   states the licensing expectation. The EKORails row says *No customer funds held.*
3. **Transaction lifecycle** — eleven states (`received`, `screening`, `held`, `authorised`, `quoted`,
   `converting`, `settling`, `settled`, `paid_out`, `returned`, `rejected`) with an owner for each.
   Failure states are first-class.
4. **System boundary** — three-column SVG with a legend: built by EKORails / performed by a licensed
   partner / external party. Caption repeats the four exclusions.
5. **Integration options** — direct API (under development), secure operator portal (planned),
   file-based batch (planned).
6. **API and messaging layer** — small resource set, idempotent submission, ISO 20022-aligned
   semantics `[CONFIRM WITH EKORAILS — message standard as filed]`, signed webhooks with polling
   fallback.
7. **Ledger and record-keeping** — append-only; corrections reference what they correct; *an
   operational and evidential ledger, not a store of customer value*; retention
   `[CONFIRM WITH EKORAILS]`.
8. **Settlement model** — asset and mechanism `[CONFIRM WITH EKORAILS]` `[SUBJECT TO REGULATORY
   APPROVAL]`, plus three commitments that hold regardless: finality from a licensed institution,
   customer funds with licensed institutions, and a reconstructible record. Explicit sentence: *EKORails
   does not issue, offer, promote or sell any token, coin or investment instrument.*
9. **Compliance controls** — enforced before routing; full framework cross-linked.
10. **Reporting** — operational, financial, supervisory; formats `[CONFIRM WITH EKORAILS]`.
11. **Resilience and business continuity** — RTO/RPO `[CONFIRM WITH EKORAILS]`, degraded-mode
    behaviour, reconciliation-first recovery, tested restores, exit and wind-down plan.
12. **Data handling** — lawful basis, minimisation, encryption, segregation, retention; NDPA 2023
    where applicable; residency `[CONFIRM WITH EKORAILS]`.
13. **Partner responsibilities** — eight-row split table (EKORails vs licensed partner).

## /use-cases — Use Cases

**H1:** Five flows, each one a real reconciliation problem before it is a payment problem.

Five accordions, each with: the situation · what EKORails is designed to do · what partners do ·
controls · status chip. Then an **out of scope** section listing eight exclusions, including
"unrestricted consumer or retail remittance marketed to the public", "any token, coin, digital asset
offering or investment instrument", "currency conversion as principal" and "custody of customer funds".

## /pilot-and-regulatory-pathway — Pilot and Regulatory Pathway

**H1:** Applied. Under review. Nothing more than that.
**Lede (verbatim, required):** EKORails LTD has applied to participate in the Central Bank of Nigeria
Regulatory Sandbox. Participation and all proposed pilot activities remain subject to regulatory review
and approval.

Sections: our evidence standard · six-stage status tracker · what a sandbox is / is not (two
side-by-side lists) · how we will describe an outcome · proposed pilot design (corridor, participants,
transaction types, value and volume caps, duration, reporting, success measures, exit and wind-down).

**Required sentence in "what a sandbox is not":** It is not a commercial operating licence.

## /corridors — Corridors

**H1:** One corridor. Proven, or not proven.
Sections: initial proposed corridor (eight-row definition list) · expansion (six conditions that must
be true before a second corridor) · where we sit (five-row complementarity table covering PAPSS, SWIFT,
domestic switches, central bank settlement systems and correspondent banking).

The complementarity table is descriptive. It contains no comparative superiority claim and no
criticism of any named organisation.

## /compliance-and-risk — Compliance and Risk

**H1:** The control framework, written for the people who will test it.
Fourteen accordions: governance · regulatory engagement · AML and CFT · KYC and KYB · sanctions ·
transaction monitoring · fraud prevention · suspicious activity escalation · data protection ·
cybersecurity · operational resilience · third-party and partner risk · record retention · complaints
and dispute handling.

Sidebar carries the required line **For compliance and regulatory inquiries:
compliance@ekorails.com** and a "what we do not claim" box: no certification, no regulatory approval,
no claim that every transaction is compliant, no claim that monitoring detects all illicit activity, no
guarantee of uptime, timing or outcome.

## /technology — Technology

**H1:** Engineered for evidence, not for demonstration.
Sections: six engineering principles · eleven-component register with status chips · data model ·
security posture · environments and testing · observability · **decisions we have deliberately not
made** (settlement asset, hosting region, vendors, netting).

Explicit sentence: *Specific configurations, network topology, control thresholds and vendor names are
not published on this website, because publishing them would help an attacker more than a reviewer.*

## /partners — Institutional Partnerships

**H1:** Built with institutions, or not built at all.
**Status band (required):** This page is for institutional, enterprise, technology, regulatory and
research partnerships only. EKORails does not solicit investment through this website, does not publish
investment terms and does not accept investment enquiries through this form.

Seven partner categories, each with a "first conversation" line. Then the enquiry form (see
`docs/13-form-specifications.md`) with an in-form callout repeating the no-investment rule.

## /leadership — Leadership

**H1:** Named people, named responsibilities.
**Status band:** EKORails does not describe relationships with regulators, officials or institutions as
a qualification. Where an individual has held a regulated role, it is stated with the institution and
the dates so that it can be verified.

Three people cards (Founder, Head of Compliance, Head of Technology) with placeholder portraits until
photographs are supplied; a "roles not yet appointed" callout; a governance definition list including
board, compliance authority, risk review cadence, advisers, the **GoBeyond Advisory** relationship
(`[CONFIRM WITH EKORAILS]`) and conflicts of interest.

## /news — News and Updates

**H1:** What changed, when, and what proves it.
Publication standard callout, three evidence-gated entries (sandbox application, incorporation, research
platform), an editorial note confirming the list is complete, and an institutional update-list form.

## /contact — Contact

Four routed cards (info@, partnerships@, compliance@, media@), registered details definition list,
a "what we cannot help with" box (investment enquiries, retail queries, confirming a status we do not
hold, naming partners without consent) and a security-disclosure box.

## /privacy-policy, /terms-of-use, /regulatory-disclaimer

Full drafts in `docs/11-legal-drafts.md`. Each carries a visible "draft for legal review" callout on the
page itself until counsel signs off.

---

# EkoInfrastructure.com

## / — Research

**H1:** Research and intelligence for African settlement infrastructure.
**Lede:** Clearing, settlement, corridors, compliance and payment policy — explained carefully, with
sources, dates and named authors. Including, often, the finding that an existing system already does
the job well.

Hero carries a **Who publishes this** disclosure box in the first viewport, not in a footer.
Then: five topic cards · latest research list · disclosure bridge to EKORails.

## /settlement-explained

**H1:** Settlement, explained.
Seven sections: what settlement means · clearing versus settlement · correspondent banking · FX and
liquidity · settlement finality · stable-value settlement models · the five things people call "a
payment" (five-row table: messaging, clearing, conversion, settlement, payout).

Required position on stable-value models: *Eko Infrastructure does not take the position that
stable-value settlement is either the answer or a distraction.* And: *Any claim that a stable-value
model removes foreign exchange cost, eliminates spread or guarantees value stability is not supported
by the mechanics.*

## /corridor-intelligence

**H1:** Corridor intelligence.
Six-step method (participants, flows, cost stack, friction points, last mile, regulatory perimeter) ·
a data-quality table that grades five questions from *reasonable* to *very poor* · corridors we follow
(four, each marked "in research") · a note on corridor superlatives.

## /policy-and-regulation

**H1:** Policy and regulation.
Sandboxes (including the four "is not" bullets) · licensing categories · AML and CFT expectations ·
data protection · regional and continental policy · **how to read a firm's regulatory claims** (five
questions, explicitly applied to EKORails itself).

## /technology

**H1:** Technology.
Messaging standards · compliance architecture (three design decisions) · transaction monitoring (with
two claims to treat sceptically) · auditability · what distributed ledger designs change and do not
change · data sovereignty.

## /glossary

Fourteen letter groups, A–V, ~35 terms. Contested terms are marked as contested. Cross-links to the
long-form explainers.

## /data-and-sources

Six sourcing rules · the twelve-row source register with status chips · **claims we do not make** (the
full withdrawn-claims list from the brief) · corrections process.

## /ekorails

Disclosure page: what EKORails is building · regulatory status (in a bordered callout, verbatim) · the
relationship between the two platforms · how we handle the conflict (three checkable practices).

## /about

Purpose · disclosure · six editorial standards · four-state review workflow table · corrections ·
citing and reusing.

## /contact

Research and media contact form with an enquiry-type selector including "Correction to a published
piece", plus direct addresses for all four inboxes.

## /research/<slug> — articles

Four seeded pieces. Every article carries, without exception: named author · publication date · last
updated date · reading time · a source list with retrieval dates · related articles · a disclosure and
regulatory note callout · a link to the relevant EKORails page.
