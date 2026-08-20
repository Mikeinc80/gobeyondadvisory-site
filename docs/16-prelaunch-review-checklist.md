# 16. Pre-launch regulatory and factual review checklist

To be completed by the named compliance officer, with counsel, before DNS cutover. Sign and date each
section. A "no" anywhere in Part A blocks launch.

---

## Part A — regulatory (blocking)

### A1. Licensing and status

- [ ] Does any page state or imply that EKORails LTD is licensed, authorised, approved, endorsed,
      registered or supervised by any regulator? **Must be: no.**
- [ ] Is the not-licensed statement present in the footer of every page on both sites?
- [ ] Does the sandbox statement match exactly what EKORails LTD can evidence today — applied, prepared,
      or admitted?
- [ ] Is documentary evidence of the current stage held on file and referenced in
      `content/regulatory-status.md`?
- [ ] Is sandbox participation described anywhere as a licence, or as permission to serve the public?
      **Must be: no.**
- [ ] Does any page imply that the CBN has reviewed, approved or endorsed EKORails, its platform or its
      documentation? **Must be: no.**
- [ ] Is the wording identical in both `site.json` files?

### A2. Capability and status labels

- [ ] Has the technology lead confirmed every "In development" and "Planned" label against the actual
      build state?
- [ ] Does any page describe a capability as live, operating, in production or carrying customer value?
      **Must be: no.**
- [ ] Does any page describe a corridor as active or operating? **Must be: no.**
- [ ] Is "architecture complete", or any equivalent, absent? **Must be: yes.**
- [ ] Are all six regulatory-pathway stages accurate, with no stage shown ahead of its evidence?

### A3. Investment and financial promotion

- [ ] Does any page constitute or resemble an offer, invitation or solicitation to invest?
      **Must be: no.**
- [ ] Are investment terms, equity offers, convertible notes, governance seats, partner economics and
      fundraising deadlines absent from both sites? **Must be: yes.**
- [ ] Does any form collect investment interest? **Must be: no.**
- [ ] Do legacy `/investors`, `/invest` and `/partners-and-investors` paths redirect to a page that
      states plainly that no investment is solicited?
- [ ] Is any token, coin or digital asset issued, offered, promoted or sold? **Must be: no.**
- [ ] Has counsel confirmed the position under the financial promotion rules of every market where the
      sites are accessible?

### A4. Guarantees and outcomes

- [ ] Any guarantee of transaction speed, settlement timing, cost saving, FX rate, FX availability,
      currency stability or spread elimination? **Must be: no.**
- [ ] Any claim that transactions are or will be compliant? **Must be: no.**
- [ ] Any claim that monitoring detects all illicit activity? **Must be: no.**
- [ ] Any certification, accreditation or audit claimed that is not held? **Must be: no.**
- [ ] Are the words "instant", "guaranteed", "always", "eliminates" and "zero cost" absent from claims
      about the platform?

### A5. Third parties

- [ ] Is every named partner covered by written consent to be named?
- [ ] Does any page imply a relationship with PAPSS, SWIFT, a central bank or a regulator?
      **Must be: no.**
- [ ] Is any named organisation criticised, attacked or characterised as failing? **Must be: no.**
- [ ] Are all references to other systems descriptive and accurate?
- [ ] Is the GoBeyond Advisory relationship described only in terms counsel has confirmed as legally and
      factually accurate?

### A6. Legal pages

- [ ] Privacy policy reviewed and approved by counsel; all placeholders resolved.
- [ ] Terms of use reviewed and approved; governing law and jurisdiction set.
- [ ] Regulatory disclaimer reviewed and approved.
- [ ] "Draft for legal review" callouts removed from those three pages, and only from those pages.
- [ ] Footer disclaimer matches the brief's required wording exactly.

## Part B — factual

### B1. Statistics

- [ ] Does every figure on either site have a source register entry?
- [ ] Is every entry used on a live page at status `verified` or `estimate` — never `pending`?
- [ ] Does every source name a primary publisher, a period and a retrieval date?
- [ ] Is every estimate labelled as an estimate, with its method published?
- [ ] Are there any superlatives or multiples without a cited dataset, year and definition?
      **Must be: no.**

### B2. Withdrawn claims

Run the forbidden-phrase grep in `docs/15-deployment-checklist.md` §5. Four files are expected to
match, because they carry the negations rather than the claims — `data-and-sources.html`,
`research/what-papss-does.html`, `corridors.html` and `search-index.json`. **Any other match is a real
finding.** Confirm no page asserts:
PAPSS adoption characterisations · "replacement play" · a universal SWIFT settlement time · spread
elimination · "cents on the dollar" · "every revenue dollar stays in Africa" · "every transaction is
compliant" · "architecture complete" · "active corridor" · a published launch date · "largest diaspora
corridor" · "three times the volume" · "$200 billion market" · "CBN-adjacent".

### B3. Company facts

- [ ] Legal name "EKORails LTD" used consistently, including in the footer and structured data.
- [ ] Company number and registered office published and correct.
- [ ] All four email addresses live and monitored.
- [ ] Leadership names, titles and dates correct, and photographs supplied or placeholders honestly
      retained.
- [ ] Corridor description matches the filing exactly, including anything deliberately withheld.

## Part C — editorial (Eko Infrastructure)

- [ ] Every article carries a named author, publication date, last-updated date, reading time, sources,
      related articles, a disclosure and regulatory note, and a link to the relevant EKORails page.
- [ ] The disclosure that EKORails LTD operates the platform appears in the first viewport of the
      research home page, not only in the footer.
- [ ] No article reads as advocacy for EKORails. Test: could a competitor's analyst read this and call
      it fair?
- [ ] PAPSS is described factually, with no adoption characterisation.
- [ ] SWIFT is described as a messaging network, with the messaging/clearing/conversion/settlement/payout
      distinction made.
- [ ] The corrections policy is published and the inbox is monitored.
- [ ] The editorial workflow is configured in the CMS and editors know the four states.

## Part D — technical and accessibility

- [ ] `python3 tools/check.py` exits 0.
- [ ] Lighthouse ≥ 95 on all four categories for the sampled pages.
- [ ] Keyboard-only and screen-reader passes completed and signed off.
- [ ] No horizontal overflow at 320px.
- [ ] Security headers verified live; zero CSP console violations.
- [ ] Forms tested end to end, including acknowledgement deliverability to an institutional domain.
- [ ] Redirect map fully tested; no chains; no 404s from legacy URLs.
- [ ] Rollback tested once, before launch.

---

## Sign-off

| Role | Name | Scope | Signature | Date |
| --- | --- | --- | --- | --- |
| Named compliance officer | `[CONFIRM]` | Parts A and B | | |
| Legal counsel | `[CONFIRM]` | A3, A5, A6 | | |
| Technology lead | `[CONFIRM]` | A2, Part D | | |
| Editor | `[CONFIRM]` | B1, B2, Part C | | |
| Founder | `[CONFIRM]` | Overall | | |

## Re-review triggers

Repeat the relevant parts whenever: the regulatory status changes; a partner is named for the first
time; a corridor detail is published; a capability moves between status labels; a new statistic is
published; a research article touching regulatory matters is published; or twelve months elapse.
