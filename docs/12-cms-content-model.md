# 12. CMS content model

Implemented in `src/ekoinfrastructure/admin/config.yml` (Decap CMS, formerly Netlify CMS).
Content lives in `content/` as Markdown with YAML front matter, so every editorial change is a
reviewable, revertible commit rather than an opaque database write.

**Honest statement of how it works:** these are static sites. Saving in the CMS commits to the
repository and triggers a rebuild, which typically takes under a minute. Editors never touch templates
or code, and market data and regulatory statements can be updated without a developer — but the site is
rebuilt, not patched live. Anyone told otherwise will be surprised at the wrong moment.

---

## 12.1 Collections

### `research` — research articles (`content/research/*.md`)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string | yes | Sentence case; becomes the H1 |
| `slug` | string | yes | `^[a-z0-9-]+$` |
| `description` | text | yes | 80–165 characters, enforced by pattern |
| `lede` | text | yes | Standfirst |
| `topic` | select | yes | Settlement · Corridors · Policy · Technology · Reference |
| `format` | select | yes | Explainer · Method · Corridor note · Analysis · Data note |
| `author` | string | yes | A named person or the editorial team. Never blank |
| `published` | date | yes | |
| `updated` | date | yes | Changes only when the content changes |
| `reading_time` | int | yes | Minutes |
| `review_state` | select | yes | draft · source_check · regulatory_review · published |
| `review_due` | date | conditional | **Required** if the piece contains market data or a regulatory statement |
| `contains_market_data` | bool | yes | Gates the source-check step |
| `contains_regulatory_statement` | bool | yes | Gates the compliance-review step |
| `body` | markdown | yes | Footnote markers `[^n]` |
| `sources` | list | conditional | Each: `source_id`, `title`, `publisher`, `period`, `url`, `retrieved` |
| `related` | relation | no | Other research pieces; empty means auto-suggest by topic |
| `ekorails_link` | string | no | The relevant EKORails page |
| `corrections` | list | no | Each: `date`, `note`. Rendered at the foot of the piece |

### `glossary` — terms (`content/glossary/*.md`)

`term` · `definition` · `contested` (bool) · `see_also` · `source_id` · `updated`.

### `sources` — the source register (`content/sources/*.md`)

`source_id` (`^S-[0-9]{3}$`) · `claim` · `publisher` · `title` · `url` · `period` · `retrieved` ·
`definition_note` ("what exactly is counted") · `status` (pending · verified · estimate · withdrawn) ·
`used_on` (list of pages) · `review_due`.

**Enforced rule:** a figure whose source entry is `pending` renders as a placeholder, not as a number.

### `news` — EKORails updates (`content/news/*.md`)

`title` · `date` · `category` (Regulatory · Company · Partnership · Platform · Research) · `body` ·
**`evidence`** (what document supports this — required before publication) · `review_state` ·
`link_label` · `link_url`.

### `settings` → `regulatory_status` (`content/regulatory-status.md`) — singleton

The single source of truth for how EKORails LTD's regulatory status is described.

`stage` (prepared · applied · admitted · closed) · `statement` (published verbatim) ·
`not_licensed_statement` · `evidence_held` · `evidence_date` · `approved_by` · `approved_on` ·
`next_review`.

Changing this file changes the footer and status lines on every page of both websites. Only the named
compliance officer may approve a change, and `site.json` on both sites must be updated in the same
commit.

---

## 12.2 Editorial workflow

`publish_mode: editorial_workflow` turns every save into a pull request, which maps onto the four
states published at `/about#editorial`:

| State | Who | Gate |
| --- | --- | --- |
| **Draft** | Author | Sources captured while writing, not retrofitted |
| **Source check** | Editor | Every figure verified against its primary source; register entries created or updated with retrieval dates |
| **Regulatory review** | Named compliance officer | Any statement touching regulatory status, licensing, partners or platform capability checked against the evidence standard |
| **Published** | Editor | Publication and last-updated dates set; a `review_due` date recorded |

A piece with `contains_market_data: true` cannot pass source check while any cited `source_id` is
`pending`. A piece with `contains_regulatory_statement: true` cannot be published without the
compliance officer's approval on the pull request.

## 12.3 Re-verification

Every piece carrying market data or a regulatory statement has a `review_due` date. A scheduled job (or
a weekly manual check against the CMS view filter "Review overdue") surfaces anything past its date.
The response is either re-verification with a new retrieval date, or replacement of the figure with a
placeholder. A correct figure from two years ago is a wrong figure today.

## 12.4 Access and security

- Netlify Identity, **invite-only**. No open registration.
- Two-factor authentication required on every editor account.
- Git Gateway scoped to this repository only.
- Roles: Author (create and edit drafts), Editor (source check, publish), Compliance (the only role
  able to approve a change to `content/regulatory-status.md`).
- `/admin/*` is `noindex, nofollow` and carries its own restricted Content-Security-Policy.
- The CMS bundle is **vendored** into `/admin/decap-cms.js` rather than loaded from a CDN, so the
  strict `script-src 'self'` policy holds on the one route that can write to the repository.
- Every change is a commit: full history, attribution and one-click revert.

## 12.5 Extending the build to render CMS content

The four seeded articles are hand-authored fragments so the design and article furniture could be
proven first. To render `content/research/*.md` instead:

1. Add a Markdown reader to `build.py` (front matter is already YAML; the standard library plus a small
   Markdown renderer is sufficient — no framework needed).
2. Map front matter onto the existing page `meta` structure; `article.author`, `article.published` and
   `article.updated` already drive the Article JSON-LD.
3. Reuse the existing article template markup, which is where the byline, source block, related list
   and disclosure callout already live.
4. Refuse to render any piece whose `review_state` is not `published`, and refuse to render a figure
   whose `source_id` is `pending`.

Point 4 is the one that matters: the build should be the last line of defence, not just the CMS.
