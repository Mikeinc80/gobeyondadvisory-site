# 4. Wireframes — desktop and mobile

Layout is expressed as ASCII wireframes plus the grid rules that generate them. The built pages are the
reference implementation; these diagrams exist so layout can be reviewed and changed without reading
CSS.

**Breakpoints**

| Token | Width | Effect |
| --- | --- | --- |
| base | 0–639px | Single column. Stacked nav behind a toggle. |
| sm | ≥640px | Card grids go to two columns. |
| md | ≥780px | Tracker rows and definition lists gain a label column. |
| lg | ≥900px | Hero splits; article gains a sidebar; footer goes to 1 + 4. |
| xl | ≥980px | Three- and four-column card grids. |
| nav | ≥1000px | Primary navigation replaces the toggle. |

Shell: `max-width 1200px` (EKORails) / `1160px` (Eko Infrastructure), gutter
`clamp(1.25rem, 1rem + 2vw, 3rem)`. Reading column: `max-width 68ch` prose, `72ch` article body.

---

## 4.1 EKORails home — desktop (≥1000px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [EKORails]        Platform  Use Cases  Regulatory Pathway  …      [Contact]  │  sticky, 72px
├──────────────────────────────────────────────────────────────────────────────┤
│▓▓ NAVY HERO ▓▓                                                               │
│  — EKORAILS LTD                          ┌────────────────────────────────┐  │
│  Settlement infrastructure               │  corridor schematic            │  │
│  for African trade.                      │   ○ origination                │  │
│                                          │      ╲  compliance             │  │
│  EKORails is developing a compliance-    │        ╲   fx      partner     │  │
│  first settlement and interoperability…  │          ┄┄┄┄┄┄┄┄┄ ◌ counter.  │  │
│                                          ├────────────────────────────────┤  │
│  ▎▲ Proposed pilot activities remain     │ caption + [CONFIRM] placeholder│  │
│  ▎  subject to regulatory approval…      └────────────────────────────────┘  │
│                                                                              │
│  [Explore Institutional Partnerships] [Review the Platform]                  │
│  Visit Eko Infrastructure Research →                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ IVORY · THE PROBLEM                                                          │
│  H2 (max 68ch, left)                                                         │
│  ┌────────────────┐┌────────────────┐   2-up grid at ≥640, stays 2-up so the │
│  │ 01 — Cost      ││ 02 — FX        │   cards keep a readable measure        │
│  └────────────────┘└────────────────┘                                        │
│  ┌────────────────┐┌────────────────┐                                        │
│  │ 03 …           ││ 04 …           │                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│▓▓ NAVY · WHAT WE'RE BUILDING ▓▓        3-up cards, each: icon, chip, h3, body │
├──────────────────────────────────────────────────────────────────────────────┤
│ IVORY · USE CASES                       3-up cards + 1 exclusions card       │
├──────────────────────────────────────────────────────────────────────────────┤
│ IVORY-2 · HOW A TRANSACTION WOULD WORK                                       │
│  ┌───────────────────────────────────┐  ┌──────────────────────┐             │
│  │ 01 ── Initiation                  │  │ sticky sidebar       │  1fr / 340px │
│  │      owner: EKORails…             │  │ Where the boundary   │             │
│  │──────────────────────────────────-│  │ sits                 │             │
│  │ 02 ── Identity and compliance     │  │──────────────────────│             │
│  │ …                                 │  │ Settlement asset     │             │
├──────────────────────────────────────────────────────────────────────────────┤
│▓▓ NAVY · REGULATORY PATHWAY ▓▓                                               │
│  Entity incorporated  │ note…………………………………………│      [Complete]  200/1fr/150 │
│  Sandbox application  │ note…………………………………………│     [Submitted]              │
│  Regulatory review    │ note…………………………………………│       [Pending]              │
├──────────────────────────────────────────────────────────────────────────────┤
│ IVORY · INITIAL CORRIDOR — definition list, 260px label column               │
├──────────────────────────────────────────────────────────────────────────────┤
│ IVORY-2 · COMPLIANCE BY DESIGN — 3×3 cards                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ IVORY · PARTNERSHIPS — 7 category cards + CTA card                           │
├──────────────────────────────────────────────────────────────────────────────┤
│▓▓ NAVY · LEADERSHIP ▓▓ — 3 cards                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ IVORY-2 · BRIDGE — text left, [Visit Eko Infrastructure] right               │
├──────────────────────────────────────────────────────────────────────────────┤
│▓▓ NAVY · FINAL CTA ▓▓ — centred H2 + three buttons                           │
├──────────────────────────────────────────────────────────────────────────────┤
│▓▓ FOOTER ▓▓ brand 1fr │ Platform · Governance · Engage · Legal (4 cols)      │
│  ── Regulatory status paragraph ──                                           │
│  ── Disclaimer · © EKORails LTD ──                                           │
└──────────────────────────────────────────────────────────────────────────────┘
      [ consent bar — fixed to bottom until a choice is stored ]
```

## 4.2 EKORails home — mobile (390px)

```
┌────────────────────────────┐
│ [EKORails]   [Contact] [☰] │  toggle expands a full-width panel
├────────────────────────────┤
│▓ NAVY HERO ▓               │
│ — EKORAILS LTD             │
│ Settlement                 │
│ infrastructure for         │
│ African trade.             │   H1 clamps to ~42px at 390px
│                            │
│ EKORails is developing…    │
│                            │
│ ▎▲ Proposed pilot          │
│ ▎  activities remain…      │
│                            │
│ [Explore Institutional     │   buttons stack, full-width-ish,
│  Partnerships]             │   44px minimum height
│ [Review the Platform]      │
│ Visit Eko Infrastructure → │
│ ┌────────────────────────┐ │
│ │ corridor schematic     │ │   SVG scales to 100%; grid children
│ │ (below the copy)       │ │   have min-width:0 so it cannot
│ └────────────────────────┘ │   force horizontal overflow
├────────────────────────────┤
│ THE PROBLEM                │
│ ┌────────────────────────┐ │   cards single column
│ │ 01 — Cost              │ │
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ 02 — FX availability   │ │
├────────────────────────────┤
│ … sections stack in the    │
│   same order as desktop …  │
├────────────────────────────┤
│ TRACKER                    │
│ Entity incorporated        │   label / note / chip stack vertically
│ note……………                  │   below 780px
│ [Complete]                 │
├────────────────────────────┤
│ FOOTER — brand, then 2×2   │
│ link columns, then status  │
│ and disclaimer             │
└────────────────────────────┘
```

## 4.3 Platform page — desktop

```
┌──────────────────────────────────────────────────────────────────────────────┐
│▓ NAVY intro band: eyebrow, H1, lede, status band ▓                           │
├──────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ ┌────────────────────┐                │
│ │ Platform overview (prose, 68ch)    │ │ ON THIS PAGE       │  sticky TOC     │
│ │                                    │ │ 01 Platform overv. │  1fr / 340px    │
│ │                                    │ │ 02 Participants    │                 │
│ │                                    │ │ … 13 items         │                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ PARTICIPANTS — table in an overflow-x container, min-width 560px             │
├──────────────────────────────────────────────────────────────────────────────┤
│ LIFECYCLE — 11-row state table                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ SYSTEM BOUNDARY                                                              │
│  ┌────────────┐   ┌──────────────────────────┐   ┌────────────┐              │
│  │ORIGINATION │──▶│ EKORAILS BOUNDARY        │──▶│ LICENSED   │              │
│  │ enterprise │   │ ┌──────────────────────┐ │   │ PARTNERS   │              │
│  │ orig. bank │──▶│ │ API & messaging      │ │──▶│ FX         │              │
│  │ vendors    │──▶│ │ orchestration        │ │──▶│ settlement │              │
│  └────────────┘   │ │ control enforcement  │ │──▶│ custody    │              │
│   dashed = ext.   │ │ routing              │ │──▶│ payout     │              │
│                   │ │ ledger & audit       │ │──▶│ supervisor │              │
│                   │ │ reporting (dashed)   │ │   └────────────┘              │
│                   │ └──────────────────────┘ │    gold = partner-owned       │
│                   └──────────────────────────┘                               │
│  legend: ▣ EKORails  ▣ licensed partner  ▢ external                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ Integration (3 cards) · API · Ledger · Settlement · Controls · Reporting ·   │
│ Resilience · Data · Partner responsibilities (table)                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

On mobile the TOC moves above the prose, and the boundary diagram scrolls horizontally inside its own
container — the page body never scrolls sideways.

## 4.4 Partners page — form layout

```
Desktop (≥720px)                          Mobile
┌───────────────────────────────────┐     ┌────────────────────┐
│ FIELDSET: About you               │     │ Full name          │
│ ┌──────────────┐┌──────────────┐  │     │ [__________]       │
│ │ Full name    ││ Position     │  │     │ Position           │
│ └──────────────┘└──────────────┘  │     │ [__________]       │
│ ┌──────────────┐┌──────────────┐  │     │ Organisation       │
│ │ Organisation ││ Country      │  │     │ …                  │
│ └──────────────┘└──────────────┘  │     │ every field full   │
│ ┌─────────────────────────────┐   │     │ width, 46px min    │
│ │ Work email        (span 2)  │   │     │ height             │
├───────────────────────────────────┤     └────────────────────┘
│ FIELDSET: About the partnership   │
│ Organisation type      (span 2)   │  ← routes the enquiry; ?type= presets it
│ Proposed partnership   (span 2)   │
│ Licence status         (span 2)   │  ← becomes required for regulated types
│ ┌──────────────┐┌──────────────┐  │
│ │ Corridor     ││ Volume range │  │
│ └──────────────┘└──────────────┘  │
│ Message                (span 2)   │
├───────────────────────────────────┤
│ ☐ consent (required)              │
│ ▎ no-investment callout           │
│ [Send partnership enquiry]        │
└───────────────────────────────────┘
```

## 4.5 Eko Infrastructure article — desktop and mobile

```
Desktop                                              Mobile
┌────────────────────────────┬──────────────┐        ┌──────────────────┐
│ — SETTLEMENT · EXPLAINER   │ In one line  │        │ — SETTLEMENT     │
│ H1 serif, max 22ch         │ ┌──────────┐ │        │ H1               │
│ Standfirst                 │ │ summary  │ │        │ Standfirst       │
│ BY … PUBLISHED … UPDATED … │ └──────────┘ │        │ BY … PUBLISHED   │
│ 12 MIN READ [SOURCE-CHECK] │ On EKORails  │        │ ──────────────── │
│ ══════════════════════════ │ ┌──────────┐ │        │ serif reading    │
│ serif reading column,      │ │ link     │ │        │ column, full     │
│ ~68ch, 1.72 line height    │ └──────────┘ │        │ width            │
│                            │  sticky      │        │                  │
│ H2 …                       │              │        │ ▎ disclosure and │
│ ▎ disclosure + regulatory  │              │        │ ▎ regulatory note│
│ ══ SOURCES (gold rule) ══  │              │        │ ══ SOURCES ══    │
│ 1. … retrieved [DATE]      │              │        │ Related          │
│ Related                    │              │        │ ┌──────────────┐ │
└────────────────────────────┴──────────────┘        │ │ In one line  │ │
                                                     └──────────────────┘
```

## 4.6 Eko Infrastructure home — desktop

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Eko Infrastructure]  Research Settlement Corridors Policy …     [Search]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ IVORY HERO (no dark slab — this is how the two sites differ at a glance)      │
│  — EKO INFRASTRUCTURE                    ┌────────────────────────────────┐  │
│  Research and intelligence for           │ ▎ Who publishes this           │  │
│  African settlement infrastructure.      │ ▎ operated by EKORails LTD…    │  │
│  Clearing, settlement, corridors…        │ ▎ Editorial standards →        │  │
│  [Start with settlement] [See sources]   └────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────────┤
│ TOPICS — 3-up cards ×5 + search card                                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ LATEST RESEARCH — article rows: 190px meta column / 1fr content              │
│  SETTLEMENT      │ Clearing versus settlement: the distinction that…         │
│  EXPLAINER       │ Messaging, clearing, conversion, settlement and payout…   │
│  12 MIN READ     │                                                           │
├──────────────────────────────────────────────────────────────────────────────┤
│▓ NAVY DISCLOSURE BAND ▓  operated by EKORails LTD …      [About EKORails]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 4.7 Component placement rules

1. A status chip never appears without a claim next to it that it qualifies.
2. A placeholder (`[CONFIRM WITH EKORAILS]`) renders inline, dashed and gold-inked — visible to a
   reviewer, unmissable in a screenshot, and it wraps rather than forcing overflow.
3. Tables always sit inside `.table-wrap` with `overflow-x: auto`.
4. Sticky sidebars only above 900px; below that they become normal flow above or below the content.
5. Dark sections alternate with ivory to segment a long page; two dark sections never touch.
6. Every section carries `data-section` so analytics measures scroll depth by meaning, not pixels.
