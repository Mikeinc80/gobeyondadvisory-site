/**
 * Compliance Console.
 *
 * The design principle here is that a compliance decision must be reconstructable years
 * later by somebody who was not in the room. So every screen shows not just the outcome
 * but the rule text that produced it, the parameter values in force at the time, and the
 * data the rule actually read — copied at the moment of evaluation, not read back from
 * today's configuration.
 *
 * Two things this console deliberately will not do:
 *
 *  - It will not let a decision be recorded without a written reason. The reason field has
 *    a minimum length enforced by the server, and the decision is permanent once written.
 *  - It will not present an automated screening result as a conclusion. Every match is a
 *    proposal for a person to dispose of.
 */

import {
  h, get, post, card, stat, table, notice, keyValues, stateChip, simulatedChip,
  money, dateTime, dateOnly, relativeTime, titleCase, toast, reportError, modal, field,
  input, textarea, select, valueOrPlaceholder, tabs,
} from './core.js';

// ---------------------------------------------------------------------------

export async function complianceDashboard(ctx) {
  const [cases, expiring, rules] = await Promise.all([
    get('/api/compliance/cases'),
    get('/api/compliance/expiring-documents?within_days=60').catch(() => []),
    get('/api/compliance/rules').catch(() => ({ rules: [] })),
  ]);

  const open = cases.filter((c) => !String(c.status).startsWith('closed'));
  const breached = open.filter((c) => c.breached_sla);
  const managerCases = open.filter((c) => c.requires_manager);
  const expired = expiring.filter((d) => d.already_expired);

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Compliance' }),
        h('p', { class: 'page-sub' },
          'Screening, review and decisions. ',
          simulatedChip('Screening provider is simulated'),
        ),
      ),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => ctx.navigate('/compliance/cases') }, 'Open the queue'),
        h('button', { class: 'btn', onclick: () => ctx.navigate('/compliance/rules') }, 'Rule library'),
      ),
    ),

    h('div', { class: 'grid grid-4' },
      stat('Open cases', String(open.length), `${cases.length} in total`),
      stat('Past service target', String(breached.length),
        breached.length > 0 ? 'These need an explanation, not a faster decision' : 'All within target',
        breached.length > 0 ? 'danger' : null),
      stat('Need a manager', String(managerCases.length),
        'An analyst cannot clear these', managerCases.length > 0 ? 'warn' : null),
      stat('Documents expired', String(expired.length),
        `${expiring.length} expiring within 60 days`, expired.length > 0 ? 'warn' : null),
    ),

    notice('warning', 'No transaction in this build can clear compliance automatically',
      h('p', {
        text:
          'The corridor is an unconfirmed placeholder, so a rule fires on every transaction that ' +
          'requires a person to look at it. That is intended behaviour for a build whose regulatory ' +
          'scope has not been confirmed, not a defect in the engine.',
      }),
      h('p', {
        class: 'footnote',
        text: 'Founder Learning Center → Decision log records why, and what would change it.',
      }),
    ),

    card('Oldest open cases', table([
      { key: 'reference', label: 'Reference', className: 'mono',
        render: (c) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/compliance/cases/${c.reference}`) }, c.reference) },
      { key: 'case_type', label: 'Type', render: (c) => titleCase(c.case_type) },
      { key: 'organization_name', label: 'Customer' },
      { key: 'priority', label: 'Priority', render: (c) => stateChip(c.priority) },
      { key: 'risk_outcome', label: 'Engine outcome', render: (c) => (c.risk_outcome ? stateChip(c.risk_outcome) : '—') },
      { key: 'sla_due_at', label: 'Target',
        render: (c) => (c.breached_sla
          ? h('span', { class: 'chip chip-danger' }, 'Breached')
          : (c.sla_due_at ? relativeTime(c.sla_due_at) : '—')) },
      { key: 'opened_at', label: 'Opened', render: (c) => dateTime(c.opened_at) },
    ], open.slice(0, 12), { empty: 'The queue is empty.' })),

    h('div', { class: 'grid grid-2' },
      card('Documents needing attention', table([
        { key: 'organization_code', label: 'Customer', className: 'mono' },
        { key: 'document_type', label: 'Document', render: (d) => titleCase(d.document_type) },
        { key: 'expires_on', label: 'Expires', render: (d) => dateOnly(d.expires_on) },
        { key: 'already_expired', label: 'Status',
          render: (d) => (d.already_expired
            ? h('span', { class: 'chip chip-danger' }, 'Expired')
            : h('span', { class: 'chip chip-warn' }, `${d.days_remaining} days`)) },
      ], expiring.slice(0, 10), { empty: 'No documents expiring in the next 60 days.' })),

      card('Rules in force', h('div', { class: 'card-body' },
        h('p', {
          text:
            `${(rules.rules ?? []).length} rules are active. Every one is evaluated against every ` +
            'subject it applies to, and rules that did not fire are recorded as evaluated rather ' +
            'than omitted — an absent rule and a rule that found nothing are different things.',
        }),
        h('p', {}, h('button', { class: 'btn', onclick: () => ctx.navigate('/compliance/rules') }, 'Read the library')),
      ), null),
    ),
  );
}

// ---------------------------------------------------------------------------

const CASE_STATUSES = [
  'open', 'in_review', 'awaiting_information', 'escalated',
  'closed_cleared', 'closed_rejected', 'closed_suspended',
];

export async function caseList(ctx) {
  const status = ctx.query.get('status') ?? '';
  const cases = await get(`/api/compliance/cases${status ? `?status=${encodeURIComponent(status)}` : ''}`);

  const filter = select(
    [{ value: '', label: 'Every status' },
      ...CASE_STATUSES.map((s) => ({ value: s, label: titleCase(s), selected: s === status })),
    ],
    {
      id: 'case-status-filter',
      onchange: (e) => ctx.navigate(`/compliance/cases${e.target.value ? `?status=${e.target.value}` : ''}`),
    },
  );

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Compliance queue' }),
        h('p', { class: 'page-sub', text: `${cases.length} cases, most urgent first` }),
      ),
      h('div', { class: 'filters' },
        h('label', { class: 'sr-only', for: 'case-status-filter' }, 'Status'), filter),
    ),

    card(null, table([
      { key: 'reference', label: 'Reference', className: 'mono',
        render: (c) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/compliance/cases/${c.reference}`) }, c.reference) },
      { key: 'case_type', label: 'Type', render: (c) => titleCase(c.case_type) },
      { key: 'organization_name', label: 'Customer' },
      { key: 'transaction_reference', label: 'Transaction', className: 'mono' },
      { key: 'priority', label: 'Priority', render: (c) => stateChip(c.priority) },
      { key: 'status', label: 'Status', render: (c) => stateChip(c.status) },
      { key: 'risk_outcome', label: 'Engine', render: (c) => (c.risk_outcome ? stateChip(c.risk_outcome) : '—') },
      { key: 'requires_manager', label: 'Authority',
        render: (c) => (c.requires_manager
          ? h('span', { class: 'chip chip-warn' }, 'Manager')
          : h('span', { class: 'chip chip-neutral' }, 'Analyst')) },
      { key: 'assigned_to_name', label: 'Assigned',
        render: (c) => c.assigned_to_name ?? h('span', { class: 'chip chip-neutral' }, 'Unassigned') },
      { key: 'sla_due_at', label: 'Target',
        render: (c) => (c.breached_sla
          ? h('span', { class: 'chip chip-danger' }, 'Breached')
          : (c.sla_due_at ? relativeTime(c.sla_due_at) : '—')) },
    ], cases, { empty: 'No cases match this filter.' })),
  );
}

// ---------------------------------------------------------------------------

export async function caseDetail(ctx) {
  const [data, me] = await Promise.all([
    get(`/api/compliance/cases/${encodeURIComponent(ctx.params.reference)}`),
    get('/api/me'),
  ]);

  const c = data.case;
  const isManager = me.permissions.includes('compliance.highrisk.approve');
  const canDecide = me.permissions.includes('compliance.alert.clear') || isManager;
  const canScreen = me.permissions.includes('compliance.screening.review');
  const closed = String(c.status).startsWith('closed');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: c.reference }),
        h('p', { class: 'page-sub' },
          titleCase(c.case_type), ' · ', c.organization_name, ' · ', stateChip(c.status),
          ' ', stateChip(c.priority),
        ),
      ),
      h('div', { class: 'page-actions' },
        canDecide && !closed
          ? h('button', { class: 'btn btn-primary', onclick: () => decisionDialog(ctx, c, isManager) }, 'Record a decision')
          : null,
        c.subject_type === 'transaction' && c.subject_id
          ? h('button', { class: 'btn', onclick: () => ctx.navigate(`/transactions/${c.subject_id}`) }, 'Open the transaction')
          : null,
      ),
    ),

    c.requires_manager && !isManager && !closed
      ? notice('warning', 'This case is reserved for a Compliance Manager',
          h('p', {
            text:
              'You can read everything and add to the record, but the server will refuse a clearance ' +
              'from an analyst on this case. That refusal is itself recorded.',
          }))
      : null,

    h('div', { class: 'grid grid-2' },
      card('Case', h('div', { class: 'card-body' }, keyValues([
        ['Reference', h('span', { class: 'mono-inline', text: c.reference })],
        ['Type', titleCase(c.case_type)],
        ['Subject', `${titleCase(c.subject_type)}`],
        ['Customer', `${c.organization_name} (${c.organization_code})`],
        ['Status', stateChip(c.status)],
        ['Priority', stateChip(c.priority)],
        ['Authority required', c.requires_manager ? 'Compliance Manager' : 'Compliance Analyst'],
        ['Opened', dateTime(c.opened_at)],
        ['First touched', c.first_touched_at ? dateTime(c.first_touched_at) : 'Not yet'],
        ['Service target', c.sla_due_at ? dateTime(c.sla_due_at) : '—'],
        ['Closed', c.closed_at ? dateTime(c.closed_at) : '—'],
      ])), null),

      card('Engine outcome',
        data.assessment
          ? h('div', { class: 'card-body' }, keyValues([
              ['Outcome', stateChip(data.assessment.assessment.outcome)],
              ['Recommended action', titleCase(data.assessment.assessment.recommended_action)],
              ['Score', String(data.assessment.assessment.score ?? '—')],
              ['Rules evaluated', String(data.assessment.rules_evaluated)],
              ['Rules triggered', String(data.assessment.rules_triggered)],
              ['Engine version', h('span', { class: 'mono-inline', text: data.assessment.assessment.engine_version })],
              ['Evaluated', dateTime(data.assessment.assessment.evaluated_at)],
            ]))
          : h('div', { class: 'empty', text: 'No automated assessment is attached to this case.' }),
        null),
    ),

    data.assessment ? assessmentCard(data.assessment) : null,
    screeningCard(ctx, data.screening, canScreen),

    h('div', { class: 'grid grid-2', style: 'margin-top:.85rem' },
      card('Decisions', table([
        { key: 'decided_at', label: 'When', render: (d) => dateTime(d.decided_at) },
        { key: 'decision', label: 'Decision', render: (d) => stateChip(d.decision) },
        { key: 'decided_by_name', label: 'By' },
        { key: 'decided_by_role', label: 'Role', render: (d) => titleCase(d.decided_by_role) },
        { key: 'reason', label: 'Reason' },
      ], data.decisions, { empty: 'No decision has been recorded yet.' })),

      card('Notes', table([
        { key: 'created_at', label: 'When', render: (n) => dateTime(n.created_at) },
        { key: 'author_name', label: 'Author' },
        { key: 'visibility', label: 'Visible to', render: (n) => titleCase(n.visibility) },
        { key: 'body', label: 'Note' },
      ], data.notes, { empty: 'No notes.' })),
    ),
  );
}

/**
 * The evaluation record. Rules that did not fire are shown alongside rules that did,
 * because "this rule was checked and found nothing" is evidence and "this rule was never
 * run" is a gap — and they look identical if only triggered rules are displayed.
 */
function assessmentCard(assessment) {
  const triggered = assessment.evaluations.filter((e) => e.triggered);
  const quiet = assessment.evaluations.filter((e) => !e.triggered);
  const hashesAgree = assessment.integrity.ruleset_hash === assessment.integrity.recomputed_ruleset_hash;

  return card('What the engine actually checked', h('div', {},
    h('p', { class: 'card-body ledger-explain', text: assessment.reproducibility_note }),

    h('div', { class: 'card-body' },
      hashesAgree
        ? h('p', {}, h('span', { class: 'chip chip-ok' }, 'Ruleset snapshot verified'), ' ',
            'The stored ruleset hash matches a hash recomputed from the snapshot on this page.')
        : h('p', {}, h('span', { class: 'chip chip-danger' }, 'Ruleset snapshot mismatch'), ' ',
            'The stored hash does not match the snapshot. Treat this record as unreliable and report it.'),
    ),

    h('h3', { class: 'card-body', text: `Triggered (${triggered.length})` }),
    table([
      { key: 'rule_key', label: 'Rule', className: 'mono' },
      { key: 'result_severity', label: 'Severity', render: (e) => stateChip(e.result_severity) },
      { key: 'message', label: 'What it found' },
      { key: 'evaluated_condition', label: 'Condition applied' },
      { key: 'parameters_used', label: 'Parameters',
        render: (e) => h('span', { class: 'mono-inline', text: JSON.stringify(e.parameters_used) }) },
      { key: 'result_action', label: 'Action', render: (e) => titleCase(e.result_action) },
    ], triggered, { empty: 'No rule triggered.' }),

    h('details', { class: 'disclose' },
      h('summary', {}, `Rules checked that did not trigger (${quiet.length})`),
      table([
        { key: 'rule_key', label: 'Rule', className: 'mono' },
        { key: 'evaluated_condition', label: 'Condition applied' },
        { key: 'message', label: 'Why it did not trigger' },
      ], quiet, { empty: 'None.' }),
    ),
  ));
}

function screeningCard(ctx, screening, canScreen) {
  if (!screening || screening.length === 0) {
    return card('Screening', h('div', { class: 'empty', text: 'No screening has been run against this subject.' }));
  }

  return card('Screening', h('div', {},
    h('p', { class: 'card-body ledger-explain',
      text:
        'A screening match is a proposal, not a conclusion. Names collide, and a person has to ' +
        'decide whether this is the same person. That decision is recorded with its reason.' }),

    ...screening.map((s) => h('div', { class: 'card-body' },
      h('h3', {},
        h('span', { class: 'mono-inline', text: s.reference }), ' ',
        stateChip(s.status), ' ',
        s.is_simulated ? simulatedChip(`Provider: ${s.provider}`) : null,
      ),
      h('p', { class: 'footnote' },
        'Requested ', dateTime(s.requested_at),
        s.disposition ? h('span', {}, ' · Disposed as ', stateChip(s.disposition)) : null,
      ),
      s.disposition_reason ? h('p', { class: 'ledger-explain', text: s.disposition_reason }) : null,

      table([
        { key: 'type', label: 'List type', render: (r) => titleCase(r.type) },
        { key: 'matched_name', label: 'Matched name' },
        { key: 'score', label: 'Score', align: 'right' },
        { key: 'list', label: 'List' },
        { key: 'entry', label: 'Entry', className: 'mono' },
      ], s.results ?? [], { empty: 'No matches returned.' }),

      canScreen && !s.disposition
        ? h('div', { style: 'margin-top:.5rem' },
            h('button', { class: 'btn btn-sm', onclick: () => disposeDialog(ctx, s) }, 'Dispose of this result'))
        : null,
    )),
  ));
}

async function disposeDialog(ctx, screening) {
  const disposition = select([
    { value: 'cleared', label: 'Cleared — not the same person or entity' },
    { value: 'escalated', label: 'Escalated — needs a manager' },
    { value: 'blocked', label: 'Blocked — treat as a true match' },
    { value: 'pending_review', label: 'Still under review' },
  ]);
  const reason = textarea({
    placeholder:
      'What distinguishes this person from the listed one, or what confirms they are the same. ' +
      'Date of birth, nationality, identifiers you compared.',
  });

  const result = await modal({
    title: `Dispose of ${screening.reference}`,
    confirmLabel: 'Record the disposition',
    body: h('div', {},
      h('p', {
        text:
          'This is permanent. It cannot be edited afterwards, and a later reviewer will read exactly ' +
          'what you write here.',
      }),
      field('Disposition', disposition),
      field('Reason', reason),
    ),
    onConfirm: async () => {
      await post(`/api/compliance/screening/${screening.id}/dispose`, {
        disposition: disposition.value,
        reason: reason.value.trim(),
      });
      return true;
    },
  });
  if (result) { toast('ok', 'Disposition recorded'); ctx.reload(); }
}

async function decisionDialog(ctx, c, isManager) {
  const options = [
    { value: 'cleared', label: 'Clear — no concern remains' },
    { value: 'cleared_false_positive', label: 'Clear as a false positive' },
    { value: 'information_requested', label: 'Request more information from the customer' },
    { value: 'escalated', label: 'Escalate to a manager' },
    { value: 'rejected', label: 'Reject' },
    { value: 'suspended', label: 'Suspend pending investigation' },
  ];
  if (isManager) options.splice(2, 0, { value: 'approved', label: 'Approve as a manager (high risk)' });

  const decision = select(options);
  const reason = textarea({
    placeholder:
      'Why this is the right decision, and what you relied on. At least 20 characters — a reviewer ' +
      'in a year should not have to ask you what you meant.',
  });

  const result = await modal({
    title: `Decision on ${c.reference}`,
    confirmLabel: 'Record the decision',
    body: h('div', {},
      h('p', {
        text:
          'A compliance decision is permanent. It cannot be edited or deleted, and a later decision ' +
          'adds to the record rather than replacing this one.',
      }),
      c.requires_manager && !isManager
        ? notice('warning', null,
            'This case requires a manager. A clearance from an analyst will be refused and the refusal recorded.')
        : null,
      field('Decision', decision),
      field('Written reason', reason),
    ),
    onConfirm: async () => post(`/api/compliance/cases/${encodeURIComponent(c.reference)}/decision`, {
      decision: decision.value,
      reason: reason.value.trim(),
    }),
  });

  if (result) {
    toast('ok', 'Decision recorded', `Case is now ${titleCase(result.case_status)}.`);
    ctx.reload();
  }
}

// ---------------------------------------------------------------------------

export async function kybQueue(ctx) {
  const overview = await get('/api/regulator/overview').catch(() => null);
  const participants = overview?.approved_participants ?? [];
  const cases = await get('/api/compliance/cases');
  const kybCases = cases.filter((c) => c.case_type === 'kyb' || c.subject_type === 'organization');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Customer onboarding' }),
        h('p', { class: 'page-sub', text: 'Know-your-business review and decisions' }),
      ),
    ),

    notice('info', 'A KYB approval is a decision about a business, not a formality',
      h('p', {
        text:
          'High-risk approvals require a Compliance Manager. The engine can recommend, but it does ' +
          'not approve: the recorded decision always carries a person and a written reason.',
      }),
    ),

    card('Open onboarding cases', table([
      { key: 'reference', label: 'Reference', className: 'mono',
        render: (c) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/compliance/cases/${c.reference}`) }, c.reference) },
      { key: 'organization_name', label: 'Business' },
      { key: 'status', label: 'Status', render: (c) => stateChip(c.status) },
      { key: 'risk_outcome', label: 'Engine outcome', render: (c) => (c.risk_outcome ? stateChip(c.risk_outcome) : '—') },
      { key: 'recommended_action', label: 'Recommended', render: (c) => (c.recommended_action ? titleCase(c.recommended_action) : '—') },
      { key: 'requires_manager', label: 'Authority',
        render: (c) => (c.requires_manager
          ? h('span', { class: 'chip chip-warn' }, 'Manager')
          : h('span', { class: 'chip chip-neutral' }, 'Analyst')) },
      { key: 'opened_at', label: 'Opened', render: (c) => dateTime(c.opened_at) },
    ], kybCases, { empty: 'No onboarding cases are open.' })),

    card('Every business on the platform', table([
      { key: 'display_code', label: 'Code', className: 'mono' },
      { key: 'onboarding_status', label: 'Status', render: (p) => stateChip(p.onboarding_status) },
      { key: 'risk_rating', label: 'Risk', render: (p) => stateChip(p.risk_rating) },
      { key: 'suspended', label: 'Suspended',
        render: (p) => (p.suspended ? h('span', { class: 'chip chip-danger' }, 'Suspended') : '—') },
      { key: 'created_at', label: 'Registered', render: (p) => dateOnly(p.created_at) },
    ], participants, { empty: 'No businesses are registered.' })),

    h('p', { class: 'footnote' },
      'This list shows organisation codes rather than names, which is the same masking the ',
      'supervisory view applies. Named detail is on each case.'),
  );
}

// ---------------------------------------------------------------------------

export async function expiringDocuments(ctx) {
  const withinDays = Number(ctx.query.get('within_days') ?? 30);
  const rows = await get(`/api/compliance/expiring-documents?within_days=${withinDays}`);

  const window = select(
    [30, 60, 90, 180].map((d) => ({ value: String(d), label: `Next ${d} days`, selected: d === withinDays })),
    {
      id: 'doc-window',
      onchange: (e) => ctx.navigate(`/compliance/documents?within_days=${e.target.value}`),
    },
  );

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Expiring documents' }),
        h('p', { class: 'page-sub', text: `${rows.length} documents` }),
      ),
      h('div', { class: 'filters' },
        h('label', { class: 'sr-only', for: 'doc-window' }, 'Window'), window),
    ),

    notice('info', 'An expired document does not stop the world by itself',
      h('p', {
        text:
          'It raises a rule against the next transaction that relies on it. That is deliberate: ' +
          'suspending a customer because a certificate lapsed on a Friday is rarely the right answer, ' +
          'but letting a payment proceed on stale evidence never is.',
      }),
    ),

    card(null, table([
      { key: 'organization_name', label: 'Business' },
      { key: 'organization_code', label: 'Code', className: 'mono' },
      { key: 'document_type', label: 'Document', render: (d) => titleCase(d.document_type) },
      { key: 'original_filename', label: 'File' },
      { key: 'expires_on', label: 'Expires', render: (d) => dateOnly(d.expires_on) },
      { key: 'days_remaining', label: 'Status',
        render: (d) => (d.already_expired
          ? h('span', { class: 'chip chip-danger' }, 'Expired')
          : h('span', { class: 'chip chip-warn' }, `${d.days_remaining} days`)) },
    ], rows, { empty: 'Nothing expires in this window.' })),
  );
}

// ---------------------------------------------------------------------------

export async function ruleLibrary(ctx) {
  const data = await get('/api/compliance/rules');
  const rules = data.rules ?? [];
  const categories = [...new Set(rules.map((r) => r.category))].sort();
  const active = ctx.query.get('category') ?? categories[0] ?? '';
  const shown = rules.filter((r) => r.category === active);

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Compliance rule library' }),
        h('p', { class: 'page-sub', text: `${rules.length} rules in force` }),
      ),
    ),

    notice('info', 'Rules are immutable once published', h('p', { text: data.note ?? '' })),

    tabs(
      categories.map((c) => ({ key: c, label: titleCase(c) })),
      active,
      (key) => ctx.navigate(`/compliance/rules?category=${encodeURIComponent(key)}`),
    ),

    ...shown.map((rule) => card(rule.name, h('div', { class: 'card-body' },
      h('p', { class: 'footnote' },
        h('span', { class: 'mono-inline', text: rule.rule_key }), ' v', String(rule.version), ' · ',
        stateChip(rule.severity), ' · ',
        `On trigger: ${titleCase(rule.on_trigger_action)}`, ' · ',
        rule.times_triggered > 0
          ? `Triggered ${rule.times_triggered} times in this environment`
          : 'Has not triggered in this environment',
      ),
      keyValues([
        ['Risk it addresses', rule.risk_addressed],
        ['When it fires', rule.trigger_condition],
        ['Evidence required', rule.required_evidence],
        ['What the system does', rule.automated_action],
        ['What a person decides', rule.human_decision],
        ['How it gets it wrong', rule.false_positive_risk],
        ['Policy basis', rule.policy_basis],
        ['Parameters', h('span', { class: 'mono-inline', text: JSON.stringify(rule.parameters) })],
        ['In force since', dateOnly(rule.effective_from)],
      ]),
    ), null)),

    shown.length === 0 ? card(null, h('div', { class: 'empty', text: 'No rules in this category.' })) : null,
  );
}
