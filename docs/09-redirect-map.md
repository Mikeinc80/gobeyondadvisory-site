# 9. Redirect map

Implemented in `src/ekorails/netlify.toml` and `src/ekoinfrastructure/netlify.toml`, copied into each
build. All redirects are **301 (permanent)**.

---

## 9.1 Domain-level

| From | To | Status |
| --- | --- | --- |
| `eco-rails.com/*` | `ekorails.com/:splat` | 301 |
| `www.eco-rails.com/*` | `ekorails.com/:splat` | 301 |
| `eco-rail.com/*` | `ekorails.com/:splat` | 301 |
| `www.eco-rail.com/*` | `ekorails.com/:splat` | 301 |
| `www.ekorails.com/*` | `ekorails.com/:splat` | 301 |
| `eco-settlement.com/` and `/*` | `ekoinfrastructure.com/settlement-explained` | 301 |
| `www.eco-settlement.com/` and `/*` | `ekoinfrastructure.com/settlement-explained` | 301 |
| `www.ekoinfrastructure.com/*` | `ekoinfrastructure.com/:splat` | 301 |

The legacy domains must be added to the corresponding Netlify site as domain aliases (or pointed at it
by DNS) for these rules to fire. Keep the legacy registrations for at least 24 months so link equity
and any printed references keep resolving.

## 9.2 eco-rails.com paths → ekorails.com

| Legacy path | Destination | Rationale |
| --- | --- | --- |
| `/index.html`, `/home` | `/` | Canonicalise |
| `/about`, `/about-us`, `/team` | `/leadership` | Nearest equivalent; named accountability |
| `/product`, `/products`, `/rails`, `/infrastructure` | `/platform` | Product content now lives in the platform page |
| `/solutions` | `/use-cases` | |
| `/network` | `/corridors` | Deliberate: "network" implied scale we do not have |
| `/security` | `/compliance-and-risk` | |
| `/compliance` | `/compliance-and-risk` | |
| `/regulation`, `/regulatory`, `/sandbox`, `/roadmap` | `/pilot-and-regulatory-pathway` | All regulatory-status content consolidated |
| `/partners-and-investors`, `/investors`, `/invest` | `/partners` | **Important:** investor paths now land on a page that explicitly states no investment is solicited |
| `/contact-us` | `/contact` | |
| `/blog`, `/blog/*`, `/insights`, `/insights/*`, `/research` | `ekoinfrastructure.com/` | Editorial content moves to the research platform |
| `/settlement` | `ekoinfrastructure.com/settlement-explained` | |
| `/privacy` | `/privacy-policy` | |
| `/terms` | `/terms-of-use` | |
| `/disclaimer` | `/regulatory-disclaimer` | |

## 9.3 eco-settlement.com paths → ekoinfrastructure.com

| Legacy path | Destination |
| --- | --- |
| `/`, `/*` (unmatched) | `/settlement-explained` |
| `/settlement`, `/what-is-settlement` | `/settlement-explained` |
| `/clearing`, `/clearing-vs-settlement` | `/research/clearing-versus-settlement` |
| `/correspondent-banking` | `/settlement-explained#correspondent-banking` |
| `/fx`, `/fx-liquidity` | `/settlement-explained#fx-liquidity` |
| `/finality` | `/settlement-explained#settlement-finality` |
| `/stablecoins`, `/stablecoin-settlement` | `/settlement-explained#stable-value` |
| `/papss` | `/research/what-papss-does` |
| `/swift` | `/research/swift-is-a-messaging-network` |
| `/compliance` | `/policy-and-regulation#aml` |
| `/compliance-architecture` | `/technology#compliance-architecture` |
| `/transaction-monitoring` | `/technology#monitoring` |
| `/auditability` | `/technology#auditability` |
| `/data-sovereignty` | `/technology#data-sovereignty` |
| `/switches` | `/settlement-explained#the-five-things` |
| `/central-bank-settlement` | `/settlement-explained#settlement-finality` |
| `/corridors`, `/african-trade-corridors` | `/corridor-intelligence` |
| `/blog`, `/blog/*` | `/` |
| `/about-us` | `/about` |
| `/sources` | `/data-and-sources` |
| `/privacy` | `ekorails.com/privacy-policy` |
| `/terms` | `ekorails.com/terms-of-use` |

## 9.4 Before switching DNS

1. **Crawl the live legacy sites** and export every URL that has (a) any inbound link, (b) any organic
   traffic in the last 12 months, or (c) any impressions in Search Console.
2. Map each to its nearest equivalent. Where no equivalent exists, map to the closest topic page — not
   to the home page, and never to a 404.
3. Anything mapped to the home page by default is a mapping failure; find a better target.
4. Add any URL not already covered above to the relevant `netlify.toml`.
5. After cutover, monitor Search Console coverage weekly for eight weeks and fix every soft-404 and
   redirect chain (redirects must be single-hop).

## 9.5 Things to update alongside the redirects

| Item | Action |
| --- | --- |
| Internal links | Done — all internal links in the build are relative and extensionless |
| Email addresses | `info@`, `partnerships@`, `compliance@` on ekorails.com; `media@` on ekoinfrastructure.com. Legacy `@eco-rails.com` / `@eco-settlement.com` mailboxes to forward for at least 12 months |
| Canonical tags | Generated per page from `site.json → base_url` |
| Social profiles | Update handles, bios, links and profile images to EKORails / Eko Infrastructure `[CONFIRM WITH EKORAILS]` |
| Search Console | Add and verify both new properties (domain properties). Use the Change of Address tool from each legacy property. Submit both sitemaps |
| Analytics | New properties for both domains; annotate the cutover date; keep legacy properties read-only |
| Favicons | New SVG favicons and PNG touch icons ship in both builds |
| Open Graph images | New 1200×630 PNGs generated from SVG masters, referenced absolutely |
| Structured data | Organization, WebSite, BreadcrumbList, FAQPage and Article emitted by the build; validate after launch |
| Footer legal names | "EKORails LTD" everywhere; company number and registered office `[CONFIRM WITH EKORAILS]` |
| Third-party listings | Update any directory, accelerator, press or partner listing that still says ECO Rails / ECO Settlement |
