/**
 * System Administration console.
 *
 * The uncomfortable question about an administration console is what stops the
 * administrator. Three answers, all visible on these screens:
 *
 *  - A System Administrator holds no permission to move money, clear a compliance alert
 *    or post to the ledger. Those are not hidden from this console; they were never
 *    granted to the role.
 *  - Configuration is immutable. A change is a new version under maker-checker, and it
 *    never rewrites a historical result — every engine copies the values it used into its
 *    own output record.
 *  - Nothing on this console can enable live funds. The release gates are process-level
 *    environment configuration, and the code refuses to read them from anywhere else.
 */

import {
  h, get, post, card, stat, table, notice, keyValues, stateChip, simulatedChip,
  money, dateTime, dateOnly, titleCase, valueOrPlaceholder, placeholderChip,
  toast, reportError, modal, field, input, textarea, select, tabs,
} from './core.js';

// ---------------------------------------------------------------------------

export async function adminDashboard(ctx) {
  const [config, partners, boundary, roles] = await Promise.all([
    get('/api/admin/configuration').catch(() => null),
    get('/api/admin/partners').catch(() => []),
    get('/api/system/regulatory-boundary'),
    get('/api/admin/roles').catch(() => null),
  ]);

  const gatesMet = boundary.release_gates.filter((g) => g.met).length;

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Administration' }),
        h('p', { class: 'page-sub', text: 'Configuration, roles, partners and the simulators' }),
      ),
    ),

    notice('warning', 'Live funds cannot be enabled from this console, or any other',
      h('p', {
        text:
          `${gatesMet} of ${boundary.release_gates.length} release gates are met. Each one is ` +
          'process configuration read from the environment at start-up, and each requires named ' +
          'evidence. There is no screen, feature flag or database row that turns settlement live.',
      }),
      h('p', {}, h('button', { class: 'btn btn-sm', onclick: () => ctx.navigate('/regulator/controls') }, 'See the gates')),
    ),

    h('div', { class: 'grid grid-4' },
      stat('Configuration keys', config ? String(config.configuration.length) : '—',
        config ? `${config.unresolved_placeholders} are unresolved placeholders` : 'Not readable with your role',
        config && config.unresolved_placeholders > 0 ? 'warn' : null),
      stat('Feature flags', config ? String(config.feature_flags.length) : '—',
        config ? `${config.feature_flags.filter((f) => f.is_release_gate).length} are release gates` : ''),
      stat('Partners registered', String(partners.length),
        'Every one is a simulator in this build'),
      stat('Roles', roles ? String(roles.roles.length) : '—',
        roles ? `${roles.separation_of_duties.length} separation-of-duties rules` : ''),
    ),

    config && config.unresolved_placeholders > 0
      ? notice('info', 'Unresolved placeholders are not defects',
          h('p', {
            text:
              'The CBN Regulatory Sandbox application was not available to this build, so no ' +
              'regulatory or commercial fact has been invented in its place. Each placeholder names ' +
              'the founder decision that would resolve it.',
          }),
          h('p', {}, h('button', { class: 'btn btn-sm', onclick: () => ctx.navigate('/admin/configuration') }, 'Review them')))
      : null,

    h('div', { class: 'grid grid-2' },
      card('Where to go', h('div', { class: 'card-body' },
        h('ul', {},
          h('li', {}, h('button', { class: 'row-link', onclick: () => ctx.navigate('/admin/roles') }, 'Roles and permissions'),
            ' — the effective matrix, including what each role explicitly cannot do.'),
          h('li', {}, h('button', { class: 'row-link', onclick: () => ctx.navigate('/admin/configuration') }, 'Configuration'),
            ' — every key, its version and whether it is a placeholder.'),
          h('li', {}, h('button', { class: 'row-link', onclick: () => ctx.navigate('/admin/partners') }, 'Partner registry'),
            ' — who would do what if a partner were connected.'),
          h('li', {}, h('button', { class: 'row-link', onclick: () => ctx.navigate('/admin/simulation') }, 'Simulation control'),
            ' — make a partner fail on purpose, to see what the system does about it.'),
        ),
      ), null),

      card('What an administrator cannot do', h('div', { class: 'card-body' },
        roles
          ? h('ul', {}, (roles.roles.find((r) => r.code === 'system_administrator')?.cannot ?? [])
              .map((line) => h('li', { text: line })))
          : h('p', { text: 'The role matrix is not readable with your permissions.' }),
      ), null),
    ),
  );
}

// ---------------------------------------------------------------------------

export async function roleMatrix(ctx) {
  const data = await get('/api/admin/roles');
  const active = ctx.query.get('view') ?? 'roles';

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Roles and permissions' }),
        h('p', { class: 'page-sub',
          text: `${data.roles.length} roles, ${data.permissions.length} permissions, ${data.separation_of_duties.length} separation rules` }),
      ),
    ),

    notice('info', 'A "cannot" is a control; an absent permission is an oversight waiting to happen',
      h('p', {
        text:
          'Each role below carries explicit denials as well as grants. The denials are enforced ' +
          'against the context of the action, so holding two roles at once does not add up to a ' +
          'permission neither role has on its own.',
      }),
    ),

    tabs([
      { key: 'roles', label: 'Roles' },
      { key: 'permissions', label: 'Permissions' },
      { key: 'separation', label: 'Separation of duties' },
    ], active, (key) => ctx.navigate(`/admin/roles?view=${key}`)),

    active === 'roles'
      ? h('div', {}, data.roles.map((role) => card(role.name, h('div', { class: 'card-body' },
          h('p', { class: 'footnote' },
            h('span', { class: 'mono-inline', text: role.code }), ' · ',
            `Realm: ${titleCase(role.realm)}`, ' · ',
            role.requires_step_up
              ? h('span', { class: 'chip chip-info' }, 'Re-authentication required for sensitive actions')
              : h('span', { class: 'chip chip-neutral' }, 'No step-up required'),
            role.is_break_glass ? h('span', { class: 'chip chip-danger' }, 'Break glass') : null,
          ),
          h('p', { text: role.description }),
          h('h3', { text: 'Cannot' }),
          h('ul', {}, role.cannot.map((line) => h('li', { text: line }))),
          h('details', { class: 'disclose' },
            h('summary', {}, `Can (${role.permissions.length} permissions)`),
            h('div', {}, h('p', { class: 'mono-inline', text: role.permissions.join('  ') })),
          ),
        ), null)))
      : null,

    active === 'permissions'
      ? card(null, table([
          { key: 'code', label: 'Permission', className: 'mono' },
          { key: 'domain', label: 'Domain', render: (p) => titleCase(p.domain) },
          { key: 'description', label: 'What it allows' },
          { key: 'sensitive', label: 'Sensitive',
            render: (p) => (p.sensitive
              ? h('span', { class: 'chip chip-warn' }, 'Sensitive')
              : h('span', { class: 'chip chip-neutral' }, 'Ordinary')) },
          { key: 'roles', label: 'Held by',
            render: (p) => data.roles.filter((r) => r.permissions.includes(p.code)).length + ' roles' },
        ], data.permissions))
      : null,

    active === 'separation'
      ? card(null, h('div', {},
          h('p', { class: 'card-body ledger-explain',
            text:
              'These rules are evaluated against the context of the action, not against the ' +
              'permission set. Holding both roles does not defeat them.' }),
          table([
            { key: 'code', label: 'Rule', className: 'mono' },
            { key: 'action', label: 'Action' },
            { key: 'description', label: 'What is refused' },
          ], data.separation_of_duties),
        ))
      : null,
  );
}

// ---------------------------------------------------------------------------

export async function configurationView(ctx) {
  const data = await get('/api/admin/configuration');
  const placeholders = data.configuration.filter((c) => c.is_placeholder);
  const settled = data.configuration.filter((c) => !c.is_placeholder);

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Configuration' }),
        h('p', { class: 'page-sub',
          text: `${data.configuration.length} keys, ${data.unresolved_placeholders} unresolved` }),
      ),
    ),

    notice('info', 'Configuration is immutable', h('p', { text: data.note })),

    placeholders.length > 0
      ? card(`Unresolved placeholders (${placeholders.length})`, h('div', {},
          h('p', { class: 'card-body ledger-explain',
            text:
              'Each of these is a fact the software needs and does not have. Nothing has been ' +
              'invented to fill the gap: the placeholder is carried through to every screen that ' +
              'would otherwise present it as a value.' }),
          table([
            { key: 'config_key', label: 'Key', className: 'mono' },
            { key: 'value', label: 'Placeholder',
              render: (c) => placeholderChip(typeof c.value === 'string' ? c.value : JSON.stringify(c.value)) },
            { key: 'description', label: 'What it governs' },
            { key: 'founder_decision_ref', label: 'Decision',
              render: (c) => (c.founder_decision_ref
                ? h('button', { class: 'row-link', onclick: () => ctx.navigate('/learning/decisions') }, c.founder_decision_ref)
                : '—') },
          ], placeholders),
        ))
      : null,

    card('Confirmed configuration', table([
      { key: 'config_key', label: 'Key', className: 'mono' },
      { key: 'version', label: 'Version', align: 'right' },
      { key: 'value', label: 'Value',
        render: (c) => h('span', { class: 'mono-inline', text: typeof c.value === 'string' ? c.value : JSON.stringify(c.value) }) },
      { key: 'value_type', label: 'Type', render: (c) => titleCase(c.value_type) },
      { key: 'description', label: 'What it governs' },
      { key: 'status', label: 'Status', render: (c) => stateChip(c.status) },
      { key: 'effective_from', label: 'In force since', render: (c) => dateOnly(c.effective_from) },
    ], settled, { empty: 'No confirmed configuration.' })),

    card('Feature flags', h('div', {},
      h('p', { class: 'card-body ledger-explain',
        text:
          'A flag marked as a release gate cannot be turned on from the application. It reflects ' +
          'process-level environment configuration and named evidence, and the code refuses to read ' +
          'it from anywhere else.' }),
      table([
        { key: 'key', label: 'Flag', className: 'mono' },
        { key: 'description', label: 'What it controls' },
        { key: 'enabled', label: 'Enabled',
          render: (f) => (f.enabled
            ? h('span', { class: 'chip chip-ok' }, 'On')
            : h('span', { class: 'chip chip-neutral' }, 'Off')) },
        { key: 'is_release_gate', label: 'Release gate',
          render: (f) => (f.is_release_gate ? h('span', { class: 'chip chip-warn' }, 'Gate') : '—') },
        { key: 'is_immutable', label: 'Changeable at runtime',
          render: (f) => (f.is_immutable
            ? h('span', { class: 'chip chip-danger' }, 'No')
            : h('span', { class: 'chip chip-neutral' }, 'Yes, under maker-checker')) },
      ], data.feature_flags),
    )),

    card('Corridors', table([
      { key: 'code', label: 'Corridor', className: 'mono' },
      { key: 'origin_country', label: 'From', render: (c) => valueOrPlaceholder(c.origin_country) },
      { key: 'destination_country', label: 'To', render: (c) => valueOrPlaceholder(c.destination_country) },
      { key: 'origin_currency', label: 'Send', render: (c) => valueOrPlaceholder(c.origin_currency) },
      { key: 'destination_currency', label: 'Receive', render: (c) => valueOrPlaceholder(c.destination_currency) },
      { key: 'per_transaction_limit', label: 'Per transaction', align: 'right',
        render: (c) => (c.per_transaction_limit ? money(c.per_transaction_limit, null) : '—') },
      { key: 'status', label: 'Status', render: (c) => stateChip(c.status) },
      { key: 'is_placeholder', label: 'Confirmed',
        render: (c) => (c.is_placeholder
          ? h('span', { class: 'chip chip-placeholder' }, 'Unconfirmed')
          : h('span', { class: 'chip chip-ok' }, 'Confirmed')) },
      { key: 'notes', label: 'Notes' },
    ], data.corridors)),

    card('Registered adapters', table([
      { key: 'key', label: 'Adapter', className: 'mono',
        render: (a) => (typeof a === 'string' ? a : a.key ?? JSON.stringify(a)) },
      { key: 'version', label: 'Version', render: (a) => (typeof a === 'string' ? '—' : a.version ?? '—') },
      { key: 'simulated', label: 'Simulated', render: () => simulatedChip() },
    ], Array.isArray(data.adapters) ? data.adapters : [], { empty: 'No adapters registered.' })),
  );
}

// ---------------------------------------------------------------------------

export async function partnerRegistry(ctx) {
  const partners = await get('/api/admin/partners');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Partner registry' }),
        h('p', { class: 'page-sub', text: `${partners.length} partners, all simulated` }),
      ),
    ),

    notice('warning', 'No partner agreement has been confirmed to this build',
      h('p', {
        text:
          'Each entry records the role a licensed institution would perform and the adapter that ' +
          'stands in for it. A name in this table is not a claim that the institution has agreed to ' +
          'anything.',
      }),
    ),

    card(null, table([
      { key: 'code', label: 'Code', className: 'mono' },
      { key: 'display_name', label: 'Partner', render: (p) => valueOrPlaceholder(p.display_name) },
      { key: 'partner_role', label: 'Role', render: (p) => titleCase(p.partner_role) },
      { key: 'live_responsibility', label: 'What they would do live' },
      { key: 'licensed_activity', label: 'Licensed activity',
        render: (p) => (p.licensed_activity ? 'Yes' : 'No') },
      { key: 'jurisdiction', label: 'Jurisdiction', render: (p) => valueOrPlaceholder(p.jurisdiction) },
      { key: 'adapter_key', label: 'Adapter', className: 'mono' },
      { key: 'adapter_version', label: 'Version' },
      { key: 'contract_reference', label: 'Contract',
        render: (p) => (p.contract_reference
          ? valueOrPlaceholder(p.contract_reference)
          : h('span', { class: 'chip chip-placeholder' }, 'None confirmed')) },
      { key: 'status', label: 'Status', render: (p) => stateChip(p.status) },
      { key: 'is_simulated', label: '', render: (p) => (p.is_simulated ? simulatedChip() : null) },
    ], partners)),

    card('Traffic', table([
      { key: 'code', label: 'Partner', className: 'mono' },
      { key: 'event_count', label: 'Calls', align: 'right' },
      { key: 'failure_count', label: 'Failures', align: 'right' },
      { key: 'avg_latency_ms', label: 'Average latency', align: 'right',
        render: (p) => (p.avg_latency_ms ? `${p.avg_latency_ms} ms` : '—') },
      { key: 'last_health_check_at', label: 'Last health check',
        render: (p) => (p.last_health_check_at ? dateTime(p.last_health_check_at) : 'Never') },
    ], partners)),
  );
}

// ---------------------------------------------------------------------------

/**
 * The failure scenarios the partner simulators can be told to produce. Each one exists
 * because it is a thing that genuinely happens to payments, and because a system that has
 * only ever been tested on the happy path is a system nobody has tested.
 */
const SCENARIOS = [
  { value: 'success', label: 'Success', why: 'The ordinary path. Worth running as a control, so you know the other results mean something.' },
  { value: 'delayed_funding', label: 'Delayed funding', why: 'The customer\'s funds take longer to reach the partner than expected. Nothing settles while the transaction waits, and the wait is visible rather than silent.' },
  { value: 'compliance_failure', label: 'Partner-side compliance refusal', why: 'The partner runs its own screening and declines. Our compliance approval does not override theirs, and the transaction does not proceed.' },
  { value: 'insufficient_liquidity', label: 'Insufficient liquidity', why: 'The partner cannot fund the payout. The instruction fails rather than partially executing.' },
  { value: 'invalid_beneficiary', label: 'Invalid beneficiary', why: 'The destination account details are refused by the receiving bank. The failure names the field, so the customer can correct it.' },
  { value: 'partner_timeout', label: 'Timeout — no response at all', why: 'The most dangerous case. The transaction goes to "outcome unknown" and automatic retry is switched off, because retrying blindly here is how a payment gets made twice.' },
  { value: 'duplicate_response', label: 'Duplicate instruction', why: 'The same instruction is submitted twice. The idempotency key should mean the second submission changes nothing and instructs no second payment.' },
  { value: 'failed_settlement', label: 'Settlement failed', why: 'The partner accepted the instruction and then failed to settle. The obligation stands and the funding is still with the partner.' },
  { value: 'partial_settlement', label: 'Partial settlement', why: 'Less is settled than instructed. The shortfall goes to settlement suspense with an owner — it is never quietly written off.' },
  { value: 'returned_payment', label: 'Return after settlement', why: 'The destination bank sends the money back. The original settlement is NOT reversed: a return is a new event, and erasing the first one would hide what happened.' },
  { value: 'reconciliation_mismatch', label: 'Partner statement disagrees', why: 'The partner reports a different figure from our ledger. Reconciliation should open a break rather than adopt their number.' },
];


export async function simulationControl(ctx) {
  const [partners, transactions] = await Promise.all([
    get('/api/admin/partners'),
    get('/api/transactions?limit=100').catch(() => []),
  ]);

  const scenario = select(SCENARIOS.map((s) => ({ value: s.value, label: s.label })), { id: 'sim-scenario' });
  const partner = select(
    [{ value: '', label: 'Any partner' },
      ...partners.map((p) => ({ value: p.id ?? p.code, label: `${p.display_name} (${titleCase(p.partner_role)})` })),
    ],
    { id: 'sim-partner' },
  );
  const transaction = select(
    [{ value: '', label: 'The next transaction that reaches this partner' },
      ...transactions.map((t) => ({ value: t.id, label: `${t.reference} — ${titleCase(t.state)}` })),
    ],
    { id: 'sim-transaction' },
  );
  const operation = input({ placeholder: 'Optional: restrict to one operation, e.g. submit_settlement', id: 'sim-operation' });
  const uses = input({ type: 'number', min: '1', value: '1', id: 'sim-uses' });

  const explanation = h('p', { class: 'ledger-explain', text: SCENARIOS[0].why });
  scenario.addEventListener('change', () => {
    explanation.textContent = SCENARIOS.find((s) => s.value === scenario.value)?.why ?? '';
  });

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      try {
        const result = await post('/api/admin/simulation', {
          scenario: scenario.value,
          partner_id: partner.value || null,
          transaction_id: transaction.value || null,
          operation: operation.value.trim() || null,
          remaining_uses: Number(uses.value) || 1,
        });
        toast('ok', `Simulator directed to produce "${result.scenario}"`,
          'It applies to the next matching partner call.');
      } catch (error) {
        reportError(error);
      }
    },
  },
    field('Scenario', scenario),
    explanation,
    field('Partner', partner, 'Leave as "any" to affect whichever partner is called next.'),
    field('Transaction', transaction, 'Restrict the directive to one transaction.'),
    field('Operation', operation),
    field('How many times it applies', uses),
    h('div', { style: 'margin-top:.8rem' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Direct the simulator')),
  );

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Simulation control' }),
        h('p', { class: 'page-sub' },
          'Make a partner fail on purpose. ', simulatedChip('These are simulators, not institutions'),
        ),
      ),
    ),

    notice('info', 'This is how failure gets tested rather than hoped about',
      h('p', {
        text:
          'A directive tells a partner simulator to produce a specific outcome on its next call. ' +
          'Nothing about the transaction is faked: the system genuinely receives that outcome and ' +
          'genuinely has to deal with it, which is the only way to find out whether it does.',
      }),
      h('p', {
        class: 'footnote',
        text: 'Creating a directive is an audited configuration change.',
      }),
    ),

    h('div', { class: 'grid grid-2' },
      card('Direct a simulator', h('div', { class: 'card-body' }, form), null),

      card('What each scenario is for', h('div', { class: 'card-body' },
        h('dl', { class: 'kv' }, SCENARIOS.flatMap((s) => [
          h('dt', { text: s.label }),
          h('dd', { text: s.why }),
        ])),
      ), null),
    ),
  );
}
