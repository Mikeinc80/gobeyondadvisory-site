# 13. Form specifications

Three forms across the two sites. All are progressively enhanced: they submit and validate without
JavaScript, and the enhancement adds routing, conditional requirements, timing checks and analytics.

---

## 13.1 Partnership enquiry — `/partners#enquiry`

`form[data-form="partnership"]`, `name="partnership"`, `method="POST"`, `action="/thank-you"`.

The brief asked for seven partnership forms. This is implemented as **one form with seven routes**: the
organisation-type selector determines validation, routing and the responding team. Seven near-identical
forms would have produced seven near-identical failure modes and a worse experience for the person
filling one in; the routing outcome is identical.

| Field | Name | Type | Required | Validation |
| --- | --- | --- | --- | --- |
| Full name | `full_name` | text | yes | 1–120 chars, `autocomplete="name"` |
| Position | `position` | text | yes | 1–120 chars |
| Organisation | `organization` | text | yes | 1–160 chars |
| Country | `country` | text | yes | 1–80 chars |
| Work email | `work_email` | email | yes | HTML5 email + pattern; hint asks for an organisational address |
| Organisation type | `organization_type` | select | yes | One of the eight values below |
| Proposed partnership | `proposed_partnership` | text | yes | ≤200 chars, one line |
| Licence or regulatory status | `licence_status` | text | conditional | **Required** when type is bank/payment institution, FX/liquidity, or regulator |
| Expected corridor | `expected_corridor` | text | no | ≤120 chars |
| Expected volume range | `volume_range` | select | no | Six bands; hint states it is indicative and not a commitment |
| Message | `message` | textarea | yes | ≤4000 chars; hint asks not to send confidential information before an NDA |
| Consent | `consent` | checkbox | yes | Links to the privacy policy; states this is not an application for a financial service |

**Organisation types and routing**

| Value | Label | Routed to |
| --- | --- | --- |
| `bank_or_payment_institution` | Bank or licensed payment institution | Compliance officer |
| `enterprise_or_trade` | Enterprise or trade organisation | Partnerships |
| `fx_or_liquidity` | FX or liquidity provider | Compliance officer |
| `technology_provider` | Technology or cybersecurity provider | Partnerships |
| `compliance_provider` | Identity or compliance provider | Compliance officer |
| `regulator_or_government` | Government, regulator or policy institution | Compliance officer |
| `research_organization` | Research organisation | Media / research |
| `general` | General institutional enquiry | Partnerships |

**Deep links.** `?type=institution|bank|enterprise|regulator|technology|compliance|research|fx`
preselects the type. The home page's three final CTAs use `institution`, `regulator` and `enterprise`.

**Explicitly not collected:** investment interest, ticket size, valuation, funding stage. The form
carries a visible callout stating that EKORails does not solicit investment through this website and
does not accept investment enquiries through this form.

## 13.2 Institutional updates — `/news`

`form[data-form="updates"]`. Fields: `full_name` (required), `organization` (required), `work_email`
(required), `consent` (required). Consent text covers both the update list and the privacy policy.
Single-click unsubscribe in every message.

## 13.3 Research and media contact — `ekoinfrastructure.com/contact`

`form[data-form="research_contact"]`. Fields: `full_name` (required), `organization`, `work_email`
(required), `enquiry_type` (required: correction · data question · media · research partnership ·
republish · other), `page_url`, `message` (required), `consent` (required).

A submission with `enquiry_type = correction` is an editorial input, not a marketing lead: it goes to
an editor, and if it touches EKORails' regulatory status it also goes to the compliance officer.

---

## 13.4 Anti-spam

Four layers, none of which burden a legitimate user:

1. **Honeypot.** `company_website`, off-screen via `.hp`, `aria-hidden="true"`, `tabindex="-1"`,
   `autocomplete="off"`, with an `aria-label` so it is unambiguous to assistive technology. Declared to
   the host with `netlify-honeypot="company_website"`.
2. **Submission timing.** `form_render_ts` is stamped on render; a submission under 2.5 seconds is
   blocked client-side and logged as `form_blocked`.
3. **CAPTCHA.** Add Cloudflare Turnstile or Netlify's built-in reCAPTCHA if spam appears. Not enabled
   by default: it costs accessibility and privacy, and should be turned on in response to evidence, not
   in anticipation. If enabled, add the widget origin to the CSP `script-src` and `frame-src`.
4. **Rate limiting.** At the host layer, per IP. `[CONFIRM WITH EKORAILS — threshold]`

## 13.5 Secure handling

| Concern | Approach |
| --- | --- |
| Transport | HTTPS only, HSTS with preload |
| Destination | Netlify Forms submissions (or an equivalent handler); no third-party form service that would receive the data |
| Storage | Submissions exported to the CRM on a defined cycle and deleted from the form store; retention `[CONFIRM WITH EKORAILS]` |
| Access | Only named EKORails staff; access reviewed on the same cycle as other systems |
| Consent record | Stored with each submission: timestamp, page, and the exact consent wording shown |
| No sensitive data | Forms must never collect identity documents, financial account details or payment credentials; the message hint asks users not to send confidential information before an NDA |
| Injection | All fields are length-limited and typed; output is escaped wherever a submission is displayed |

## 13.6 Confirmation emails

| Form | To sender | To EKORails |
| --- | --- | --- |
| Partnership | Acknowledgement, expected response time, and a restatement that the enquiry creates no obligation and that EKORails is not licensed | Full submission to the routed inbox, subject prefixed with the organisation type |
| Updates | Confirmation of subscription with a one-click unsubscribe link | Notification to partnerships@ |
| Research contact | Acknowledgement; correction submissions state that corrections are reviewed by an editor | Full submission to media@; corrections touching regulatory status copied to compliance@ |

Sender domain must be authenticated with SPF, DKIM and DMARC before launch, or institutional mail
filters will quarantine the confirmations — which for a bank compliance contact reads as an unanswered
enquiry.

## 13.7 Validation behaviour

- Native HTML5 constraint validation carries the interaction; the script only reports and focuses.
- Errors are revealed by `:user-invalid`, so nothing turns red before the user has interacted.
- On submit failure, focus moves to the first invalid control and a `form_error` event records the
  field name.
- Error text is specific ("Please enter a valid work email address"), never "invalid input".
- Every control has a `<label for>`; hints are adjacent and read by assistive technology in order.
- All targets are at least 44px high; the consent checkbox is 20px with a large label hit area.
