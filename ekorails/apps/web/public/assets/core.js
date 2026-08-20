/**
 * Client core: API access, rendering primitives and shared formatting.
 *
 * No build step and no framework. The console is served as plain ES modules under a
 * strict Content-Security-Policy with no inline script and no external origins — the
 * client is written to fit the policy rather than the policy being loosened to fit the
 * client. That trade-off is recorded as founder decision FD-010.
 *
 * Two rules the rest of the client depends on:
 *
 *   1. `h()` sets text through `textContent`, never `innerHTML`. There is no path in this
 *      client by which server data becomes markup, so a beneficiary named
 *      `<img onerror=...>` renders as that literal text.
 *   2. Every monetary figure goes through `money()`, which never converts to a JavaScript
 *      number. Amounts arrive from the API as strings and are formatted as strings.
 */

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/**
 * Creates an element.
 *
 * Children that are strings become TEXT NODES. This is the single most important
 * property of this function: it means no value from the API can become markup, whatever
 * it contains, without a deliberate and visible change here.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'html') {
      throw new Error(
        'Refusing to set innerHTML. Server data must never become markup; pass text instead.',
      );
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') {
      for (const [d, v] of Object.entries(value)) el.dataset[d] = String(v);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }

  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }
}

function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)ekorails_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

/** The banner the server most recently reported. Verified against the rendered one. */
let lastServerBanner = null;

/**
 * The dialog that re-asserts the second factor when the server demands one. Registered by
 * app.js rather than defined here, so this module stays free of application chrome.
 */
let stepUpHandler = null;

export function setStepUpHandler(handler) {
  stepUpHandler = handler;
}

export async function api(path, options = {}) {
  const { method = 'GET', body, headers = {} } = options;

  const requestHeaders = { accept: 'application/json', ...headers };
  if (!['GET', 'HEAD'].includes(method)) {
    requestHeaders['x-csrf-token'] = csrfToken();
    if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  }

  const response = await fetch(path, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });

  const headerBanner = response.headers.get('x-ekorails-environment');
  if (headerBanner) lastServerBanner = headerBanner;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, 'UNEXPECTED_RESPONSE', 'The server returned an unexpected response.');
    }
    return { blob: await response.blob(), headers: response.headers };
  }

  const payload = await response.json();

  if (!response.ok) {
    const error = payload.error ?? {};

    // A sensitive action can be refused because the second factor has gone stale rather
    // than because the caller lacks the right. The refused attempt provably did not take
    // effect, so re-asserting the factor and repeating it once is safe — and it is the
    // difference between a control people comply with and one they route around.
    if (error.code === 'STEP_UP_REQUIRED' && stepUpHandler && !options.stepUpRetried) {
      const satisfied = await stepUpHandler(error.message ?? '');
      if (satisfied) return api(path, { ...options, stepUpRetried: true });
    }

    throw new ApiError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.message ?? 'Something went wrong.',
      error.details,
    );
  }

  if (payload.meta?.banner) lastServerBanner = `${payload.meta.environment}; ${payload.meta.banner}`;
  return payload.data;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const put = (path, body) => api(path, { method: 'PUT', body });

/**
 * Confirms that the banner rendered in the page matches what the server says.
 *
 * If the two ever disagree, the page is showing a claim the server does not support —
 * which is precisely the failure the banner exists to prevent. The client blocks rather
 * than rendering a screen it cannot vouch for.
 */
export function verifyBannerIntegrity() {
  if (!lastServerBanner) return true;
  const rendered = document.querySelector('#environment-banner strong')?.textContent ?? '';
  if (lastServerBanner.includes(rendered)) return true;

  document.body.replaceChildren(
    h('div', { class: 'notice notice-danger', style: 'margin:2rem' },
      h('h2', { text: 'Environment banner mismatch' }),
      h('p', {
        text:
          'The environment this page displays does not match what the server reports. The console ' +
          'has stopped rather than show you a screen it cannot vouch for.',
      }),
      h('p', { class: 'mono-inline', text: `Server: ${lastServerBanner}` }),
      h('p', { class: 'mono-inline', text: `Page: ${rendered}` }),
    ),
  );
  return false;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERN = /^INSERT_[A-Z_]+$/;

export function isPlaceholder(value) {
  return typeof value === 'string' && PLACEHOLDER_PATTERN.test(value);
}

/**
 * Formats a monetary amount for display.
 *
 * Deliberately string-based throughout. Converting to a Number to add thousands
 * separators would silently round a large naira amount, and the figure a compliance
 * analyst reads must be the figure in the ledger.
 */
export function money(amount, currency, minorUnits = 2) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const text = String(amount);
  const negative = text.startsWith('-');
  const magnitude = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = magnitude.split('.');

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rounded = roundFractionString(fraction, minorUnits);

  return `${negative ? '-' : ''}${grouped}${rounded ? '.' + rounded : ''}${currency ? ' ' + currency : ''}`;
}

/** Rounds a fractional digit string half-up, without ever becoming a Number. */
function roundFractionString(fraction, places) {
  if (places <= 0) return '';
  if (fraction.length <= places) return fraction.padEnd(places, '0');
  const kept = fraction.slice(0, places);
  const next = fraction.charCodeAt(places) - 48;
  if (next < 5) return kept;
  // Increment the kept digits as a decimal string.
  const digits = kept.split('');
  let i = digits.length - 1;
  while (i >= 0) {
    if (digits[i] === '9') { digits[i] = '0'; i -= 1; }
    else { digits[i] = String(Number(digits[i]) + 1); break; }
  }
  return digits.join('');
}

export function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function dateOnly(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
}

export function relativeTime(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return String(value);
  const seconds = Math.round((Date.now() - then) / 1000);
  const units = [
    [60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'],
  ];
  let amount = seconds;
  let unit = 'second';
  for (const [size, name] of units) {
    if (Math.abs(amount) < size) { unit = name; break; }
    amount = Math.round(amount / size);
    unit = name;
  }
  const formatter = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  return formatter.format(-amount, unit);
}

export function titleCase(value) {
  if (!value) return '';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

const STATE_TONE = {
  completed: 'ok', settled: 'ok', reconciled: 'ok', beneficiary_confirmed: 'ok',
  approved: 'ok', clear: 'ok', matched: 'ok', resolved: 'ok', closed_cleared: 'ok',
  cleared: 'ok', confirmed: 'ok', active: 'ok', available: 'ok', delivered: 'ok',

  failed: 'danger', rejected: 'danger', returned: 'danger', prohibited: 'danger',
  closed_rejected: 'danger', suspended: 'danger', confirmed_match: 'danger',
  unmatched: 'danger', critical: 'danger', high: 'danger', missing_partner_record: 'danger',
  missing_internal_record: 'danger', duplicate: 'danger', infected: 'danger',

  under_investigation: 'warn', additional_information_required: 'warn', expired: 'warn',
  potential_match: 'warn', escalated: 'warn', medium: 'warn', partially_matched: 'warn',
  partially_settled: 'warn', amount_difference: 'warn', pending_approval: 'warn',
  awaiting_information: 'warn', degraded: 'warn', short_funded: 'warn',

  pending_compliance: 'info', pending_business_approval: 'info', compliance_approved: 'info',
  quote_issued: 'info', quote_accepted: 'info', awaiting_funding: 'info',
  funding_confirmed: 'info', ready_for_settlement: 'info', submitted_to_partner: 'info',
  partner_processing: 'info', analyst_review: 'info', manager_review: 'info',
  in_review: 'info', investigating: 'info', open: 'info', low: 'info',
};

export function stateChip(state, label) {
  const tone = STATE_TONE[state] ?? 'neutral';
  return h('span', { class: `chip chip-${tone}`, title: titleCase(state) }, label ?? titleCase(state));
}

export function simulatedChip(text = 'Simulated') {
  return h('span', {
    class: 'chip chip-sim',
    title: 'Produced by a simulator. No real institution, funds or market rate are involved.',
  }, text);
}

export function placeholderChip(value) {
  return h('span', {
    class: 'chip chip-placeholder',
    title:
      'An unresolved placeholder. The CBN Regulatory Sandbox application was not available to this ' +
      'build, so this value has not been confirmed. See the Founder Learning Center decision log.',
  }, value);
}

/** Renders a value that may be a placeholder, without ever presenting one as fact. */
export function valueOrPlaceholder(value) {
  if (value === null || value === undefined || value === '') return '—';
  return isPlaceholder(value) ? placeholderChip(value) : String(value);
}

export function card(title, body, actions) {
  return h('section', { class: 'card' },
    title && h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', text: title }),
      actions && h('div', { class: 'page-actions' }, actions),
    ),
    h('div', { class: typeof body === 'string' ? 'card-body' : 'card-body flush' }, body),
  );
}

export function stat(label, value, note, tone) {
  return h('section', { class: 'card' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat-label', text: label }),
      h('div', {
        class: 'stat-value' + (String(value).length > 12 ? ' small' : ''),
        style: tone ? `color: var(--${tone})` : null,
      }, value),
      note && h('div', { class: 'stat-note' }, note),
    ),
  );
}

/**
 * Renders a table. `columns` entries take the shape
 * `{ key, label, align, render, className }`.
 */
export function table(columns, rows, options = {}) {
  if (!rows || rows.length === 0) {
    return h('div', { class: 'empty', text: options.empty ?? 'Nothing to show.' });
  }
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {},
        h('tr', {}, columns.map((c) =>
          h('th', { class: c.align === 'right' ? 'num' : c.className ?? null }, c.label))),
      ),
      h('tbody', {}, rows.map((row) =>
        h('tr', { onclick: options.onRowClick ? () => options.onRowClick(row) : null,
                  style: options.onRowClick ? 'cursor:pointer' : null },
          columns.map((c) => h('td', {
            class: [c.align === 'right' ? 'num' : '', c.className ?? ''].filter(Boolean).join(' ') || null,
          }, c.render ? c.render(row) : (row[c.key] ?? '—'))),
        ),
      )),
    ),
  );
}

export function notice(tone, title, ...body) {
  return h('div', { class: `notice notice-${tone}` },
    title && h('h3', { text: title }),
    ...body.map((b) => (b instanceof Node ? b : h('p', { text: String(b) }))),
  );
}

export function keyValues(pairs) {
  return h('dl', { class: 'kv' }, pairs.flatMap(([key, value]) => [
    h('dt', { text: key }),
    h('dd', {}, value ?? '—'),
  ]));
}

export function tabs(items, active, onSelect) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map((item) =>
    h('button', {
      class: 'tab', role: 'tab', type: 'button',
      'aria-selected': String(item.key === active),
      onclick: () => onSelect(item.key),
    }, item.label),
  ));
}

export function spinner(label = 'Loading…') {
  return h('div', { class: 'empty', 'aria-busy': 'true', text: label });
}

// ---------------------------------------------------------------------------
// Toasts and modals
// ---------------------------------------------------------------------------

function toastHost() {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

export function toast(tone, title, message) {
  const node = h('div', { class: `toast toast-${tone}` },
    h('div', { class: 'toast-title', text: title }),
    message && h('div', { text: message }),
  );
  toastHost().append(node);
  setTimeout(() => node.remove(), tone === 'error' ? 9000 : 5000);
}

export function reportError(error) {
  if (error instanceof ApiError) {
    const detail = error.details && Object.keys(error.details).length > 0
      ? Object.entries(error.details)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : v}`).join(' · ')
      : null;
    toast('error', error.message, detail ? `${error.code} — ${detail}` : error.code);
  } else {
    toast('error', 'Something went wrong', String(error?.message ?? error));
  }
  // The console keeps the detail; the user gets the safe message.
  console.error(error);
}

/**
 * A modal dialog. Focus is trapped, Escape closes, and focus returns to whatever opened
 * it — the minimum a keyboard user needs to not get stranded.
 */
export function modal({ title, body, confirmLabel = 'Confirm', tone = 'primary', onConfirm }) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    let busy = false;

    const close = (result) => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      resolve(result);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) close(null);
      if (event.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };

    const confirmButton = h('button', {
      class: `btn btn-${tone}`, type: 'button',
      onclick: async () => {
        if (busy) return;
        busy = true;
        confirmButton.disabled = true;
        confirmButton.textContent = 'Working…';
        try {
          const result = onConfirm ? await onConfirm() : true;
          close(result ?? true);
        } catch (error) {
          reportError(error);
          busy = false;
          confirmButton.disabled = false;
          confirmButton.textContent = confirmLabel;
        }
      },
    }, confirmLabel);

    const dialog = h('div', {
      class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
    },
      h('div', { class: 'modal-head', text: title }),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-foot' },
        h('button', { class: 'btn', type: 'button', onclick: () => !busy && close(null) }, 'Cancel'),
        confirmButton,
      ),
    );

    const backdrop = h('div', {
      class: 'modal-backdrop',
      onclick: (event) => { if (event.target === backdrop && !busy) close(null); },
    }, dialog);

    document.body.append(backdrop);
    document.addEventListener('keydown', onKeyDown);
    dialog.querySelector('input, textarea, select, button')?.focus();
  });
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export function field(label, input, hint) {
  const id = `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id, text: label }),
    input,
    hint && h('div', { class: 'hint', text: hint }),
  );
}

export function input(attrs = {}) { return h('input', { type: 'text', ...attrs }); }
export function textarea(attrs = {}) { return h('textarea', attrs); }

export function select(options, attrs = {}) {
  return h('select', attrs, options.map((o) =>
    h('option', { value: o.value, selected: o.selected }, o.label)));
}

/** Downloads a blob the browser already holds. Used for report exports. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
