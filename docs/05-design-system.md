# 5. Design system

Source of truth: `src/_shared/base.css` (tokens + components) plus one skin per site.
The build concatenates `base.css + skin.css` into a single `assets/css/site.css`, so each site ships
one render-blocking stylesheet.

---

## 5.1 Design intent

The brief for the visual identity was: trusted, regulated, African-led, technically serious,
institutional, calm. In practice that resolved to five rules.

1. **Dark for authority, ivory for reading.** Navy slabs carry positioning and status; long copy always
   sits on warm ivory or white.
2. **Serif headings, sans body.** Source Serif 4 reads like a central bank publication; Inter keeps
   dense operational copy legible; IBM Plex Mono marks anything that is data, status or a label.
3. **Emerald means "ours", gold means "someone else's" or "careful".** The accent system carries
   meaning: emerald marks EKORails-owned functions and confirmed states; gold marks partner-owned
   functions, regulatory cautions and unverified placeholders.
4. **No decoration that implies scale we do not have.** One corridor line, not a network. No maps, no
   flags, no coins, no neon, no handshake photography.
5. **Motion only where it clarifies.** A dashed route line and a slow node pulse, both disabled under
   `prefers-reduced-motion`.

---

## 5.2 Colour tokens

| Token | Value | Role |
| --- | --- | --- |
| `--navy-900` | `#08151F` | Primary dark foundation; hero and footer |
| `--navy-800` | `#0D2233` | Consent bar, secondary dark |
| `--navy-700` | `#14344B` | Hover state on dark buttons; secondary wordmark |
| `--ink` | `#101418` | Reserved deep neutral |
| `--ivory` | `#F8F6F1` | Default page ground |
| `--ivory-2` | `#EFEBE3` | Alternating section ground |
| `--ivory-3` | `#E4DED2` | Image placeholder ground |
| `--white` | `#FFFFFF` | Cards, tables, form fields |
| `--emerald` | `#0E6B4E` | Primary accent; links and eyebrows on light |
| `--emerald-600` | `#12855F` | Hover; route lines |
| `--emerald-300` | `#6FC3A2` | Accent on dark grounds |
| `--emerald-100` | `#D7EBE1` | Icon frames, selection |
| `--gold` | `#A8863F` | Rules, icons, large display only |
| `--gold-ink` | `#7A5F22` | Gold used in body text (AA-safe) |
| `--gold-200` | `#E4D6B4` | Gold on dark grounds |
| `--text` | `#14191E` | Body text on light |
| `--text-2` | `#3B474F` | Secondary body text |
| `--muted` | `#5C6B75` | Labels, captions |
| `--on-dark` | `#F3F1EC` | Body text on dark |
| `--on-dark-2` | `#C2CDD5` | Secondary text on dark |
| `--line` / `--line-2` | `#D9D3C7` / `#C6BEAE` | Borders |
| `--line-dark` | `rgba(243,241,236,.16)` | Borders on dark |

### Contrast — measured, not assumed

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `--text` on `--ivory` | 15.3:1 | AAA |
| `--text-2` on `--ivory` | 9.4:1 | AAA |
| `--muted` on `--ivory` | 5.1:1 | AA body |
| `--emerald` on `--ivory` | 6.1:1 | AA body |
| `--gold` on `--ivory` | 3.2:1 | **Large text / non-text only** |
| `--gold-ink` on `--ivory` | 5.6:1 | AA body — use this in copy |
| `--on-dark` on `--navy-900` | 18.7:1 | AAA |
| `--on-dark-2` on `--navy-900` | 9.6:1 | AAA |
| `--emerald-300` on `--navy-900` | 8.9:1 | AAA |
| White on `--emerald` | 5.6:1 | AA body |

The single rule that follows: **`--gold` never sets small text.** Anywhere gold appears in running
copy — placeholders, source headings, flow dependencies — the token is `--gold-ink`.

---

## 5.3 Typography

| Role | Family | Notes |
| --- | --- | --- |
| Display / headings | Source Serif 4 (600) | Fallbacks: Iowan Old Style, Georgia, Times New Roman |
| Body / UI | Inter (400/500/600/700) | Fallbacks: system UI stack |
| Data / labels | IBM Plex Mono (400/500/600) | Eyebrows, chips, dates, table headers, code |

Fluid scale (`clamp`, so there are no fixed breakpoint jumps):

| Step | Min → Max | Used for |
| --- | --- | --- |
| `--step--1` | 13 → 14px | Captions, card body, chips |
| `--step-0` | 16 → 17px | Body |
| `--step-1` | 19 → 22px | Card and callout headings, ledes |
| `--step-2` | 23 → 28px | Sub-section headings |
| `--step-3` | 28 → 38px | Section headings |
| `--step-4` | 34 → 52px | Page H1 |
| `--step-5` | 40 → 68px | Home hero H1 |

Body line height 1.65; headings 1.14 with `-0.011em` tracking; article reading column 1.72.
`text-wrap: balance` on headings, `pretty` on paragraphs. Measure capped at 62–74ch everywhere.

---

## 5.4 Spacing, layout and shape

Scale: `0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4 / 6rem` (`--s-1` … `--s-8`).
Section rhythm: `--section-y: clamp(3.5rem, 2.5rem + 4vw, 6.5rem)`.
Radius: 3px default, 6px for figures. Deliberately close to square — rounded corners read consumer.
Shadows: two levels only, both low-contrast; dark sections use borders instead of shadow.

---

## 5.5 The status language

The most important part of this system is not visual. Four labels are used consistently across both
sites and mean exactly one thing each.

| Label | Chip | Meaning |
| --- | --- | --- |
| **Complete** | `chip-live` (emerald) | EKORails LTD holds a document evidencing this. |
| **Submitted / In development** | `chip-progress` (gold-ink) | Under way; evidence exists for the activity, not the outcome. |
| **Pending / Not started / Planned / Proposed** | `chip-planned` (muted) | Designed or filed; not begun or not decided. |
| `[CONFIRM WITH EKORAILS]` etc. | dashed gold placeholder | A fact that must come from the filing before launch. |

A chip never appears without the claim it qualifies. A claim about capability or status never appears
without a chip.

---

## 5.6 Motion

- Route line: 5s linear dash offset.
- Origination node: 3.4s ease-in-out opacity and radius pulse.
- Interactive transitions: 150–180ms on colour and border only.
- All of the above sit inside `@media (prefers-reduced-motion: no-preference)`.
- No parallax, no scroll-jacking, no entrance animations on content.

---

## 5.7 Iconography and imagery

- Icons are inline SVG, 20×20, 1.4px stroke, `currentColor`, no fills. Six exist, one per capability.
- Diagrams are hand-authored SVG with `<title>` and `<desc>` and a text legend — never an image of text.
- Photography: leadership portraits only, 4:5, on `--ivory-3`. Placeholder SVG until real photographs
  are supplied. No stock photography anywhere on either site.
- Open Graph images are generated from SVG masters via `tools/rasterize.py`, so the brand has one
  editable source per asset.

---

## 5.8 The two skins

| | `src/ekorails/assets/css/skin.css` | `src/ekoinfrastructure/assets/css/skin.css` |
| --- | --- | --- |
| Header | Ivory, 1px line | White, 1px navy line (editorial masthead) |
| Hero | Navy slab, radial emerald glow | Ivory, no slab, typographic |
| Body ground | Ivory | White |
| Reading column | Sans | Serif, 1.72 line height |
| Unique components | capability icon frames, boundary diagram, partner categories, news list, bridge band | article cards, bylines, source blocks, footnote markers, search hits, glossary nav, navy disclosure band |
| Gold used for | rules, warnings, partner-owned diagram elements | source and citation furniture only |
