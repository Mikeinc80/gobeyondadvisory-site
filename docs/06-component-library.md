# 6. Component library

Every component below is implemented in `src/_shared/base.css` (shared) or a site skin. Class names are
the contract. Numbers in headings match the numbered sections of `base.css`.

---

## Layout

| Component | Class | Notes |
| --- | --- | --- |
| Shell | `.shell` | Max 1200/1160px, fluid gutter. `.shell-narrow` = 760px for legal and form pages. |
| Section | `.section` | Vertical rhythm. Modifiers: `--tight`, `--ivory2`, `--white`, `--dark`, `--rule`. |
| Split | `.split`, `.split--sidebar` | Two columns ≥900px; sidebar variant is `1fr / 340px`. |
| Sticky sidebar | `.sticky-side` | Sticks below the header; inert under 900px. |
| Grid | `.grid`, `.grid-2/3/4` | 1 → 2 → 3/4 columns. All children get `min-width: 0`. |

## Navigation

| Component | Class | Accessibility |
| --- | --- | --- |
| Skip link | `.skip-link` | First focusable element; becomes visible on focus. |
| Header | `.site-header` | Sticky, translucent, `scroll-padding-top` compensates. |
| Primary nav | `.primary-nav` | `<nav aria-label="Primary">`; current page has `aria-current="page"`. |
| Mobile nav | `.mobile-nav` + `[data-nav-toggle]` | `aria-expanded` / `aria-controls`; Escape closes and returns focus. |
| Table of contents | `.toc` | `<nav aria-label="On this page">`, numbered by CSS counter. |
| Footer | `.site-footer` | 4 link columns, regulatory status block, disclaimer block. |

## Actions

| Component | Class | Use |
| --- | --- | --- |
| Solid button | `.btn.btn-solid` | Navy fill. Default action on light grounds. |
| Emerald button | `.btn.btn-emerald` | Primary conversion action. |
| Ghost button | `.btn.btn-ghost` | Secondary on light. |
| On-dark button | `.btn.btn-on-dark` | Secondary on navy. |
| Small / block | `.btn-sm`, `.btn-block` | Header CTA; mobile and sidebar. |
| Arrow link | `.link-arrow` | Inline tertiary action; arrow shifts 3px on hover. |
| Button row | `.btn-row` | Wraps; 44px minimum target height throughout. |

Every CTA carries `data-cta="<name>"` for the analytics plan.

## Content blocks

| Component | Class | Purpose |
| --- | --- | --- |
| Eyebrow | `.eyebrow` | Mono, uppercase, with a leading rule. Section label. |
| Section head | `.section-head` | Eyebrow + H2 + intro, capped at 68ch. |
| Card | `.card` | White, bordered. Variants `--flat`, `--dark`. |
| Card index | `.card-index` | "01 — Cost" label. |
| Card list | `.card-list` | Dash-marked bullet list inside a card. |
| Callout | `.callout` | Emerald left rule. `--gold` for cautions, `--dark` on navy. |
| Definition list | `.deflist` | 260px label column ≥780px; ruled rows. |
| Accordion | `details.acc` | Native disclosure; +/− marker; no JS required. |
| Tabs | `[data-tabs]` | Full ARIA tab pattern with arrow-key support. |
| Table | `.table-wrap > table` | Always scrollable; mono uppercase headers; `<caption>` required. |
| Prose | `.prose` | 68ch measure, spaced headings, styled blockquote and footnotes. |
| Stat | `.stat` | Serif value + mono label. |

## Status and evidence

| Component | Class | Meaning |
| --- | --- | --- |
| Chip — complete | `.chip.chip-live` | Evidenced and done. |
| Chip — in progress | `.chip.chip-progress` | Under way. |
| Chip — planned | `.chip.chip-planned` | Designed, not begun. |
| Chip — on dark | `.chip.chip-dark` | Same semantics, dark ground. |
| Placeholder | `.placeholder` | `[CONFIRM WITH EKORAILS]`, `[INSERT VERIFIED FIGURE]`, `[SUBJECT TO REGULATORY APPROVAL]`. Dashed gold, wraps safely. |
| Tracker row | `.tracker-row` | Stage / note / chip. Never shows a stage ahead of its evidence. |
| Review badge | `.review-badge` | Editorial state on an article. |

## Diagrams

| Component | Class | Notes |
| --- | --- | --- |
| Corridor figure | `.corridor-fig` | Single-corridor schematic; `<title>`/`<desc>`; animated dash respects reduced motion. |
| System boundary | `.boundary` + `.legend` | Three columns, colour-keyed by ownership, with a text legend. |
| Flow steps | `.flow`, `.flow-step`, `.flow-num` | Numbered lifecycle with `.flow-owner` / `.flow-dep` meta lines. |

## Forms

| Component | Class | Notes |
| --- | --- | --- |
| Form | `form[data-form="<name>"]` | Name feeds analytics and routing. |
| Fieldset | `fieldset > legend` | Groups "About you" / "About the partnership". |
| Field | `.field` | Label, control, `.hint`, `.error`. |
| Error | `.error` | Revealed by `:user-invalid`, so it never fires before interaction. |
| Checkbox | `.checkbox` | 20px control, aligned to the first line of a wrapped label. |
| Honeypot | `.hp` | Off-screen, `aria-hidden`, `tabindex="-1"`, plus a submit-timing check. |
| Search | `.search-form` | `role="search"`, live region for results count. |

## Editorial (Eko Infrastructure only)

| Component | Class | Notes |
| --- | --- | --- |
| Article card | `.article-card` | Meta column + headline + summary. |
| Article header | `.article-header` | H1, standfirst, byline, navy rule. |
| Byline | `.byline` | Author · published · updated · reading time · review badge. |
| Article body | `.article-body` | Serif reading column. |
| Sources | `.sources` | Gold rule, numbered list, retrieval dates. |
| Footnote marker | `sup.fn a` | Switches to sans at 0.7em. |
| Search hit | `.search-hit` + `mark` | Highlighted snippet. |
| Glossary nav | `.glossary-nav` | A–Z jump targets, 36px minimum. |
| Disclosure band | `.bridge-eko` | Navy band linking to EKORails. |

## Site-wide

| Component | Class | Notes |
| --- | --- | --- |
| Consent bar | `[data-consent]` | Fixed; two explicit choices; stores to `localStorage`; emits `eko:consent`. |
| CTA band | `.cta-band` | Navy, centred, closes most pages. |
| Bridge | `.bridge` | Cross-site link band on EKORails. |

---

## Component checklist before adding a new one

1. Does an existing component do this? Prefer reuse — the library is deliberately small.
2. Does it need a status chip? If it makes a claim about capability or status, yes.
3. Does it hold a fact that is not in the filing? Then it holds a placeholder, not a guess.
4. Contrast checked at both grounds?
5. Keyboard reachable, visible focus, 44px targets?
6. Does it survive 320px width without horizontal overflow?
7. Does it need a `data-section` or `data-cta` hook for analytics?
