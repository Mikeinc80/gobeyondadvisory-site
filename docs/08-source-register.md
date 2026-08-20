# 8. Source register — all statistics and factual claims

Published version: `https://ekoinfrastructure.com/data-and-sources`.
Machine-readable version: `content/sources/` (one file per entry, editable in the CMS).

**Rule:** a figure may appear on either website only if it has an entry here with status
`verified` or `estimate`. Entries at `pending` render on the site as a visible placeholder.

---

## 8.1 Sourcing rules

1. **Primary source or nothing.** Cite the body that produced the data, not an article about it.
2. **Date everything.** Period covered plus retrieval date.
3. **Definitions travel with numbers.** State what was counted and how.
4. **Estimates are labelled.** Show inputs, assumptions and arithmetic; call the output an estimate.
5. **No superlatives without a dataset.** "Largest", "fastest growing" and multiples need a named
   dataset, a year and a definition.
6. **Placeholders, not guesses.** An unverified figure renders as `[INSERT VERIFIED FIGURE]`.

---

## 8.2 The register

| ID | Claim or figure | Primary source | Period | Retrieved | Used on | Status |
| --- | --- | --- | --- | --- | --- | --- |
| S-001 | Cost of sending remittances to and within Sub-Saharan Africa, by corridor | World Bank, *Remittance Prices Worldwide* | `[QUARTER]` | `[DATE]` | ekorails `/` §1; eko `/settlement-explained` | **pending** |
| S-002 | Decline in active correspondent banking relationships | Financial Stability Board; BIS CPMI | `[YEAR]` | `[DATE]` | eko `/settlement-explained` | **pending** |
| S-003 | Recorded bilateral merchandise trade, Nigeria ↔ counterparty market | UN Comtrade; national statistics office | `[YEAR]` | `[DATE]` | eko `/corridor-intelligence`; ekorails `/corridors` | **pending** |
| S-004 | PAPSS operating model, participants and scope | PAPSS / Afreximbank official material | `[YEAR]` | `[DATE]` | eko `/research/what-papss-does`; ekorails `/corridors` | **pending** |
| S-005 | Function and scope of the SWIFT network | SWIFT official documentation | `[YEAR]` | `[DATE]` | eko `/research/swift-is-a-messaging-network` | **pending** |
| S-006 | ISO 20022 migration status by market | ISO 20022; market infrastructure operators | `[YEAR]` | `[DATE]` | eko `/technology` | **pending** |
| S-007 | CBN Regulatory Sandbox framework and its terms | Central Bank of Nigeria | `[YEAR]` | `[DATE]` | eko `/policy-and-regulation`; ekorails `/pilot-and-regulatory-pathway` | **pending** |
| S-008 | Nigeria Data Protection Act 2023 obligations | Nigeria Data Protection Commission | 2023 | `[DATE]` | eko `/policy-and-regulation`; ekorails `/privacy-policy`, `/platform` | **pending** |
| S-009 | FATF Recommendations, incl. R.16 wire transfer information | Financial Action Task Force | `[EDITION]` | `[DATE]` | eko `/policy-and-regulation`, `/technology`; ekorails `/compliance-and-risk` | **pending** |
| S-010 | Settlement finality definitions | CPMI–IOSCO, *Principles for Financial Market Infrastructures* | `[EDITION]` | `[DATE]` | eko `/settlement-explained`, `/glossary` | **pending** |
| S-011 | Intra-African trade values; AfCFTA context | Afreximbank *African Trade Report*; AfCFTA Secretariat | `[YEAR]` | `[DATE]` | eko `/corridor-intelligence`, `/policy-and-regulation` | **pending** |
| S-012 | Corridor cost stack baseline for the proposed pilot corridor | EKORails LTD internal modelling | `[PERIOD]` | — | ekorails `/corridors` | **estimate — method not yet published** |

Additional entries required before the corresponding figure is published:

| ID | Claim | Likely source | Blocks |
| --- | --- | --- | --- |
| S-013 | Corridor FX availability evidence | Participant interviews; central bank data | eko `/settlement-explained` §FX |
| S-014 | Current regulatory treatment of stable-value instruments by jurisdiction | Each regulator's own publications | eko `/settlement-explained` §stable-value |
| S-015 | Data residency requirements by market | Each regulator / data protection authority | eko `/technology` §data sovereignty |
| S-016 | Licensing category table by market | Each central bank / regulator | eko `/policy-and-regulation` §licensing |
| S-017 | Published cross-border payment performance data | BIS CPMI; SWIFT tracker reporting | eko `/research/swift-is-a-messaging-network` |
| S-018 | Pilot success thresholds as filed | CBN filing | ekorails `/`, `/corridors`, `/pilot-and-regulatory-pathway` |
| S-019 | Pilot value and volume caps as filed | CBN filing | ekorails `/pilot-and-regulatory-pathway` |

---

## 8.3 Verification procedure (per entry)

1. Retrieve the primary document. Record its URL, publication date and the exact table or paragraph.
2. Record what is counted and how — the definition travels with the number.
3. Record the period covered and today's date as the retrieval date.
4. Set a `review_due` date: annual for standards and legislation, quarterly for market pricing data.
5. Set status to `verified` and replace the placeholder on every page listed in "used on".
6. If the figure cannot be verified, leave the placeholder in place. Do not approximate.

## 8.4 Figures deliberately not sourced, because they are not published

The following are not in the register because the claims themselves have been withdrawn: PAPSS
adoption levels; a universal SWIFT settlement time; stablecoin spread elimination; "cents on the
dollar" pricing; "every revenue dollar stays in Africa"; "largest diaspora corridor globally";
"three times the volume"; and the "$200 billion market" figure. See
`docs/07-regulatory-claim-register.md` §7.2.
