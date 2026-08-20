# 14. Analytics event plan

Implemented in `src/*/assets/js/site.js`. Events are pushed to `window.ekoLayer` and are only
transmitted after the visitor grants measurement consent. Nothing is sent before that, and the sites
are fully functional if consent is refused.

---

## 14.1 Principles

1. **Privacy first.** No advertising cookies, no cross-site tracking, no data sale, no fingerprinting,
   no session recording, no heatmaps. The audience is bank and regulator staff; surveillance tooling on
   a compliance page is a self-inflicted wound.
2. **Consent before collection.** The queue accumulates locally; a consented loader drains it. Denied
   means denied, permanently, until the visitor clears site data.
3. **Measure decisions, not vanity.** The questions worth answering are: does a bank reviewer reach the
   system boundary diagram, does a regulator reach the pathway page, and does anyone finish the
   partnership form.
4. **No personal data in events.** Event properties never carry names, email addresses, message
   content or free-text field values.

## 14.2 Recommended tool

A privacy-preserving, cookieless analytics tool (Plausible, Fathom or a self-hosted equivalent) with EU
or in-region data processing. `[CONFIRM WITH EKORAILS — final selection and processing region]`

Whatever is chosen must: run without cookies, avoid cross-site identifiers, support custom events,
provide a data processing agreement, and be addable to the CSP `connect-src` as a single named origin.

## 14.3 Event catalogue

| Event | Fired when | Properties |
| --- | --- | --- |
| `page_view` | Every page load | `path`, `title` |
| `section_view` | A `[data-section]` block reaches 40% visibility, once per page view | `section` |
| `cta_click` | A link with `data-cta` is clicked | `cta`, `href` |
| `outbound_click` | A link to another host is clicked | `href`, `host` |
| `email_click` | A `mailto:` link is clicked | `address` |
| `tab_view` | A tab is selected | `tab` |
| `form_start` | First input in a form | `form` |
| `form_prefill` | A `?type=` deep link presets the partnership form | `form`, `type` |
| `form_error` | Submit blocked by validation | `form`, `field` |
| `form_blocked` | Submit blocked by the timing check | `form`, `reason` |
| `form_submit` | Valid submission proceeds | `form`, `org_type` |
| `search` | A search returns results | `query`, `results` |
| `search_no_results` | A search returns nothing | `query` |
| `consent_choice` | A consent choice is made | `choice` |

`section_view` names come from the `data-section` attributes already in the markup: `hero`, `problem`,
`capabilities`, `use_cases`, `transaction_flow`, `regulatory_pathway`, `corridor`, `compliance`,
`partnerships`, `leadership`, `research_bridge`, `final_cta`, and one per page elsewhere.

## 14.4 What each audience's success looks like

| Audience | Signal | Events |
| --- | --- | --- |
| Bank / payment institution | Reaches the system boundary, then the compliance framework | `section_view: platform_boundary` → `cta_click: platform_partner` or `email_click: compliance@` |
| Regulator / policy institution | Reaches the pathway page and reads the tracker | `section_view: pathway_tracker` → `cta_click: pathway_regulator` |
| Enterprise | Reads use cases, then registers pilot interest | `section_view: use_cases` → `cta_click: final_enterprise` |
| Security reviewer | Reaches technology and requests the review pack | `section_view: tech_detail` → `email_click: compliance@` |
| Researcher / journalist | Reaches the source register or an article's sources | `section_view: sources_register`, `outbound_click` to a primary source |

## 14.5 Reports worth building

1. **Partnership funnel by organisation type** — `form_start` → `form_submit`, split by `org_type`.
   Bank and regulator completion rates matter more than total volume.
2. **Boundary diagram reach** — the share of `/platform` sessions that reach `platform_boundary`. If it
   is low, the page is too long before the thing that answers a reviewer's first question.
3. **Regulatory pathway depth** — how far down the tracker people get. This page exists to be read
   completely.
4. **Search terms with no results** — the clearest signal of what Eko Infrastructure should publish next.
5. **Cross-site movement** — `outbound_click` to the other domain, both directions.
6. **Consent rate** — a low rate is fine; a falling rate suggests the bar is being read as a dark pattern.

## 14.6 Explicitly not measured

- Individual visitor identity, or any cross-session identifier.
- Which specific compliance question a visitor read (page-level only, never element-level for legal or
  compliance content).
- Form field values of any kind.
- Anything from the `/admin` route.
- Scroll depth in pixels; only named sections, so the data stays meaningful after a redesign.

## 14.7 Implementation notes

```js
// After consent, the loader drains the queue and takes over transmission:
document.addEventListener('eko:consent', function (e) {
  if (e.detail !== 'granted') return;
  loadAnalytics().then(function () {
    window.__ekoAnalyticsReady = true;
    window.__ekoAnalyticsSend = send;      // provider-specific
    window.ekoLayer.forEach(send);         // flush what was queued pre-consent
  });
});
```

Add the provider origin to `connect-src` (and `script-src` if the tag is remote) in the CSP template in
`build.py` — not to the whole policy, and not by adding `'unsafe-inline'`.

## 14.8 Search Console and Bing

Both domains verified as domain properties. Submit both sitemaps. Watch, weekly for the first eight
weeks: coverage errors, redirect chains from the legacy domains, and the queries the sites actually
appear for — if EKORails starts ranking for consumer remittance queries, the copy has drifted and needs
correcting.
