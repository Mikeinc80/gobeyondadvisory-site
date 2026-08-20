/**
 * Auditor and Regulator Portal.
 *
 * This is the console that has to be honest when it is inconvenient. It states what
 * EKORails is not, it shows placeholders as placeholders rather than as values, and where
 * something is not measured it says so instead of showing a comforting number.
 *
 * It is read-only in every direction: the Auditor role holds no write permission
 * anywhere in the system, which is enforced by the API and by the database grants, not by
 * the absence of buttons on this page.
 */

import {
  h, get, api, card, stat, table, notice, keyValues, stateChip, simulatedChip,
  money, dateTime, dateOnly, titleCase, valueOrPlaceholder, placeholderChip, isPlaceholder,
  toast, reportError, downloadBlob, select, input, field, modal,
} from './core.js';

// ---------------------------------------------------------------------------

export async function regulatorOverview(ctx) {
  const [overview, boundary] = await Promise.all([
    get('/api/regulator/overview'),
    get('/api/system/regulatory-boundary'),
  ]);

  const env = overview.environment;
  const controls = overview.control_effectiveness;
  const activity = overview.transaction_activity;

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Supervisory view' }),
        h('p', { class: 'page-sub', text: 'Scope, activity, controls, incidents and availability' }),
      ),
    ),

    notice('warning', 'What EKORails is not',
      h('p', { text: `${boundary.entity} is not:` }),
      h('ul', {}, boundary.ekorails_is_not.map((claim) => h('li', { text: titleCase(claim.replace(/^an? /, '')) }))),
      h('p', { text: 'How that is enforced rather than merely asserted:' }),
      h('ul', {}, boundary.how_this_is_enforced.map((line) => h('li', { text: line }))),
    ),

    h('div', { class: 'grid grid-4' },
      stat('Environment', env.mode, env.banner),
      stat('Live funds', env.live_funds_enabled ? 'ENABLED' : 'Disabled',
        `${env.release_gates_met} of ${env.release_gates_total} release gates met`,
        env.live_funds_enabled ? 'danger' : null),
      stat('Audit chain', controls.audit_chain_intact ? 'Intact' : 'BROKEN',
        'Verified in SQL, not by the application',
        controls.audit_chain_intact ? null : 'danger'),
      stat('Ledger', controls.ledger_balanced ? 'Balanced' : 'OUT OF BALANCE',
        'Debits equal credits in every currency',
        controls.ledger_balanced ? null : 'danger'),
    ),

    card('Sandbox admission', h('div', { class: 'card-body' },
      h('p', { text: overview.pilot_scope.sandbox_admission_status }),
      h('p', { class: 'ledger-explain', text: overview.pilot_scope.status_note }),
    ), null),

    card('Corridor and limits', h('div', {},
      table([
        { key: 'code', label: 'Corridor', className: 'mono' },
        { key: 'origin_country', label: 'From', render: (c) => valueOrPlaceholder(c.origin_country) },
        { key: 'destination_country', label: 'To', render: (c) => valueOrPlaceholder(c.destination_country) },
        { key: 'origin_currency', label: 'Send', render: (c) => valueOrPlaceholder(c.origin_currency) },
        { key: 'destination_currency', label: 'Receive', render: (c) => valueOrPlaceholder(c.destination_currency) },
        { key: 'per_transaction_limit', label: 'Per transaction', align: 'right',
          render: (c) => limitCell(c.per_transaction_limit, c.limit_currency) },
        { key: 'daily_limit', label: 'Daily', align: 'right',
          render: (c) => limitCell(c.daily_limit, c.limit_currency) },
        { key: 'monthly_limit', label: 'Monthly', align: 'right',
          render: (c) => limitCell(c.monthly_limit, c.limit_currency) },
        { key: 'pilot_aggregate_cap', label: 'Pilot cap', align: 'right',
          render: (c) => limitCell(c.pilot_aggregate_cap, c.limit_currency) },
        { key: 'is_placeholder', label: 'Confirmed',
          render: (c) => (c.is_placeholder
            ? h('span', { class: 'chip chip-placeholder' }, 'Unconfirmed')
            : h('span', { class: 'chip chip-ok' }, 'Confirmed')) },
      ], overview.pilot_scope.corridors),
    )),

    h('div', { class: 'grid grid-2' },
      card('Activity', h('div', { class: 'card-body' }, keyValues([
        ['Transactions', activity.transactions_total],
        ['Completed', activity.transactions_completed],
        ['Unsuccessful', activity.transactions_unsuccessful],
        ['Completed value', money(activity.completed_value, activity.currency)],
        ['Compliance cases', activity.compliance_cases],
        ['Screening alerts', activity.screening_alerts],
        ['Exceptions', activity.exceptions],
        ['Complaints', activity.complaints],
        ['Security incidents', activity.security_incidents],
      ])), null),

      card('Participants', table([
        { key: 'display_code', label: 'Code', className: 'mono' },
        { key: 'onboarding_status', label: 'Status', render: (p) => stateChip(p.onboarding_status) },
        { key: 'risk_rating', label: 'Risk', render: (p) => stateChip(p.risk_rating) },
        { key: 'suspended', label: 'Suspended', render: (p) => (p.suspended ? 'Yes' : 'No') },
      ], overview.approved_participants, { empty: 'No participants.' })),
    ),

    card('Control effectiveness', h('div', {},
      h('div', { class: 'card-body' }, keyValues([
        ['Audit hash chain',
          controls.audit_chain_intact
            ? h('span', { class: 'chip chip-ok' }, 'Intact')
            : h('span', { class: 'chip chip-danger' }, 'Broken')],
        ['Ledger balance',
          controls.ledger_balanced
            ? h('span', { class: 'chip chip-ok' }, 'Balanced')
            : h('span', { class: 'chip chip-danger' }, 'Out of balance')],
        ['Declared state transitions', String(controls.state_machine_edges)],
      ])),
      table([
        { key: 'risk_ref', label: 'Reference', className: 'mono' },
        { key: 'category', label: 'Category', render: (c) => titleCase(c.category) },
        { key: 'title', label: 'Risk' },
        { key: 'control_status', label: 'Control status', render: (c) => stateChip(c.control_status) },
        { key: 'blocks_pilot', label: 'Blocks pilot',
          render: (c) => (c.blocks_pilot
            ? h('span', { class: 'chip chip-danger' }, 'Yes')
            : h('span', { class: 'chip chip-neutral' }, 'No')) },
      ], controls.controls, { empty: 'No controls recorded.' }),
    )),

    card('Incidents', h('div', {},
      h('p', { class: 'card-body ledger-explain',
        text:
          'Incidents marked as simulated were staged for demonstration. They are labelled as such ' +
          'so nobody reads a rehearsal as a real event.' }),
      table([
        { key: 'reference', label: 'Reference', className: 'mono' },
        { key: 'title', label: 'Incident' },
        { key: 'severity', label: 'Severity', render: (i) => stateChip(i.severity) },
        { key: 'category', label: 'Category', render: (i) => titleCase(i.category) },
        { key: 'status', label: 'Status', render: (i) => stateChip(i.status) },
        { key: 'personal_data_involved', label: 'Personal data', render: (i) => (i.personal_data_involved ? 'Yes' : 'No') },
        { key: 'notification_required', label: 'Notification required', render: (i) => (i.notification_required ? 'Yes' : 'No') },
        { key: 'notified_at', label: 'Notified', render: (i) => (i.notified_at ? dateTime(i.notified_at) : '—') },
        { key: 'detected_at', label: 'Detected', render: (i) => dateTime(i.detected_at) },
        { key: 'is_simulated', label: '', render: (i) => (i.is_simulated ? simulatedChip('Staged') : null) },
      ], overview.incidents, { empty: 'No incidents recorded.' }),
    )),

    h('div', { class: 'grid grid-2' },
      card('System availability', h('div', { class: 'card-body' },
        h('p', { text: overview.system_availability }),
        h('p', {
          class: 'footnote',
          text:
            'An uptime figure that nothing measures is worse than no figure at all, so none is shown.',
        }),
      ), null),

      card('Personal data', h('div', { class: 'card-body' },
        h('p', { text: overview.personal_data_note }),
      ), null),
    ),

    card('Who does what', table([
      { key: 'activity', label: 'Activity' },
      { key: 'performed_by', label: 'Performed by' },
      { key: 'licensed', label: 'Requires a licence',
        render: (r) => (r.licensed
          ? h('span', { class: 'chip chip-info' }, 'Yes — a licensed partner')
          : h('span', { class: 'chip chip-neutral' }, 'No')) },
    ], boundary.who_does_what)),

    card('Release gates', h('div', {},
      h('p', { class: 'card-body ledger-explain',
        text:
          'Live money movement requires every gate below to be met, and none of them can be set from ' +
          'any user interface. They are process-level evidence requirements, not switches.' }),
      table([
        { key: 'key', label: 'Gate', className: 'mono' },
        { key: 'description', label: 'What it requires' },
        { key: 'evidence_required', label: 'Evidence' },
        { key: 'met', label: 'Met',
          render: (g) => (g.met
            ? h('span', { class: 'chip chip-ok' }, 'Met')
            : h('span', { class: 'chip chip-warn' }, 'Not met')) },
      ], boundary.release_gates),
    )),
  );
}

function limitCell(value, currency) {
  if (value === null || value === undefined) {
    return h('span', { class: 'chip chip-placeholder' }, 'Not set');
  }
  return h('span', {}, money(value, isPlaceholder(currency) ? null : currency), ' ',
    isPlaceholder(currency) ? placeholderChip(currency) : null);
}

// ---------------------------------------------------------------------------

const AUDIT_CATEGORIES = [
  'authentication', 'authorisation', 'data_access', 'data_change', 'configuration_change',
  'transaction_lifecycle', 'compliance_decision', 'security_event', 'export',
];

export async function auditTrail(ctx) {
  const category = ctx.query.get('category') ?? '';
  const action = ctx.query.get('action') ?? '';

  const query = new URLSearchParams({ limit: '200' });
  if (category) query.set('category', category);
  if (action) query.set('action', action);

  const [events, verification, me] = await Promise.all([
    get(`/api/audit/events?${query.toString()}`),
    get('/api/audit/verify'),
    get('/api/me'),
  ]);

  const categoryFilter = select(
    [{ value: '', label: 'Every category' },
      ...AUDIT_CATEGORIES.map((c) => ({ value: c, label: titleCase(c), selected: c === category })),
    ],
    {
      id: 'audit-category',
      onchange: (e) => ctx.navigate(`/regulator/audit${e.target.value ? `?category=${e.target.value}` : ''}`),
    },
  );

  const actionSearch = input({ placeholder: 'Search the action, e.g. login', value: action });
  const searchForm = h('form', {
    onsubmit: (event) => {
      event.preventDefault();
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (actionSearch.value.trim()) params.set('action', actionSearch.value.trim());
      ctx.navigate(`/regulator/audit${params.toString() ? `?${params.toString()}` : ''}`);
    },
    style: 'display:flex; gap:.4rem',
  }, actionSearch, h('button', { class: 'btn', type: 'submit' }, 'Search'));

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Audit trail' }),
        h('p', { class: 'page-sub', text: `${events.length} events, newest first` }),
      ),
      h('div', { class: 'page-actions' },
        me.permissions.includes('audit.export')
          ? h('button', { class: 'btn btn-primary', onclick: () => exportAudit() }, 'Export a range')
          : null,
      ),
    ),

    verification.intact
      ? notice('ok', `The hash chain verifies across ${verification.eventsChecked} events`,
          h('p', { text: verification.method }),
          h('p', {
            class: 'footnote',
            text:
              'Each record stores a hash of its predecessor and a hash of its own contents. The check ' +
              'above recomputes both inside the database, so it does not depend on this application ' +
              'telling the truth.',
          }))
      : notice('danger', 'The hash chain does not verify',
          h('p', {
            text:
              'One or more records no longer hash to what they claim. Treat every figure derived from ' +
              'the audit trail as unreliable until this is explained.',
          }),
          h('p', { class: 'mono-inline', text: JSON.stringify(verification.firstBreak ?? {}) })),

    h('div', { class: 'filters' },
      h('label', { class: 'sr-only', for: 'audit-category' }, 'Category'),
      categoryFilter,
      searchForm,
    ),

    card(null, table([
      { key: 'seq', label: 'Seq', className: 'mono' },
      { key: 'occurred_at', label: 'When', render: (e) => dateTime(e.occurred_at) },
      { key: 'category', label: 'Category', render: (e) => titleCase(e.category) },
      { key: 'action', label: 'Action', className: 'mono' },
      { key: 'outcome', label: 'Outcome', render: (e) => stateChip(e.outcome) },
      { key: 'actor_name', label: 'Actor',
        render: (e) => e.actor_name ?? titleCase(e.actor_type ?? 'system') },
      { key: 'actor_role', label: 'Role', render: (e) => (e.actor_role ? titleCase(e.actor_role) : '—') },
      { key: 'organization_code', label: 'Org', className: 'mono' },
      { key: 'transaction_reference', label: 'Transaction', className: 'mono' },
      { key: 'reason', label: 'Reason' },
      { key: 'entry_hash', label: 'Hash', className: 'mono',
        render: (e) => h('span', { class: 'mono-inline', title: e.entry_hash, text: String(e.entry_hash).slice(0, 12) }) },
    ], events, { empty: 'No events match this filter.' })),

    h('p', { class: 'footnote' },
      'A refused action is recorded exactly as carefully as a successful one. An audit trail that ',
      'only contains successes tells you nothing about what somebody tried to do.'),
  );
}

async function exportAudit() {
  const fromSeq = input({ type: 'number', min: '0', placeholder: 'From sequence (blank for the beginning)' });
  const toSeq = input({ type: 'number', min: '0', placeholder: 'To sequence (blank for the end)' });

  const result = await modal({
    title: 'Export an audit range',
    confirmLabel: 'Export',
    body: h('div', {},
      h('p', {
        text:
          'The export carries a manifest proving the range is contiguous and that each record hashes ' +
          'to what it claims. A recipient can verify the export without trusting the exporter.',
      }),
      h('p', { class: 'footnote', text: 'Exporting is itself an audited event.' }),
      field('From sequence', fromSeq),
      field('To sequence', toSeq),
    ),
    onConfirm: async () => {
      const params = new URLSearchParams();
      if (fromSeq.value) params.set('from_seq', fromSeq.value);
      if (toSeq.value) params.set('to_seq', toSeq.value);
      return get(`/api/audit/export${params.toString() ? `?${params.toString()}` : ''}`);
    },
  });

  if (!result) return;
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `ekorails-audit-export-${new Date().toISOString().slice(0, 10)}.json`);
  toast('ok', 'Export downloaded', `${result.events.length} events with a manifest.`);
}

// ---------------------------------------------------------------------------

export async function controlsView(ctx) {
  const [boundary, risks, stateMachine, environment] = await Promise.all([
    get('/api/system/regulatory-boundary'),
    get('/api/learning/risk-register').catch(() => []),
    get('/api/learning/state-machine').catch(() => null),
    get('/api/system/environment'),
  ]);

  const blocking = risks.filter((r) => r.blocks_pilot);
  const notImplemented = risks.filter((r) => r.control_status !== 'implemented');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Controls' }),
        h('p', { class: 'page-sub', text: 'What is in place, what is partial and what is not built' }),
      ),
    ),

    notice('info', 'Control status is reported honestly, including where it is inconvenient',
      h('p', {
        text:
          'A control marked "partial" or "not implemented" is genuinely so. Nothing here is upgraded ' +
          'because an interface for it exists.',
      }),
    ),

    h('div', { class: 'grid grid-4' },
      stat('Risks recorded', String(risks.length)),
      stat('Blocking a pilot', String(blocking.length),
        blocking.length > 0 ? 'These must be closed first' : 'Nothing blocking',
        blocking.length > 0 ? 'danger' : null),
      stat('Controls not fully implemented', String(notImplemented.length),
        'Partial, planned or absent', notImplemented.length > 0 ? 'warn' : null),
      stat('State transitions declared',
        stateMachine ? String(stateMachine.transition_count) : '—',
        'Every edge is declared; there is no set-state function'),
    ),

    stateMachine
      ? notice('warning', 'What "settled" means here', h('p', { text: stateMachine.note }))
      : null,

    card('Risk register', table([
      { key: 'risk_ref', label: 'Reference', className: 'mono' },
      { key: 'category', label: 'Category', render: (r) => titleCase(r.category) },
      { key: 'title', label: 'Risk' },
      { key: 'inherent_likelihood', label: 'Inherent',
        render: (r) => `${titleCase(r.inherent_likelihood)} / ${titleCase(r.inherent_impact)}` },
      { key: 'existing_controls', label: 'Controls' },
      { key: 'control_status', label: 'Status', render: (r) => stateChip(r.control_status) },
      { key: 'residual_likelihood', label: 'Residual',
        render: (r) => `${titleCase(r.residual_likelihood)} / ${titleCase(r.residual_impact)}` },
      { key: 'owner', label: 'Owner' },
      { key: 'blocks_pilot', label: 'Blocks pilot',
        render: (r) => (r.blocks_pilot
          ? h('span', { class: 'chip chip-danger' }, 'Yes')
          : h('span', { class: 'chip chip-neutral' }, 'No')) },
    ], risks, { empty: 'No risks recorded.' })),

    card('Environment and release gates', h('div', {},
      h('div', { class: 'card-body' }, keyValues([
        ['Mode', environment.mode ?? '—'],
        ['Banner', environment.banner ?? '—'],
        ['Live funds', environment.live_funds_enabled
          ? h('span', { class: 'chip chip-danger' }, 'Enabled')
          : h('span', { class: 'chip chip-ok' }, 'Disabled')],
      ])),
      table([
        { key: 'key', label: 'Gate', className: 'mono' },
        { key: 'description', label: 'Requirement' },
        { key: 'evidence_required', label: 'Evidence' },
        { key: 'met', label: 'Met',
          render: (g) => (g.met
            ? h('span', { class: 'chip chip-ok' }, 'Met')
            : h('span', { class: 'chip chip-warn' }, 'Not met')) },
      ], boundary.release_gates),
    )),

    card('Unresolved facts', h('div', { class: 'card-body' },
      h('p', { text: boundary.unresolved_facts.note }),
      h('p', { class: 'footnote', text: `See ${boundary.unresolved_facts.see}` }),
    ), null),
  );
}
