# 15. Deployment checklist

Two Netlify sites from one repository. Work top to bottom; nothing in §5 happens until §4 is complete.

---

## 1. Repository and build

- [ ] `python3 build.py` completes with no errors (31 pages).
- [ ] `python3 tools/check.py` exits 0 — links, headings, alt text, labels, metadata, disclaimer.
- [ ] `dist/` regenerated and committed, or the build command configured to regenerate on deploy.
- [ ] `git status` clean.

## 2. Netlify — EKORails.com

- [ ] Create the site from this repository.
- [ ] Build command `python3 build.py ekorails`; publish directory `dist/ekorails`;
      `PYTHON_VERSION=3.11`.
- [ ] Add `ekorails.com` as the primary domain; `www.ekorails.com` as an alias.
- [ ] Add `eco-rails.com`, `www.eco-rails.com`, `eco-rail.com`, `www.eco-rail.com` as aliases so the
      301 rules in `netlify.toml` fire.
- [ ] Enable HTTPS (Let's Encrypt) on every domain; confirm certificates cover the aliases.
- [ ] Force HTTPS.
- [ ] Enable Netlify Forms; confirm `partnership` and `updates` are detected after the first deploy.
- [ ] Configure form notifications to the routed inboxes (see `docs/13-form-specifications.md` §13.1).

## 3. Netlify — EkoInfrastructure.com

- [ ] Create the second site from the same repository.
- [ ] Build command `python3 build.py ekoinfrastructure`; publish directory `dist/ekoinfrastructure`.
- [ ] Add `ekoinfrastructure.com` and `www.ekoinfrastructure.com`.
- [ ] Add `eco-settlement.com` and `www.eco-settlement.com` as aliases.
- [ ] Enable HTTPS and force it.
- [ ] Enable Netlify Forms; confirm `research_contact` is detected.
- [ ] Enable Netlify Identity, **invite-only**, and Git Gateway scoped to this repository.
- [ ] Require two-factor authentication on every Identity account.
- [ ] Vendor the CMS bundle: `npm install decap-cms-app`, copy `dist/decap-cms.js` to
      `src/ekoinfrastructure/admin/decap-cms.js`, commit. **Do not load it from a CDN** — the CSP is
      `script-src 'self'` and `/admin` is the one route that can write to the repository.
- [ ] Invite editors and assign roles: Author, Editor, Compliance.

## 4. Email and DNS

- [ ] `info@`, `partnerships@`, `compliance@` live on ekorails.com; `media@` live on
      ekoinfrastructure.com; all four tested end to end.
- [ ] SPF, DKIM and DMARC configured on both sending domains — without these, confirmation emails to
      bank compliance contacts will be quarantined.
- [ ] Legacy `@eco-rails.com` and `@eco-settlement.com` mailboxes forwarded for at least 12 months.
- [ ] Send a test enquiry through each of the three forms and confirm both the acknowledgement and the
      internal notification arrive.

## 5. Content sign-off — blocking

- [ ] **Every `[CONFIRM WITH EKORAILS]`, `[INSERT VERIFIED FIGURE]` and `[SUBJECT TO REGULATORY
      APPROVAL]` placeholder resolved or consciously retained.** Run:
      `grep -rn "CONFIRM WITH EKORAILS\|INSERT VERIFIED FIGURE\|SUBJECT TO REGULATORY APPROVAL" dist/`
- [ ] Regulatory status statement matches the evidence held (`content/regulatory-status.md`), and is
      identical in both `site.json` files.
- [ ] Named compliance officer has signed off `docs/07-regulatory-claim-register.md`.
- [ ] Counsel has signed off the privacy policy, terms of use and regulatory disclaimer, and the
      "draft for legal review" callouts have been removed from those pages.
- [ ] Source register entries S-001 to S-011 verified, or the corresponding figures left as
      placeholders.
- [ ] Leadership names, titles, appointment dates and photographs supplied, or the roles honestly shown
      as unfilled.
- [ ] Company number and registered office published in the footer and on `/contact`.
- [ ] Forbidden-phrase check returns only the four expected files:
      `grep -rniE "near-zero adoption|replacement play|3 to 5 business days|eliminates FX|cents on the dollar|every revenue dollar|every transaction is compliant|architecture complete|active corridor|largest diaspora|three times the volume|\\\$200 ?billion|CBN-adjacent" dist/`

      **Expected matches — do not delete these.** Each is a negation or a withdrawal, not a claim:
      `ekoinfrastructure/data-and-sources.html` (the "claims we do not make" list),
      `ekoinfrastructure/research/what-papss-does.html` ("We do not publish either claim"),
      `ekorails/corridors.html` ("no active corridor and no launched service"), and
      `ekoinfrastructure/search-index.json` (derived from the two pages above).
      **Any match in any other file is a real finding.**

## 6. Technical verification on the deploy preview

- [ ] Lighthouse on `/`, `/platform`, `/compliance-and-risk` and one article: performance, accessibility,
      best practices and SEO all ≥ 95. Record the numbers here: `[RECORD]`
- [ ] Core Web Vitals within thresholds on mobile emulation (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms).
- [ ] Keyboard-only pass on the home page, the partnership form and the mobile menu: skip link works,
      focus is always visible, Escape closes the menu and returns focus, no focus traps.
- [ ] Screen-reader pass over the boundary diagram and the corridor figure — the `<desc>` text must make
      each diagram comprehensible without sight.
- [ ] 320px width: no horizontal scrolling on any page; tables scroll inside their own containers.
- [ ] Security headers present and correct: `curl -sI https://<preview>/ | grep -iE "strict-transport|content-security|x-content-type|x-frame|referrer|permissions"`
- [ ] CSP produces **no console violations** on any page — the inline JSON-LD hashes must match.
- [ ] Test with JavaScript disabled: navigation, forms, and all content remain usable.
- [ ] `sitemap.xml`, `robots.txt` and `site.webmanifest` served correctly on both domains.
- [ ] Open Graph images render in a link preview debugger (LinkedIn and Slack at minimum — this audience
      shares links in both).
- [ ] Structured data passes the Rich Results Test for Organization, Article, FAQ and Breadcrumb.
- [ ] Search on ekoinfrastructure.com returns results, handles no-results, and works from a `?q=` link.

## 7. Redirects

- [ ] Every row of `docs/09-redirect-map.md` tested against the preview.
- [ ] All redirects are single-hop 301s — no chains.
- [ ] `eco-settlement.com/*` lands on `/settlement-explained`, not on a 404 or the home page.
- [ ] Crawl of the legacy sites completed and any uncovered URL added to the relevant `netlify.toml`.

## 8. Analytics and consent

- [ ] Measurement tool selected, data processing agreement signed, region confirmed.
- [ ] Provider origin added to `connect-src` (and `script-src` if remote) in the CSP template in
      `build.py`. **Do not add `'unsafe-inline'`.**
- [ ] Consent bar: nothing transmitted before a choice; "Essential only" genuinely suppresses
      transmission; the choice persists.
- [ ] Custom events firing (`docs/14-analytics-event-plan.md` §14.3).
- [ ] Search Console and Bing Webmaster: both domains verified, both sitemaps submitted, Change of
      Address submitted from each legacy property.

## 9. Backup and rollback

- [ ] Git is the backup of record: source, content and build output are all versioned.
- [ ] Netlify deploy history retained; confirm one-click rollback to the previous deploy works — test it
      once before launch rather than during an incident.
- [ ] Form submissions exported on a defined schedule; retention set (`docs/13` §13.5).
- [ ] Repository mirrored to a second remote or an offline archive.
- [ ] Documented rollback procedure: identify the last good deploy → publish it → open an issue with
      the failing commit. Named owner: `[CONFIRM WITH EKORAILS]`
- [ ] Documented emergency-correction procedure for an inaccurate regulatory statement, with a target
      time to correction: `[CONFIRM WITH EKORAILS]`

## 10. Launch

- [ ] DNS cutover for all four domains.
- [ ] Certificates issued and valid on every domain and alias.
- [ ] Redirect map retested live.
- [ ] Forms retested live.
- [ ] Social profiles, directory listings, email signatures and any printed material updated to the new
      names and domains.
- [ ] Legacy analytics properties set to read-only and retained.
- [ ] Post-launch monitoring: Search Console coverage weekly for eight weeks; form deliverability
      weekly for four; CSP violation reports if a reporting endpoint is configured.

---

## Known technical debt to record openly

| Item | Why it stands | Fix |
| --- | --- | --- |
| `style-src 'unsafe-inline'` | Pages use inline `style` attributes for one-off layout adjustments | Move those to utility classes and drop `'unsafe-inline'` from `style-src` |
| CMS content is not yet rendered by the build | The four seeded articles are hand-authored fragments so the design could be proven first | `docs/12-cms-content-model.md` §12.5 |
| No CAPTCHA | Deliberate — added in response to spam evidence, not in anticipation | `docs/13-form-specifications.md` §13.4 |
| `dist/` committed | Lets a non-developer preview and drag-drop deploy | Add `dist/` to `.gitignore` once CI builds are trusted |
