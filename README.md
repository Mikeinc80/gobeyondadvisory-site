# EKORails LTD — ekorails.com and ekoinfrastructure.com

Two connected but clearly differentiated static sites, built from one dependency-free Python
generator.

| Site | Purpose | Build output |
| --- | --- | --- |
| **ekorails.com** | Corporate and platform website for EKORails LTD | `dist/ekorails/` |
| **ekoinfrastructure.com** | Eko Infrastructure — the research, policy and market-intelligence platform operated by EKORails LTD | `dist/ekoinfrastructure/` |

> **EKORails LTD has applied to participate in the Central Bank of Nigeria Regulatory Sandbox.
> Participation and all proposed pilot activities remain subject to regulatory review and approval.
> EKORails LTD is not licensed, authorised, approved, endorsed or supervised by the Central Bank of
> Nigeria or by any other financial services regulator.**

---

## Build

```bash
python3 build.py                     # both sites
python3 build.py ekorails            # one site
python3 tools/check.py               # links, headings, alt text, labels, metadata, disclaimer
```

Python 3.9+. No dependencies, no package manager, no lockfile.

Preview locally:

```bash
python3 -m http.server 8811 --directory dist/ekorails
python3 -m http.server 8812 --directory dist/ekoinfrastructure
```

Design review helpers (require the bundled headless Chromium):

```bash
python3 tools/shoot.py http://127.0.0.1:8811/index.html 390 1700 mobile.png
python3 tools/rasterize.py src/ekorails/assets/img/og-default.svg 1200 630
```

## Layout

```
build.py                     Generator: chrome, metadata, JSON-LD, sitemaps, CSP, search index
src/_shared/base.css         Design system — tokens and components
src/<site>/site.json         Nav, footer, contacts, and the regulatory status statement
src/<site>/pages/*.html      Page fragments with JSON front matter
src/<site>/assets/           CSS skin, JS, brand SVGs and generated PNGs
src/<site>/static/           Files copied to the site root (.well-known/security.txt)
src/<site>/netlify.toml      Build settings, security headers, 301 redirect map
src/ekoinfrastructure/admin/ Decap CMS configuration
content/                     CMS content: research, glossary, sources, news, regulatory status
docs/                        16 deliverables plus the red-team review
dist/                        Build output (generated; committed so it can be previewed directly)
```

## Editing content

- **A page's copy** — edit the fragment in `src/<site>/pages/`, then rebuild.
- **Navigation, footer, contacts, regulatory status** — `src/<site>/site.json`.
- **Design tokens and components** — `src/_shared/base.css`, then the per-site `skin.css`.
- **Research articles, glossary, sources, news** — through the CMS at `/admin/`
  (see `docs/12-cms-content-model.md`).

## Rules that this build enforces, and why

1. **No unevidenced claim ships.** Facts that must come from the CBN filing render as visible
   `[CONFIRM WITH EKORAILS]` / `[INSERT VERIFIED FIGURE]` / `[SUBJECT TO REGULATORY APPROVAL]`
   placeholders. They are deliberately hard to miss.
2. **Regulatory language lives in one place per site.** The footer disclaimer and the regulatory status
   statement come from `site.json`, so they cannot drift between pages.
3. **Status labels mean one thing each.** Complete / Submitted / In development / Proposed / Planned,
   defined on the home page and applied identically everywhere.
4. **No statistic without a source register entry.** See `docs/08-source-register.md`.
5. **No claim removed by the brief reappears.** See `docs/07-regulatory-claim-register.md` §7.2.

## Before you deploy

Read `docs/15-deployment-checklist.md` and `docs/16-prelaunch-review-checklist.md`. Several items block
launch — in particular, confirming that the sandbox application has been *submitted*, and resolving
every placeholder.

## Documentation

| Doc | Contents |
| --- | --- |
| `docs/01-site-architecture.md` | Brand architecture, both site maps, cross-linking, technical baseline |
| `docs/02-homepage-copy.md` | Final homepage copy of record |
| `docs/03-page-copy.md` | Intent, structure and required sentences for every main page |
| `docs/04-wireframes.md` | Desktop and mobile wireframes, breakpoints, placement rules |
| `docs/05-design-system.md` | Tokens, measured contrast ratios, typography, motion, the status language |
| `docs/06-component-library.md` | Every component, its class and its accessibility contract |
| `docs/07-regulatory-claim-register.md` | Every published claim, its basis and its control; withdrawn claims |
| `docs/08-source-register.md` | All statistics, their sources and verification status |
| `docs/09-redirect-map.md` | 301 map from the legacy domains and paths |
| `docs/10-seo-metadata.md` | Per-page titles, descriptions, schema; keywords; Core Web Vitals approach |
| `docs/11-legal-drafts.md` | Privacy, terms and disclaimer drafts with counsel questions |
| `docs/12-cms-content-model.md` | Collections, fields, editorial workflow, access control |
| `docs/13-form-specifications.md` | Fields, validation, routing, anti-spam, secure handling |
| `docs/14-analytics-event-plan.md` | Consent-gated event catalogue and the reports worth building |
| `docs/15-deployment-checklist.md` | Netlify, DNS, email, sign-off, verification, rollback |
| `docs/16-prelaunch-review-checklist.md` | Regulatory and factual review, with sign-off table |
| `docs/17-red-team-review.md` | Six adversarial reviews and the consolidated action list |
