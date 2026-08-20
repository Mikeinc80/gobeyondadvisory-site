# 7. Regulatory claim register

Every claim published on either website that touches regulatory status, licensing, capability,
partners, performance or market facts. This is the document a supervisor, a bank's second line or
counsel should be handed first.

**Owner:** named compliance officer, EKORails LTD `[CONFIRM WITH EKORAILS]`
**Review cycle:** before every deploy that changes a claim, and at minimum quarterly.
**Rule:** if a claim is not in this register, it must not be on the website.

Risk key — **H**: could be read as an implied licence, investment offer or guarantee.
**M**: could be read as premature or unsupported. **L**: descriptive.

---

## 7.1 Claims made (published)

| # | Claim as published | Where | Basis | Risk | Control applied |
| --- | --- | --- | --- | --- | --- |
| C-01 | "EKORails LTD has applied to participate in the Central Bank of Nigeria Regulatory Sandbox. Participation and all proposed pilot activities remain subject to regulatory review and approval." | Footer (all pages, both sites), `/pilot-and-regulatory-pathway`, `/regulatory-disclaimer`, `/ekorails` | The filing itself | H | Verbatim wording supplied by the client brief. Held in one place per site (`site.json`). **Requires evidence of submission before launch — `[CONFIRM WITH EKORAILS]`.** If prepared but not submitted, change to "has prepared an application to participate in…" on both sites in one commit. |
| C-02 | "EKORails LTD is not licensed, authorised, approved, endorsed or supervised by the Central Bank of Nigeria or by any other financial services regulator…" | Footer (all pages), `/regulatory-disclaimer` §1, hero status bands | Fact | H | Stated affirmatively and unprompted, not buried. Must be removed only if and when a status is actually granted. |
| C-03 | "Proposed pilot activities remain subject to regulatory and partner approval." | Home hero status line | Fact | H | Sits inside the first viewport, in a bordered band, not below the fold. |
| C-04 | A sandbox "is not a commercial operating licence." | `/pilot-and-regulatory-pathway`, `/regulatory-disclaimer` §2, `/policy-and-regulation` | Fact | H | Stated on both sites, including on the neutral research platform. |
| C-05 | Capability descriptions labelled "In development" | Home, `/platform`, `/technology` | Internal build state | M | Chip on every capability. Definition of the label published on the home page. **Each component's state must be confirmed against the build before launch.** |
| C-06 | Capability descriptions labelled "Proposed" / "Planned" | Home, `/platform`, `/technology` | The filing | M | Same chip system; definitions published. |
| C-07 | "EKORails does not propose to act as a principal in currency conversion." | Home, `/platform`, `/technology` | The filing / design | H | Repeated at every point where conversion is described; also in the boundary diagram legend. |
| C-08 | "Customer funds are held by licensed institutions, not by EKORails." | Home §4, `/platform` participants and boundary | The filing / design | H | This is the single most important boundary claim for a bank reviewer. Repeated four times across the site. |
| C-09 | "EKORails does not provide settlement finality." | `/platform`, `/corridors`, `/research/swift-is-a-messaging-network` | Design | H | Stated as a limitation, never as a feature. |
| C-10 | The six-stage regulatory tracker states | Home §5, `/pilot-and-regulatory-pathway` | Documentary evidence | H | Published evidence standard: a stage is complete only when a document exists. **Stage 1 (incorporation) requires the certificate before launch.** |
| C-11 | "Entity incorporated — Complete" | Tracker | Certificate of incorporation | H | `[CONFIRM WITH EKORAILS]` — company number and registered office must be published alongside. |
| C-12 | Nigeria named as the origination market | Home hero figure, `/corridors` | The CBN filing implies Nigerian scope | M | Counterparty market is deliberately *not* named and shown as a dashed, unpublished node. |
| C-13 | "Cross-border payment costs remain high in many Sub-Saharan African corridors" | Home §1, `/settlement-explained` | World Bank RPW | M | Attributed to a named dataset; corridor figure held as `[INSERT VERIFIED FIGURE]` (source S-001). |
| C-14 | Descriptions of PAPSS | `/corridors`, `/research/what-papss-does` | PAPSS official material | M | Descriptive only. No adoption characterisation. No "replacement" framing. Source S-004 must be verified. |
| C-15 | "SWIFT is primarily a financial messaging network" | `/corridors`, `/settlement-explained`, `/research/swift-is-a-messaging-network` | SWIFT documentation | L | Descriptive; the article explicitly refuses the "three to five days" generalisation. |
| C-16 | "Correspondent banking relationships have declined in several regions" | `/settlement-explained` | FSB / BIS reporting | M | Figure held as a placeholder (source S-002) until verified. |
| C-17 | Compliance framework descriptions | `/compliance-and-risk`, home §7 | Internal policies | M | Framed as "the framework we are building and would operate under an approved pilot". Accompanied by an explicit "no certification held" statement. |
| C-18 | "EKORails LTD holds no compliance or security certification and claims none." | `/compliance-and-risk` | Fact | H | Prevents implied-certification readings. |
| C-19 | "EKORails does not claim that monitoring detects all illicit activity." | `/compliance-and-risk`, `/technology` (Eko) | Fact | M | Directly replaces the withdrawn "every transaction is compliant" claim. |
| C-20 | Leadership responsibilities | `/leadership` | Internal | M | Names and appointment dates `[CONFIRM WITH EKORAILS]`. No relationship-based credentialling. |
| C-21 | GoBeyond Advisory relationship | `/leadership` | `[CONFIRM WITH EKORAILS]` | H | Published only if legally and factually accurate. EKORails LTD is stated as the legal applicant and operating entity throughout. |
| C-22 | Eko Infrastructure "is a commercially operated knowledge platform, not an independent academic or standards body" | Eko footer (all pages), `/about`, `/ekorails` | Fact | M | Disclosure appears in the first viewport of the research home page, not only in the footer. |
| C-23 | "No corridor described is operating." | `/corridors`, `/platform`, `/ekorails` | Fact | H | Replaces the withdrawn "active corridor" claim. |
| C-24 | Article "In one line" summaries | Eko articles | Editorial | L | Summaries of the article's own argument, not claims about EKORails. |

---

## 7.2 Claims removed, and what replaced them

Each of these appeared in, or was proposed for, the previous ECO-branded material. None appears
anywhere in this build. `tools/check.py` plus the pre-launch checklist should be extended with a
forbidden-phrase grep before launch.

| Removed claim | Why it fails | Published replacement |
| --- | --- | --- |
| "PAPSS has near-zero adoption." | Unsourced, and adoption of a central-bank-mediated system is not comparable to a consumer product. Reads as an attack. | `/research/what-papss-does`: what it does, who participates, and *"We do not publish either claim"* about adoption. |
| "PAPSS replacement play." | Miscategorises the architecture and is an attack on an institution operating with central banks. | `/corridors`: "Potentially complementary… EKORails is designed as an orchestration and reconciliation layer, not an alternative settlement system." |
| "SWIFT takes 3 to 5 business days." | False as a universal statement; SWIFT carries messages, not value. | `/research/swift-is-a-messaging-network`: five actual causes of delay, four of which persist regardless of technology. |
| "Stablecoin settlement eliminates FX spread loss entirely." | Mechanically false — conversion still occurs and is still compensated. Also a guaranteed-outcome claim. | `/settlement-explained`: "Any claim that a stable-value model removes foreign exchange cost, eliminates spread or guarantees value stability is not supported by the mechanics." |
| "Cents on the dollar." | Unverified pricing claim; implies a guaranteed outcome. | Cost discussed as a described problem with a cited dataset; corridor baseline held as `[INSERT VERIFIED FIGURE]`. |
| "Every revenue dollar stays in Africa." | Unverifiable and irrelevant to a supervisor. | Not replaced. Removed entirely. |
| "Every transaction is compliant." | No firm can make this claim. Implies certification. | "EKORails LTD does not represent that any transaction, participant or activity is or will be compliant" (`/regulatory-disclaimer` §5). |
| "Architecture complete." | Not documented; contradicted by the build state. | Eleven-component register with per-component status, plus an explicit "decisions we have deliberately not made" section. |
| "Active corridor." | No corridor is legally operating. | "No corridor described on this page is operating." |
| "Full launch Q4 2026." | Not supported by an execution plan and depends on regulatory outcomes. | No launch date published anywhere. `/pilot-and-regulatory-pathway`: "EKORails does not publish expected decision dates." |
| "Largest diaspora corridor globally." | No reliable source; "largest" is definition-dependent. | `/corridor-intelligence`: "On corridor superlatives" — comparative claims require a cited dataset, year and definition. |
| "Three times the volume." | No cited data source. | Removed. Data-quality table published instead. |
| "$200 billion market." | No transparent calculation. | `/research/reading-a-trade-corridor`: "Why market-size analysis fails here", plus rule 04 in the sourcing rules. |
| Direct attacks on PAPSS, SWIFT, Wise, Western Union, OPay and others | Reputationally damaging with regulators and banks; not analysis. | Descriptive complementarity table. No named competitor is criticised on either site. |
| "CBN-adjacent relationships" | Implies regulatory influence; a supervisor reads this as a red flag. | `/leadership`: "EKORails does not describe relationships with regulators, officials or institutions as a qualification." |

---

## 7.3 Standing language rules for anyone editing either site

1. Never state or imply CBN (or any regulator) licensing, authorisation, approval, endorsement or
   supervision. The words *licensed*, *authorised*, *approved*, *regulated by* and *supervised* may only
   appear in a negative or a partner-attributed sentence.
2. Sandbox admission is never described as a licence.
3. Future capability uses only: *designed to support*, *proposed*, *being developed*, *intended*,
   *subject to regulatory approval*.
4. No guaranteed transaction speed, savings, FX stability or spread elimination. No "instant",
   "guaranteed", "always", "eliminates", "zero cost".
5. No investment terms, equity offers, convertible notes, governance seats, partner economics or
   fundraising deadlines on either website, and no investment enquiries accepted through the forms.
6. No partner named without written consent. No regulator named as a relationship.
7. No statistic without a source register entry. Unverified figures render as visible placeholders.
8. No comparative claim against a named organisation.
9. Any change to C-01, C-02, C-04, C-10 or C-11 requires named-compliance-officer approval, recorded in
   `content/regulatory-status.md`, and must be applied to both sites in the same commit.

---

## 7.4 Open items blocking launch

| Item | Register ref | Owner |
| --- | --- | --- |
| Evidence of sandbox submission (date, reference) | C-01, C-10 | Compliance officer |
| Certificate of incorporation, company number, registered office | C-11 | Company secretary |
| Confirmation of every component status label | C-05, C-06 | Technology lead |
| Named compliance officer and technology lead, with dates | C-20 | Founder |
| Legal position on describing the GoBeyond Advisory relationship | C-21 | Counsel |
| Corridor counterparty market — publish or keep withheld | C-12 | Compliance officer |
| Verification of sources S-001 to S-011 | C-13 – C-16 | Editor |
| Counsel sign-off on privacy policy, terms and disclaimer | — | Counsel |
