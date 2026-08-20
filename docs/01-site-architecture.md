# 1. Site architecture — both domains

**Prepared for:** EKORails LTD
**Status:** Draft for review. Every `[CONFIRM WITH EKORAILS]` marker in the build must be resolved before launch.
**Controlling source:** the final CBN Regulatory Sandbox application and its supporting technical documents.

---

## 1.1 Brand architecture

| Element | Value |
| --- | --- |
| Operating company | EKORails LTD |
| Primary brand | EKORails |
| Primary domain | ekorails.com |
| Knowledge platform | Eko Infrastructure — ekoinfrastructure.com |
| Primary tagline | Settlement infrastructure for African trade. |
| Supporting line | Connecting regulated institutions, businesses and markets across African and global trade corridors. |
| Relationship | Eko Infrastructure is the research, policy and market-intelligence platform **operated by** EKORails LTD. |
| GoBeyond Advisory | Described only where legally and factually accurate. EKORails LTD is the legal applicant and operating entity. Exact relationship: `[CONFIRM WITH EKORAILS]` (see `/leadership`). |

**Rule applied throughout the build:** EKORails is never described as "a GoBeyond initiative". The company
is the subject of every sentence about the applicant, the platform and the filing.

## 1.2 Repository and build

```
build.py                     Static generator (Python 3.9+, no dependencies)
tools/check.py               Link, heading, alt-text, label, metadata and disclaimer checks
tools/shoot.py               Width-accurate screenshots for design review
tools/rasterize.py           SVG -> PNG for Open Graph images and touch icons
src/_shared/base.css         Shared design system
src/ekorails/                Site source: site.json, pages/, assets/, netlify.toml
src/ekoinfrastructure/       Site source: site.json, pages/, assets/, admin/, netlify.toml
content/                     CMS content (research, glossary, sources, news, regulatory status)
dist/ekorails/               Build output — deploy target for ekorails.com
dist/ekoinfrastructure/      Build output — deploy target for ekoinfrastructure.com
docs/                        These deliverables
```

Build: `python3 build.py` (or `python3 build.py ekorails` for one site).
Check: `python3 tools/check.py` — must exit 0 before any deploy.

Every page is an HTML fragment with a JSON front-matter block. Site-wide chrome, metadata, JSON-LD,
sitemaps, robots.txt, the Content-Security-Policy and the consent notice are generated centrally, so
**regulatory language cannot drift between pages** — the footer disclaimer and the regulatory status
statement exist in exactly one place per site (`src/<site>/site.json`).

---

## 1.3 EKORails.com site map

| # | Page | URL | Purpose | Primary CTA |
| --- | --- | --- | --- | --- |
| 1 | Home | `/` | Position the company, state status honestly, route by audience | Explore Institutional Partnerships |
| 2 | Platform | `/platform` | Proposed architecture and the system boundary | Discuss a Partnership |
| 3 | Use Cases | `/use-cases` | The five in-scope flows and the explicit exclusions | Enterprise Pilot Interest |
| 4 | Pilot and Regulatory Pathway | `/pilot-and-regulatory-pathway` | Evidence-based status tracker; what a sandbox is not | Regulatory Inquiry |
| 5 | Corridors | `/corridors` | The single proposed corridor; expansion conditions; how EKORails relates to existing systems | Discuss a Partnership |
| 6 | Compliance and Risk | `/compliance-and-risk` | Full control framework for second-line reviewers | compliance@ekorails.com |
| 7 | Technology | `/technology` | Engineering principles, component register, open decisions | Technology partnership |
| 8 | Partners | `/partners` | Seven partner categories and the enquiry form | Send partnership enquiry |
| 9 | Leadership | `/leadership` | Named accountability and governance | Discuss a Partnership |
| 10 | News and Updates | `/news` | Evidence-gated company updates | Subscribe to updates |
| 11 | Contact | `/contact` | Four routes, registered details, security disclosure | Direct email |
| 12 | Privacy Policy | `/privacy-policy` | Data processing | — |
| 13 | Terms of Use | `/terms-of-use` | Website terms | — |
| 14 | Regulatory Disclaimer | `/regulatory-disclaimer` | Licensing status, no-offer, no-guarantee, forward-looking | — |
| — | Thank you | `/thank-you` | Form confirmation (noindex) | — |

**Primary navigation:** Platform · Use Cases · Regulatory Pathway · Corridors · Compliance ·
Technology · Partners · Leadership · News, with Contact as the header CTA.

**Home page section order** (each carries a `data-section` attribute for analytics):
hero → the problem → what EKORails is building → initial use cases → how a transaction would work →
regulatory pathway → initial corridor → compliance by design → institutional partnerships →
leadership → Eko Infrastructure bridge → final CTA.

## 1.4 EkoInfrastructure.com site map

| # | Page | URL | Purpose |
| --- | --- | --- | --- |
| 1 | Research | `/` | Hub: topics, latest research, disclosure |
| 2 | Settlement Explained | `/settlement-explained` | Settlement, clearing, correspondent banking, FX, finality, stable-value |
| 3 | Corridor Intelligence | `/corridor-intelligence` | Corridor method and data limits |
| 4 | Policy and Regulation | `/policy-and-regulation` | Sandboxes, licensing, AML/CFT, data protection, regional policy |
| 5 | Technology | `/technology` | Messaging, compliance architecture, monitoring, auditability, sovereignty |
| 6 | Glossary | `/glossary` | A–V definitions with cross-links |
| 7 | Data and Sources | `/data-and-sources` | Sourcing rules, source register, claims we do not make, corrections |
| 8 | EKORails | `/ekorails` | Disclosure: who operates the platform and its regulatory status |
| 9 | About | `/about` | Editorial standards, review workflow, corrections, reuse |
| 10 | Contact | `/contact` | Research, media, corrections form |
| — | Search | `/search` | Client-side full-text search (noindex) |
| — | Research articles | `/research/<slug>` | Long-form pieces with full article furniture |

Seeded articles: `clearing-versus-settlement`, `what-papss-does`,
`swift-is-a-messaging-network`, `reading-a-trade-corridor`.

**Primary navigation:** Research · Settlement · Corridors · Policy · Technology · Glossary ·
Sources · About, with Search as the header CTA.

## 1.5 Cross-linking model

Deliberately narrow, so neither site reads as a funnel into the other.

| From | To | Where |
| --- | --- | --- |
| ekorails.com home | ekoinfrastructure.com | Hero third link; research bridge band; footer |
| ekorails.com corridors | `/corridor-intelligence`, `/settlement-explained` | Complementarity table and note |
| ekorails.com home / corridors | `/data-and-sources` | Every statistic claim points at the register |
| ekoinfrastructure.com every page | ekorails.com | Footer disclosure + `/ekorails` page |
| ekoinfrastructure articles | one relevant EKORails page | In the disclosure callout only |

## 1.6 Differentiation between the two sites

| | EKORails.com | EkoInfrastructure.com |
| --- | --- | --- |
| Job | Explain what is being built; recruit partners | Explain the market; build institutional credibility |
| Ground | Navy-forward, dark hero slabs | Ivory/white, no dark hero |
| Type | Serif headings, sans body | Serif headings **and** serif reading column |
| Furniture | Status chips, trackers, boundary diagrams, forms | Bylines, dates, source blocks, footnotes, search |
| Voice | First person plural, precise about status | Third person, explanatory, fair to alternatives |
| Gold accent | Rules, warnings, partner-owned elements | Source and citation furniture only |

## 1.7 Accessibility and technical baseline

- Semantic HTML5, one `h1` per page, no skipped heading levels (enforced by `tools/check.py`).
- Skip link, visible focus rings at 3px, 44px minimum touch targets, `prefers-reduced-motion` respected.
- All text colour pairings meet WCAG 2.2 AA; gold is restricted to large text, rules and icons, with
  `--gold-ink` (5.6:1 on ivory) used wherever gold appears in body copy.
- Mobile-first CSS; a single render-blocking stylesheet per site; fonts loaded non-blocking with a
  `noscript` fallback; images carry intrinsic dimensions.
- No third-party scripts, no advertising cookies, no cross-site tracking.
