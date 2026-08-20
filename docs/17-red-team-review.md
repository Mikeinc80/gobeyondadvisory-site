# 17. Red-team review

Six adversarial reads of the built sites, each from a reviewer with a different reason to say no. The
findings are the ones that survived: statements that could still be read as misleading, premature,
unsupported, an implied licence, an implied investment offer, a guaranteed outcome, an attack on an
industry participant, or inconsistent with the CBN filing.

Severity — **BLOCKER**: do not launch. **HIGH**: fix before launch. **MEDIUM**: fix or accept with a
recorded rationale. **LOW**: monitor.

---

## 17.1 Central Bank of Nigeria

*Reading as: a supervisor deciding whether this applicant is candid, and whether their public
statements will embarrass the Bank.*

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| CBN-1 | The site states "EKORails LTD **has applied**". If the application has only been *prepared*, that sentence is false on the day of launch — and a false statement about the Bank's own process is the worst possible opening. | **BLOCKER** | Open. `[CONFIRM WITH EKORAILS]`. §5 of the deployment checklist blocks launch on this. |
| CBN-2 | The tracker shows "Entity incorporated — Complete" with the company number as a placeholder. Claiming a completed stage while withholding its evidence is exactly the pattern the evidence standard is meant to prevent. | **HIGH** | Open. Publish the number and registered office, or downgrade the chip. |
| CBN-3 | The home page corridor figure names Nigeria as the origination market. Nigeria is inferable from the filing, but the graphic should not run ahead of what the filing says about direction and scope. | **MEDIUM** | Verify against the filing. If the filing describes inbound rather than outbound flow, correct the label. |
| CBN-4 | Six pages say the site describes the platform "exactly as it appears in the filing". A supervisor can and will check that. Any divergence turns a design document into a candour problem. | **HIGH** | A line-by-line reconciliation of every capability, use case, participant and control against the filing is required before launch. |
| CBN-5 | The research platform explains what a sandbox is and is not. Helpful, but if the explanation diverges from the Bank's own framework it will read as the applicant reinterpreting the rules. | **MEDIUM** | Align `/policy-and-regulation` wording to the CBN framework document (source S-007) once verified. |
| CBN-6 | Publishing an evidence-based status tracker is unusual and favourable. It also creates a standing obligation: if the tracker is stale after a decision, the failure is more visible than if it had never existed. | **LOW** | Add tracker review to the compliance officer's standing agenda; the page already carries a "last reviewed" field. |
| CBN-7 | The disclaimer says the company "does not operate a settlement system". Under some readings, orchestration plus a shared record could be argued to fall within a settlement-system definition. | **MEDIUM** | Counsel to confirm the characterisation against the Nigerian definition, and to confirm the description matches the filing. |

**Overall:** the posture is defensible. The exposure is not in the language; it is in the placeholders.
Launching with CBN-1 unresolved would undo everything the language achieves.

## 17.2 A Nigerian commercial bank

*Reading as: a second-line reviewer deciding whether to spend six months integrating.*

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| BANK-1 | No named compliance officer. A bank cannot onboard a third party whose compliance accountability is a placeholder — this is usually where the file stops. | **BLOCKER for partnership** (not for launch) | Open. `[CONFIRM WITH EKORAILS]`. |
| BANK-2 | No named partners anywhere. Correct and honest, but it means a reviewer cannot tell whether anyone else has said yes. | **MEDIUM** | Accept. The alternative — implying partners who have not consented — is worse. Name the first partner the day consent is written. |
| BANK-3 | The boundary diagram is the strongest asset on the site for this reader, and it sits ten screens down the platform page. | **MEDIUM** | Consider a direct link from the home page transaction-flow sidebar (present) and from the primary navigation. |
| BANK-4 | "EKORails does not hold customer funds" is stated four times but never in the form a bank needs: which specific licence covers each leg, and what happens on the insolvency of each party. | **HIGH** | **Partly addressed** — `/platform#insolvency` now covers insolvency and wind-down in both directions. Licence mapping per leg still to be confirmed against the filing. |
| BANK-5 | No penetration test, no certification, no audit. Stated honestly, but it means the security questionnaire will come back with gaps. | **MEDIUM** | Accept for now. Commission the test before partner integration; the page already commits to naming provider and date. |
| BANK-6 | Settlement asset is a placeholder. A bank cannot assess counterparty and legal risk without it. | **HIGH** | Resolve from the filing before partner conversations. |
| BANK-7 | The volume-range field in the partnership form invites a number the enquirer cannot commit to, and a sales team may later treat as a forecast. | **LOW** | Hint already states it is indicative. Accept. |

## 17.3 A GCC banking partner

*Reading as: a correspondent or liquidity counterparty in Dubai or Riyadh assessing a new African
counterparty.*

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| GCC-1 | The corridor page discusses Africa–GCC trade as a research interest. A GCC reader may nonetheless read it as a pipeline commitment. | **MEDIUM** | Mitigated: the section states explicitly that no Africa–GCC corridor is proposed, filed or in development. Keep that sentence adjacent to any future GCC content. |
| GCC-2 | Everything is Nigeria-anchored, including the regulator, the data protection regime and the corridor. A GCC institution's first question — which regulator supervises the arrangement my side — is unanswered. | **HIGH** | Add a "supervision in the counterparty market" line to `/corridors` once the counterparty market is published. |
| GCC-3 | Sanctions coverage says "applicable lists for both markets in the corridor" without naming regimes. A GCC compliance team will want OFAC, UN, EU, UK and local coverage stated. | **MEDIUM** | Name the regimes on `/compliance-and-risk` once the screening provider is selected. |
| GCC-4 | No Arabic content and no mention of jurisdictional restrictions for GCC users. | **LOW** | Accept at this stage; the audience reads English professionally. Revisit if a GCC corridor is ever filed. |
| GCC-5 | "African-led" positioning is implicit in the brand rather than stated. For a GCC partner assessing local standing, that is a missed credential — but stating it without substance would be worse. | **LOW** | Accept. Let the leadership page carry it once names and histories are published. |

## 17.4 An institutional investor

*Reading as: someone assessing whether this is investable — and, more importantly for us, whether the
site accidentally solicits them.*

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| INV-1 | Does anything constitute an offer or invitation? Reviewed page by page: no investment terms, no economics, no fundraising language, no "contact us to invest", and the partnership form carries a visible exclusion. | **PASS** | The `/investors` redirect landing on a page that says no investment is solicited is the right handling. |
| INV-2 | "Help build the infrastructure behind African trade" is aspirational and sits above three buttons. In a financial-promotion analysis, aspirational language plus a call to action is the pattern regulators look at. | **MEDIUM** | Mitigated: none of the three buttons is investment-related and all lead to a partnership form. Counsel to confirm under A3 of the pre-launch checklist. |
| INV-3 | No traction, no partners, no revenue, no team detail. Honest, and it means an investor cannot form a view from the site — which is the intended outcome. | **PASS** | Accept. |
| INV-4 | An investor may email `partnerships@` anyway. Without a documented response, someone will improvise a reply that constitutes a promotion. | **MEDIUM** | Add a standard response to the inbox procedure: EKORails does not discuss investment through public channels; enquiries handled separately under the appropriate process. `[CONFIRM WITH EKORAILS]` |
| INV-5 | The market opportunity is deliberately not quantified anywhere. A commercial reader will find that unsatisfying. | **LOW** | Accept — it is the direct consequence of removing the "$200 billion market" claim, and the right trade. |

## 17.5 A cybersecurity reviewer

*Reading as: someone probing both the site and what it discloses about the platform.*

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| SEC-1 | Strict CSP with per-page SHA-256 hashes for inline JSON-LD, `frame-ancestors 'none'`, HSTS preload, no third-party scripts. | **PASS** | Verify zero console violations on the live deploy. |
| SEC-2 | `style-src` allows `'unsafe-inline'` because pages use inline `style` attributes. This weakens the policy against style-based injection. | **MEDIUM** | Recorded as technical debt. Move inline styles to utility classes and drop the allowance. |
| SEC-3 | `/admin` can write to the repository. If the CMS bundle were loaded from a CDN, a CDN compromise would mean repository write access. | **HIGH — mitigated** | The bundle is vendored and the route carries its own restricted CSP. **Enforce invite-only Identity and mandatory 2FA at deploy.** |
| SEC-4 | The site withholds specific security configuration. Correct — but the compliance page does describe control categories in enough detail to inform a social-engineering approach. | **LOW** | Accept. The categories are industry-standard; withholding them would cost more in credibility than it buys. |
| SEC-5 | Forms rely on a honeypot and a timing check, with no CAPTCHA. Determined abuse will get through. | **MEDIUM** | Accept deliberately, with rate limiting at the host layer and CAPTCHA held in reserve. |
| SEC-6 | Form submissions containing partner and licensing detail sit in a third-party form store. | **MEDIUM** | Set retention, export cadence and access review (`docs/13` §13.5). Resolve `[CONFIRM WITH EKORAILS]`. |
| SEC-7 | No `security.txt`, and the vulnerability disclosure policy is a placeholder. | **MEDIUM** | **Partly addressed** — `/.well-known/security.txt` now ships on both sites, pointing at `compliance@ekorails.com`. The full coordinated disclosure policy on `/contact` is still `[CONFIRM WITH EKORAILS]`. |
| SEC-8 | The build is a small, dependency-free Python script — no supply chain to compromise, no `node_modules`. | **PASS** | Keep it that way. The CMS bundle is the only vendored dependency; pin and review it. |

## 17.6 A sceptical enterprise customer

*Reading as: a CFO or treasurer at a business that already moves money on this corridor.*

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| ENT-1 | Nothing on the site tells me when I could use this. No date, no waitlist position, no pilot criteria. | **HIGH** | **Addressed** — `/use-cases` now publishes six participation criteria and the six-step order in which things would happen, with no date. |
| ENT-2 | Every capability is "in development" or "proposed", and the corridor's counterparty market is withheld. A sceptic will conclude there is nothing to evaluate. | **MEDIUM** | Accept. Publishing the counterparty market the moment the filing permits is the single strongest available fix. |
| ENT-3 | The problem statement is genuinely well observed — reference data loss, availability versus price, duplicated checks. This is the site's most persuasive content and it sits above the fold in section 1. | **PASS** | Keep it there. |
| ENT-4 | "Typical response time" on the partnership form is a placeholder. Leaving it unresolved at launch tells a sceptic exactly what they suspect. | **HIGH** | Resolve. A stated 5 business days that is met beats an unstated one. |
| ENT-5 | No pricing information of any kind, not even a model. | **MEDIUM** | Accept pre-approval. Publish the fee model, not a number, once the pilot scope is fixed. |
| ENT-6 | The leadership page shows placeholder portraits for two of three roles. To this reader it says the team is one person. | **HIGH** | Resolve, or state plainly that the roles are being recruited and by when — the page already frames this honestly, but placeholders undercut it. |
| ENT-7 | No case study, no testimonial, no logo wall — because there is nothing true to put there. | **PASS** | Accept. A fabricated logo wall is the specific failure this rebuild exists to correct. |

---

## 17.7 Consolidated actions

### Blocking launch

1. **CBN-1** — confirm the sandbox application has been *submitted*, or change the wording on both
   sites in one commit.
2. **§5 of the deployment checklist** — resolve or consciously retain every placeholder.
3. **CBN-4** — reconcile every capability, use case, participant and control against the filing,
   line by line.

### Before launch

4. **CBN-2 / B3** — publish company number and registered office.
5. **BANK-1 / ENT-6 / C-20** — name the compliance officer and technology lead, with dates and
   photographs, or state the recruitment position explicitly.
6. **BANK-4** — confirm the licence mapping per transaction leg against the filing (insolvency and wind-down handling now published).
7. **BANK-6** — resolve the settlement asset and mechanism from the filing.
8. **ENT-4** — publish a response-time commitment and meet it.
9. **SEC-7** — publish the coordinated disclosure policy on `/contact` (`security.txt` now shipping).
10. **SEC-3** — enforce invite-only Identity with mandatory 2FA.
11. **A6** — counsel sign-off on the three legal pages; remove the draft callouts.

### Accepted with rationale

- No named partners (BANK-2), no certifications (BANK-5), no market size (INV-5), no case studies
  (ENT-7), no CAPTCHA (SEC-5), no pricing (ENT-5). Each is the deliberate consequence of the rule that
  nothing is published without evidence. Each is also a reason a reader may leave — which is the correct
  trade for this audience at this stage.

### Standing risks

- **Staleness.** The evidence-based tracker, the source register and the review dates all create
  obligations. A published commitment that is not maintained is worse than one never made.
- **Drift.** The claim register works only if it is consulted before publication. It is a gate, not a
  document.
- **Placeholders in production.** The `[CONFIRM WITH EKORAILS]` markers are deliberately visible so
  they cannot be shipped by accident. If any survives launch, it becomes the most quoted thing on the
  site.

---

## 17.8 The overall judgement

The substance carries the seriousness here, not the language. That is the requirement the brief set,
and it is the right one — but it has a cost, and it should be stated plainly rather than glossed:
**this site is only as credible as the facts that replace its placeholders.** The framing, the
evidence standard, the boundary diagram and the withdrawal of the old claims are all defensible today.
The named officer, the company number, the settlement asset and the filing reconciliation are not
optional polish; they are the difference between a site that reads as rigorous and one that reads as
rigorous *about having nothing yet*.
