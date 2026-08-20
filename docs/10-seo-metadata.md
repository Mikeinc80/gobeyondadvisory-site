# 10. SEO metadata

Generated from the page front matter in `src/*/pages/`. If you change a title or description, change it
there — this table is produced from the build, not maintained by hand.

**Conventions**

- Title pattern: `Primary subject | Qualifier | Brand`. Target ≤ 65 characters.
- Description: 80–165 characters, written as a statement of what the page contains, not a pitch.
- Canonical URLs are extensionless and absolute, generated from `site.json → base_url`.
- Open Graph and Twitter card tags are emitted for every page; images are absolute 1200×630 PNGs.
- `robots`: `index,follow,max-image-preview:large` by default; `noindex,follow` on `/thank-you` and
  `/search`; `noindex,nofollow` on `/admin/*` via headers.
- JSON-LD per page: Organization + WebSite always; BreadcrumbList where a trail exists; FAQPage on the
  three pages carrying FAQs; Article on research pieces. Inline JSON-LD is allowed by SHA-256 hash in
  the per-page Content-Security-Policy.

---



## https://ekorails.com

| URL | Title (chars) | Meta description (chars) | Schema |
| --- | --- | --- | --- |
| `/` | EKORails | Settlement infrastructure for African trade (54) | EKORails LTD is developing a compliance-first settlement and interoperability platform for regulated institutions across selected African trade corridors. (154) | Organization, WebSite, FAQPage |
| `/compliance-and-risk` | Compliance and Risk | Control framework | EKORails (50) | The EKORails control framework: governance, AML and CFT, KYC and KYB, sanctions, monitoring, fraud, data protection, cybersecurity, resilience and complaints. (158) | Organization, WebSite, BreadcrumbList |
| `/contact` | Contact | EKORails LTD (22) | Contact EKORails LTD: general enquiries, institutional partnerships, compliance and regulatory correspondence, and research and media enquiries. (144) | Organization, WebSite, BreadcrumbList |
| `/corridors` | Corridors | The initial proposed corridor | EKORails (52) | One proposed pilot corridor originating in Nigeria: why it was selected, the institutional users, required partners, dependencies and success measures. (151) | Organization, WebSite, BreadcrumbList |
| `/leadership` | Leadership | Named accountability for EKORails LTD (50) | Leadership and governance at EKORails LTD: named individuals, their responsibilities and the governance structure. Unfilled roles are shown as unfilled. (152) | Organization, WebSite, BreadcrumbList |
| `/news` | News and Updates | EKORails LTD (31) | Company and regulatory updates from EKORails LTD. Every update states what changed, when, and the evidence held for it before it was published. (143) | Organization, WebSite, BreadcrumbList |
| `/partners` | Institutional Partnerships | EKORails (37) | EKORails partners with banks, payment institutions, enterprises, FX providers, technology and compliance vendors, regulators and research organisations. (152) | Organization, WebSite, BreadcrumbList |
| `/pilot-and-regulatory-pathway` | Pilot and Regulatory Pathway | EKORails LTD (43) | EKORails LTD has applied to the Central Bank of Nigeria Regulatory Sandbox. Participation and all proposed pilot activities remain subject to approval. (151) | Organization, WebSite, BreadcrumbList, FAQPage |
| `/platform` | Platform | EKORails settlement and interoperability architecture (64) | The proposed EKORails architecture: participants, transaction lifecycle, system boundary, integrations, ledger, settlement model, controls and resilience. (154) | Organization, WebSite, BreadcrumbList |
| `/privacy-policy` | Privacy Policy | EKORails LTD (29) | How EKORails LTD collects, uses, shares and retains personal data, the lawful bases relied on, international transfers and your data subject rights. (148) | Organization, WebSite, BreadcrumbList |
| `/regulatory-disclaimer` | Regulatory Disclaimer | EKORails LTD (36) | EKORails LTD licensing status, what a regulatory sandbox application means, no offer of investment, no guarantee of outcome and geographic restrictions. (152) | Organization, WebSite, BreadcrumbList |
| `/technology` | Technology | Architecture and security | EKORails (49) | How EKORails is engineered: principles, component register with status, data model, security posture, testing, observability and the decisions still open. (154) | Organization, WebSite, BreadcrumbList |
| `/terms-of-use` | Terms of Use | EKORails LTD (27) | The terms on which EKORails LTD makes ekorails.com available: permitted use, accuracy, no advice and no offer, intellectual property and liability. (147) | Organization, WebSite, BreadcrumbList |
| `/thank-you` | Thank you | EKORails LTD (24) | Your message has been received by EKORails LTD. Partnership enquiries are routed by organisation type; regulatory enquiries go to the compliance officer. (153) | Organization, WebSite |
| `/use-cases` | Use Cases | Institutional settlement flows | EKORails (53) | The five institutional flows EKORails is designing for — trade invoice settlement, treasury movement, supplier payments, partner settlement and reconciliation. (159) | Organization, WebSite, BreadcrumbList |

## https://ekoinfrastructure.com

| URL | Title (chars) | Meta description (chars) | Schema |
| --- | --- | --- | --- |
| `/` | Eko Infrastructure | African settlement research (48) | A research, policy and market-intelligence platform operated by EKORails LTD, covering clearing, settlement, corridors, compliance and payment policy. (150) | Organization, WebSite |
| `/about` | About | Editorial standards and disclosure | Eko Infrastructure (63) | Who publishes Eko Infrastructure, our editorial standards, the four-state review workflow, our disclosure of commercial interest, and corrections. (146) | Organization, WebSite, BreadcrumbList |
| `/contact` | Contact | Research, media and corrections | Eko Infrastructure (62) | Contact Eko Infrastructure for research enquiries, media requests, data and source questions, corrections and research partnership discussions. (143) | Organization, WebSite, BreadcrumbList |
| `/corridor-intelligence` | Corridor Intelligence | Eko Infrastructure (42) | A method for assessing a cross-border trade corridor — participants, flows, cost stack, friction, last mile and perimeter — and where the data runs out. (152) | Organization, WebSite, BreadcrumbList |
| `/data-and-sources` | Data and Sources | Eko Infrastructure (37) | The complete source register for statistics used across Eko Infrastructure and EKORails, our sourcing rules, and how to request a correction. (141) | Organization, WebSite, BreadcrumbList |
| `/ekorails` | EKORails LTD | Eko Infrastructure (33) | Eko Infrastructure is operated by EKORails LTD. What the company is building, its exact regulatory status, and how the commercial conflict is handled. (150) | Organization, WebSite, BreadcrumbList |
| `/glossary` | Glossary | Payments and settlement terms | Eko Infrastructure (61) | Plain definitions of settlement and payments terminology: clearing, settlement, finality, nostro and vostro, RTGS, switch, corridor, stablecoin and more. (153) | Organization, WebSite, BreadcrumbList |
| `/policy-and-regulation` | Policy and Regulation | Eko Infrastructure (42) | How payment activity is regulated in African markets: sandboxes and what they are not, licensing categories, AML and CFT, data protection and regional policy. (158) | Organization, WebSite, BreadcrumbList, FAQPage |
| `/research/clearing-versus-settlement` | Clearing versus settlement | Eko Infrastructure (47) | Messaging, clearing, conversion, settlement and payout are five different functions performed by different parties. Separating them resolves most arguments. (156) | Organization, WebSite, BreadcrumbList, Article |
| `/research/reading-a-trade-corridor` | How to read a trade corridor | Eko Infrastructure (49) | A repeatable method for assessing a trade corridor, with explicit notes on where reliable data ends and estimation begins. (122) | Organization, WebSite, BreadcrumbList, Article |
| `/research/swift-is-a-messaging-network` | SWIFT is a messaging network | Eko Infrastructure (49) | SWIFT carries instructions, not value. What that means for anyone comparing payment systems, and the five things that actually cause delay. (139) | Organization, WebSite, BreadcrumbList, Article |
| `/research/what-papss-does` | What PAPSS does | Eko Infrastructure (36) | A factual account of the Pan-African Payment and Settlement System: what it was built to do, who participates, and where private platforms may complement it. (157) | Organization, WebSite, BreadcrumbList, Article |
| `/search` | Search | Eko Infrastructure (27) | Full-text search across every article, explainer and definition published on Eko Infrastructure — settlement, corridors, policy and technology. (143) | Organization, WebSite |
| `/settlement-explained` | Settlement Explained | Eko Infrastructure (41) | What settlement means, how clearing differs from settlement, correspondent banking, FX liquidity, settlement finality and stable-value settlement models. (153) | Organization, WebSite, BreadcrumbList, FAQPage |
| `/technology` | Technology | Eko Infrastructure (31) | The engineering behind payment policy: messaging standards, compliance architecture, transaction monitoring, auditability and data sovereignty. (143) | Organization, WebSite, BreadcrumbList |
| `/thank-you` | Thank you | Eko Infrastructure (30) | Your message has been received by Eko Infrastructure. Corrections are reviewed by an editor before any change is published. (123) | Organization, WebSite |

---

## 10.1 Target keywords and where they are earned

Used naturally in body copy, headings and metadata. No keyword stuffing: each term appears where the
page genuinely is about that subject.

| Keyword | Primary page | Supporting pages |
| --- | --- | --- |
| African settlement infrastructure | ekoinfrastructure `/` | ekorails `/`, eko `/settlement-explained` |
| Cross-border trade settlement Africa | ekorails `/` | eko `/corridor-intelligence` |
| Institutional payment infrastructure | ekorails `/platform` | ekorails `/`, `/use-cases` |
| West African payment corridors | ekorails `/corridors` | eko `/corridor-intelligence` |
| Nigeria fintech infrastructure | ekorails `/pilot-and-regulatory-pathway` | eko `/policy-and-regulation` |
| B2B cross-border settlement | ekorails `/use-cases` | ekorails `/`, `/platform` |
| African payment interoperability | ekorails `/corridors` | eko `/research/what-papss-does` |
| Trade payment infrastructure | ekorails `/platform` | ekorails `/use-cases` |
| Regulatory sandbox Nigeria | ekorails `/pilot-and-regulatory-pathway` | eko `/policy-and-regulation` |
| Africa GCC trade settlement | eko `/corridor-intelligence` | ekorails `/corridors` (research interest only) |

**Deliberate restraint.** "Africa GCC trade settlement" is a research topic, not a product claim. The
EKORails page that mentions it says plainly that no Africa–GCC corridor is proposed, filed or in
development. Ranking for a term we cannot serve would waste the click and damage credibility with
exactly the audience we want.

## 10.2 Technical SEO

| Item | Implementation |
| --- | --- |
| Sitemaps | Generated per site with `lastmod`, `changefreq`, `priority`. `/thank-you` and `/search` excluded. |
| robots.txt | Allows everything except `/thank-you` and `/admin/`; declares the sitemap. |
| Canonicals | Absolute, self-referencing, extensionless. |
| Pretty URLs | Netlify serves `/platform` from `platform.html`; internal links never use `.html`. |
| Redirects | Single-hop 301s (see `docs/09-redirect-map.md`). |
| Structured data | See table above. Validate with the Rich Results Test after launch. |
| Hreflang | Not used — one language, one region. `og:locale` is `en_GB`. |
| Pagination | Not required at current volume. |
| Duplicate content | The two sites cover different subjects; the only shared text is the footer disclaimer and the regulatory status statement, which are boilerplate rather than page content. |

## 10.3 Core Web Vitals approach

| Metric | Approach |
| --- | --- |
| LCP | Hero is text on a CSS gradient — no hero image to load. One render-blocking stylesheet, no web-font blocking (fonts load via `media="print"` swap with a `noscript` fallback). |
| CLS | All images carry `width`/`height`; the consent bar is fixed-position and does not reflow content; no late-injected banners. |
| INP | One small deferred script per site; no framework; no hydration; menu and tabs are plain DOM handlers. |
| TTFB | Static files on a CDN with immutable asset caching and `must-revalidate` HTML. |
| Payload | ~30 KB CSS, ~4 KB JS, no images on most pages. The search index is fetched only on `/search`. |

Measure with real Lighthouse runs against the deployed preview before launch and record the numbers in
`docs/15-deployment-checklist.md`.
