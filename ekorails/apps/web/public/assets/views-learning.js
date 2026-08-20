/**
 * Founder Learning Center.
 *
 * This is the part of the system that exists to teach rather than to operate. Its
 * governing rule is that it must never flatter the build. A module that is half finished
 * says so; a decision that is still open says so; a control that is planned rather than
 * implemented says so. A learning centre that reports everything as done teaches the one
 * thing a founder must not learn.
 *
 * Ten components, matching the specification:
 *   1. Product map            6. Decision log
 *   2. Transaction walkthrough 7. Build journal
 *   3. Ledger explorer         8. Glossary
 *   4. Compliance rule library 9. Guided demonstration
 *   5. Architecture explorer  10. Assessments
 *
 * The rule library lives in the Compliance Console and is linked from here rather than
 * duplicated, so there is one description of a rule rather than two that can disagree.
 */

import {
  h, get, post, card, stat, table, notice, keyValues, stateChip, simulatedChip,
  money, dateTime, dateOnly, titleCase, valueOrPlaceholder, placeholderChip,
  toast, reportError, modal, field, input, textarea, select, tabs, spinner, can,
} from './core.js';

// ---------------------------------------------------------------------------
// 0. Home
// ---------------------------------------------------------------------------

const COMPONENTS = [
  { path: '/learning/product-map', title: 'Product map',
    blurb: 'Every module in plain English, with the build stage it has genuinely reached.' },
  { path: '/learning/walkthrough', title: 'Transaction walkthrough',
    blurb: 'One payment, step by step: who is responsible, what could go wrong, what evidence is kept.' },
  { path: '/learning/ledger', title: 'Ledger explorer',
    blurb: 'What a debit and a credit actually mean here, account by account.' },
  { path: '/compliance/rules', title: 'Compliance rule library',
    blurb: 'Every rule, the risk it addresses, and how it gets things wrong.' },
  { path: '/learning/architecture', title: 'Architecture explorer',
    blurb: 'What each component does, what it talks to, and what protects it.' },
  { path: '/learning/state-machine', title: 'Transaction states',
    blurb: 'Every state a payment can be in and every route between them.' },
  { path: '/learning/decisions', title: 'Decision log',
    blurb: 'Every founder decision, including the ones still open and what they block.' },
  { path: '/learning/journal', title: 'Build journal',
    blurb: 'What was built, what is simulated, and what is not finished.' },
  { path: '/learning/risks', title: 'Risk register',
    blurb: 'What could go wrong, what is in place, and what is not.' },
  { path: '/learning/glossary', title: 'Glossary',
    blurb: 'Settlement and compliance terms, explained without jargon.' },
  { path: '/learning/demo', title: 'Guided demonstration',
    blurb: 'A scripted path through the system for showing it to someone else.' },
];

export async function learningHome(ctx) {
  const [map, decisions] = await Promise.all([
    get('/api/learning/product-map'),
    get('/api/learning/decisions'),
  ]);

  const modules = map.modules;
  const pilotReady = modules.filter((m) => m.completion_stage === 'pilot_ready').length;
  const accepted = modules.filter((m) => m.completion_stage === 'founder_accepted').length;

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Founder Learning Center' }),
        h('p', { class: 'page-sub', text: 'How this system works, and where it is honestly incomplete' }),
      ),
    ),

    notice('info', 'This section is written to be uncomfortable where the truth is uncomfortable',
      h('p', { text: map.honesty_note }),
    ),

    h('div', { class: 'grid grid-4' },
      stat('Modules', String(modules.length), 'Sixteen were specified'),
      stat('Pilot ready', String(pilotReady),
        'Every stage complete and regulatory dependencies cleared',
        pilotReady === 0 ? 'warn' : null),
      stat('Founder accepted', String(accepted), 'You have used it and confirmed it does what you need'),
      stat('Decisions still open', String(decisions.open_count),
        decisions.open_count > 0 ? 'Some of these block a pilot' : 'None outstanding',
        decisions.open_count > 0 ? 'warn' : null),
    ),

    decisions.open_count > 0
      ? notice('warning', `${decisions.open_count} decisions are waiting on you`,
          h('ul', {}, decisions.blocking_pilot.map((d) =>
            h('li', {}, h('span', { class: 'mono-inline', text: d.ref }), ' ', d.title,
              d.blocks ? h('span', { class: 'footnote', text: ` — blocks: ${d.blocks}` }) : null))),
          h('p', {}, h('button', { class: 'btn btn-sm', onclick: () => ctx.navigate('/learning/decisions') }, 'Open the decision log')))
      : null,

    card('The ten components', h('div', { class: 'card-body' },
      h('div', { class: 'grid grid-3' }, COMPONENTS.map((component) =>
        h('button', {
          class: 'nav-item',
          style: 'flex-direction:column; align-items:flex-start; text-align:left; height:100%',
          onclick: () => ctx.navigate(component.path),
        },
          h('strong', { text: component.title }),
          h('span', { class: 'footnote', text: component.blurb }),
        ))),
    ), null),
  );
}

// ---------------------------------------------------------------------------
// 1. Product map
// ---------------------------------------------------------------------------

export async function productMap(ctx) {
  const data = await get('/api/learning/product-map');

  const stageOrder = data.completion_definitions.map((d) => d.stage);
  const byStage = new Map(stageOrder.map((s) => [s, []]));
  for (const module of data.modules) {
    const stage = module.completion_stage ?? 'designed';
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(module);
  }

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Product map' }),
        h('p', { class: 'page-sub', text: `${data.modules.length} modules` }),
      ),
    ),

    notice('warning', 'A feature is never reported complete because its interface exists',
      h('p', { text: data.honesty_note }),
    ),

    card('What each stage means', h('div', { class: 'card-body' },
      h('dl', { class: 'kv' }, data.completion_definitions.flatMap((d) => [
        h('dt', { text: titleCase(d.stage) }),
        h('dd', { text: d.means }),
      ])),
    ), null),

    ...data.modules.map((module) => card(`${module.ordinal}. ${module.title}`,
      h('div', { class: 'card-body' },
        h('p', { class: 'footnote' },
          h('span', { class: 'mono-inline', text: module.key }), ' ',
          stateChip(module.completion_stage),
        ),
        keyValues([
          ['What it does', module.what_it_does],
          ['Why it exists', module.why_it_exists],
          ['Who uses it', module.who_uses_it],
          ['Regulatory significance', module.regulatory_significance],
          ['Main operational risk', module.main_operational_risk],
          ['What happens if it fails', module.what_if_it_fails],
          ['What is simulated', h('span', {}, simulatedChip(), ' ', module.simulated_parts)],
          ['Known limitations',
            h('span', { style: 'color:var(--warn)', text: module.known_limitations })],
        ]),
      ), null)),

    card('By stage', h('div', { class: 'card-body' },
      h('dl', { class: 'kv' }, [...byStage.entries()].flatMap(([stage, modules]) => [
        h('dt', {}, stateChip(stage)),
        h('dd', { text: modules.length > 0 ? modules.map((m) => m.title).join(', ') : 'None' }),
      ])),
    ), null),
  );
}

// ---------------------------------------------------------------------------
// 2. Transaction walkthrough
// ---------------------------------------------------------------------------

export async function walkthroughPicker(ctx) {
  // Reading transactions is a permission in its own right, and the administrative roles
  // do not hold it — deliberately, since an administrator has no business reading
  // customer payments. They reach the Learning Center all the same, so ask only if the
  // permission is held rather than firing a request that will be refused.
  if (!can('txn.read', 'txn.read.any')) {
    return h('div', {},
      h('div', { class: 'page-head' },
        h('div', {},
          h('h1', { class: 'page-title', text: 'Transaction walkthrough' }),
          h('p', { class: 'page-sub', text: 'Not available to your roles' }),
        ),
      ),
      notice('info', 'Your roles cannot read transactions',
        h('p', {
          text:
            'Walking through a payment means reading one, and neither of the administrative roles ' +
            'holds that permission. That separation is intentional: administering the platform and ' +
            'seeing customer payments are different jobs.',
        }),
        h('p', {}, h('button', { class: 'btn', onclick: () => ctx.navigate('/learning/state-machine') },
          'Read the state machine instead')),
      ),
    );
  }

  const transactions = await get('/api/transactions?limit=100');
  const completed = transactions.filter((t) => t.state === 'completed');
  const interesting = transactions.filter((t) =>
    ['failed', 'returned', 'rejected', 'partially_settled', 'outcome_unknown'].includes(t.state));

  const listing = (rows, empty) => table([
    { key: 'reference', label: 'Reference', className: 'mono',
      render: (t) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/learning/walkthrough/${t.id}`) }, t.reference) },
    { key: 'state', label: 'State', render: (t) => stateChip(t.state) },
    { key: 'organization_name', label: 'Customer' },
    { key: 'send_amount', label: 'Send', align: 'right', render: (t) => money(t.send_amount, t.send_currency) },
    { key: 'created_at', label: 'Created', render: (t) => dateTime(t.created_at) },
  ], rows, { empty });

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Transaction walkthrough' }),
        h('p', { class: 'page-sub', text: 'Pick a payment and follow it from end to end' }),
      ),
    ),

    notice('info', 'Start with one that went wrong',
      h('p', {
        text:
          'A successful payment teaches you the happy path, which is the part you already imagine ' +
          'correctly. A returned or partially settled one teaches you what the system is actually for.',
      }),
    ),

    card('Payments that did not go to plan', listing(interesting, 'None in this environment.')),
    card('Completed payments', listing(completed, 'None completed yet.')),
  );
}

export async function walkthrough(ctx) {
  const data = await get(`/api/learning/walkthrough/${ctx.params.transactionId}`);
  const txn = data.transaction;

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: `Walkthrough: ${txn.reference}` }),
        h('p', { class: 'page-sub' },
          txn.organization_name, ' → ', txn.beneficiary_name, ' · ', stateChip(txn.state),
        ),
      ),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn', onclick: () => ctx.navigate(`/transactions/${txn.id}`) }, 'Open the transaction'),
      ),
    ),

    notice('info', 'Five questions at every step',
      h('p', {
        text:
          'Who is responsible; what is happening; why it matters; what could go wrong; and what ' +
          'evidence is kept. If any step cannot answer all five, that is a gap in the design, not in ' +
          'the explanation.',
      }),
    ),

    card('Step by step', h('div', { class: 'card-body' },
      h('div', { class: 'timeline' }, data.steps.map((step, index) => h('div', { class: 'tl-step' },
        h('div', { class: 'tl-dot', text: '' }),
        h('div', {},
          h('div', { class: 'tl-title', text: `${index + 1}. ${titleCase(step.from)} → ${titleCase(step.to)}` }),
          h('div', { class: 'tl-meta' },
            step.who_is_responsible, ' · ', step.actor_name, ' · ', dateTime(step.occurred_at)),
          h('dl', { class: 'kv' },
            h('dt', { text: 'What is happening' }), h('dd', { text: step.what_is_happening }),
            h('dt', { text: 'Why it matters' }), h('dd', { text: step.why_it_matters }),
            h('dt', { text: 'What could go wrong' }), h('dd', { text: step.what_could_go_wrong }),
            h('dt', { text: 'Reason recorded' }), h('dd', { text: step.reason_given ?? '—' }),
            h('dt', { text: 'Accounting consequence' }), h('dd', { text: titleCase(step.accounting_consequence) }),
            h('dt', { text: 'Evidence retained' }),
            h('dd', {}, h('ul', {}, step.what_evidence_is_retained.map((e) => h('li', { text: e })))),
          ),
          step.journal_explanation
            ? h('div', { class: 'tl-explain' },
                h('dl', {},
                  h('dt', { text: `Ledger journal ${step.journal_reference}` }),
                  h('dd', { text: step.journal_explanation }),
                ))
            : null,
        ),
      ))),
    ), null),

    card('What the ledger recorded', h('div', { class: 'card-body' },
      data.ledger_explanation.length === 0
        ? h('div', { class: 'empty', text: 'No ledger entries. Nothing is owed until a quote is accepted.' })
        : h('div', {}, data.ledger_explanation.map((journal) => h('div', { style: 'margin-bottom:1.1rem' },
            h('h3', {},
              h('span', { class: 'mono-inline', text: journal.reference }), ' ',
              titleCase(journal.type), ' ',
              journal.posting_status === 'reversed' ? stateChip('reversed', 'Reversed') : null,
            ),
            h('p', { class: 'ledger-explain', text: journal.plain_english }),
            h('div', {}, journal.entries.map((entry) => h('div', { class: 'ledger-entry' },
              h('span', { class: `dir dir-${entry.direction}`, text: entry.direction }),
              h('div', {},
                h('div', { class: 'ledger-account' }, entry.account, ' ',
                  h('span', { class: 'mono-inline', text: entry.account_code })),
                h('div', { class: 'ledger-explain', text: entry.what_this_means }),
                h('div', { class: 'footnote', text: entry.narrative }),
              ),
              h('span', { class: 'ledger-amount', text: money(entry.amount, entry.currency) }),
            ))),
            h('p', { class: 'footnote', text: journal.how_a_reversal_would_work }),
          ))),
    ), null),

    h('div', { class: 'grid grid-2' },
      card('Partner exchanges', table([
        { key: 'operation', label: 'Operation' },
        { key: 'direction', label: 'Direction' },
        { key: 'outcome', label: 'Outcome', render: (e) => stateChip(e.outcome) },
        { key: 'simulated_scenario', label: 'Scenario',
          render: (e) => simulatedChip(e.simulated_scenario ? titleCase(e.simulated_scenario) : 'Simulated') },
        { key: 'latency_ms', label: 'Latency', align: 'right',
          render: (e) => (e.latency_ms ? `${e.latency_ms} ms` : '—') },
        { key: 'occurred_at', label: 'When', render: (e) => dateTime(e.occurred_at) },
      ], data.partner_interactions, { empty: 'No partner calls.' })),

      card('What the customer was told', table([
        { key: 'created_at', label: 'When', render: (n) => dateTime(n.created_at) },
        { key: 'event_type', label: 'Event', render: (n) => titleCase(n.event_type) },
        { key: 'subject', label: 'Message' },
      ], data.customer_notifications ?? [], { empty: 'No notifications were sent.' })),
    ),

    card('Audit events for this payment', table([
      { key: 'occurred_at', label: 'When', render: (e) => dateTime(e.occurred_at) },
      { key: 'category', label: 'Category', render: (e) => titleCase(e.category) },
      { key: 'action', label: 'Action', className: 'mono' },
      { key: 'outcome', label: 'Outcome', render: (e) => stateChip(e.outcome) },
      { key: 'actor_name', label: 'Actor', render: (e) => e.actor_name ?? titleCase(e.actor_type ?? 'system') },
      { key: 'reason', label: 'Reason' },
    ], data.audit_events ?? [], { empty: 'No audit events.' })),
  );
}

// ---------------------------------------------------------------------------
// 3. Ledger explorer
// ---------------------------------------------------------------------------

export async function ledgerExplorer(ctx) {
  // Reading the ledger is a sensitive permission and several roles that can reach the
  // Learning Center do not hold it. The explanation below is the point of this screen and
  // is worth showing to everyone; the live figures are only shown to those entitled to
  // them, and are not requested at all otherwise.
  const readable = can('ledger.read');
  const [accounts, tb] = readable
    ? await Promise.all([get('/api/ledger/accounts'), get('/api/ledger/trial-balance')])
    : [[], null];

  const byCategory = new Map();
  for (const account of accounts) {
    if (!byCategory.has(account.category)) byCategory.set(account.category, []);
    byCategory.get(account.category).push(account);
  }

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Ledger explorer' }),
        h('p', { class: 'page-sub', text: 'What a debit and a credit actually mean here' }),
      ),
    ),

    card('The three rules that make a ledger trustworthy', h('div', { class: 'card-body' },
      h('dl', { class: 'kv' },
        h('dt', { text: 'Every movement has at least two sides that sum to zero' }),
        h('dd', {
          text:
            'Within each currency. A cross-currency payment is two conversions, so it balances twice, ' +
            'not once. The database refuses an unbalanced journal at commit — the application cannot ' +
            'write one even if it tries.',
        }),
        h('dt', { text: 'Balances are never stored' }),
        h('dd', {
          text:
            'Every balance you see is summed from the entries when you ask for it. There is no cached ' +
            'figure, so there is nothing that can quietly drift away from the entries behind it.',
        }),
        h('dt', { text: 'Corrections are reversals, never edits' }),
        h('dd', {
          text:
            'A mistake is corrected by posting its mirror image. The two together have no net effect, ' +
            'and both stay visible. Nothing is ever deleted or rewritten.',
        }),
      ),
    ), null),

    tb
      ? card('The check that catches almost everything', h('div', {},
          h('p', { class: 'card-body ledger-explain',
            text:
              'If debits do not equal credits in every currency, something is wrong that no screen ' +
              'design will hide. This is the first thing to look at when a figure seems odd.' }),
          table([
            { key: 'currency', label: 'Currency' },
            { key: 'totalDebits', label: 'Debits', align: 'right', render: (r) => money(r.totalDebits, null) },
            { key: 'totalCredits', label: 'Credits', align: 'right', render: (r) => money(r.totalCredits, null) },
            { key: 'difference', label: 'Difference', align: 'right', render: (r) => money(r.difference, r.currency) },
            { key: 'balanced', label: 'Result',
              render: (r) => (r.balanced
                ? h('span', { class: 'chip chip-ok' }, 'Balanced')
                : h('span', { class: 'chip chip-danger' }, 'Out of balance')) },
          ], tb.trial_balance),
        ))
      : null,

    ...[...byCategory.entries()].map(([category, rows]) => card(titleCase(category), h('div', {},
      h('p', { class: 'card-body ledger-explain',
        text: CATEGORY_MEANING[category] ?? 'No plain-English description is recorded for this category.' }),
      table([
        { key: 'code', label: 'Account', className: 'mono' },
        { key: 'name', label: 'Name' },
        { key: 'accountType', label: 'Type', render: (a) => titleCase(a.accountType) },
        { key: 'normalSide', label: 'Normal side', render: (a) => titleCase(a.normalSide) },
        { key: 'currency', label: 'Currency' },
        { key: 'balanceNatural', label: 'Balance', align: 'right',
          render: (a) => money(a.balanceNatural, a.currency) },
        { key: 'entryCount', label: 'Entries', align: 'right' },
      ], rows),
    ))),

    readable
      ? null
      : notice('info', 'The live figures are not shown to your roles',
          h('p', {
            text:
              'Reading account balances requires the ledger.read permission, which your roles do not ' +
              'include. Everything above explains how the ledger works and applies regardless.',
          })),
  );
}

const CATEGORY_MEANING = {
  customer_funding_receivable:
    'What a customer still owes us to fund a payment we have agreed to make. It goes up when we ' +
    'recognise the obligation and down when the money reaches the partner.',
  customer_settlement_payable:
    'What we have undertaken to deliver to a beneficiary. It goes up when a quote is accepted and ' +
    'down when the payment is made.',
  partner_funding_account:
    'What the partner institution is holding on the customer\'s behalf. Note whose money this is: ' +
    'the partner holds it, not EKORails.',
  partner_settlement_account:
    'What the settlement institution holds and pays out from.',
  fx_clearing:
    'The account a currency conversion passes through. One leg takes on one currency, the other ' +
    'gives up the other. A balance left here means half a conversion happened.',
  settlement_suspense:
    'Where a shortfall goes when a settlement does not complete in full. It is parked here with an ' +
    'owner, not written off.',
  reconciliation_difference:
    'A difference between our records and a partner\'s that nobody has yet explained.',
  fee_revenue: 'What EKORails earned in fees.',
  partner_fees_payable: 'What EKORails owes a partner in fees.',
  regulatory_charges_payable: 'Levies and charges owed.',
  returned_funds: 'Money sent back by a destination bank, which we now owe to the customer.',
  test_liquidity:
    'Money invented for the demonstration. No real funds correspond to it, which is exactly why it ' +
    'has its own account rather than being mixed in with anything else.',
};

// ---------------------------------------------------------------------------
// 4. Architecture explorer
// ---------------------------------------------------------------------------

export async function architectureExplorer(ctx) {
  const data = await get('/api/learning/architecture');

  const byLayer = new Map();
  for (const component of data.components) {
    if (!byLayer.has(component.layer)) byLayer.set(component.layer, []);
    byLayer.get(component.layer).push(component);
  }

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Architecture explorer' }),
        h('p', { class: 'page-sub', text: 'What each part does, what it talks to, and what protects it' }),
      ),
    ),

    ...[...byLayer.entries()].map(([layer, components]) => card(`${titleCase(layer)} layer`,
      h('div', { class: 'card-body' }, components.map((component) => h('div', { style: 'margin-bottom:1rem' },
        h('h3', {}, component.name, ' ', stateChip(component.status)),
        h('p', { text: component.plain_english }),
        h('p', { class: 'footnote' },
          h('strong', { text: 'Security: ' }), component.security_note),
        component.talks_to.length > 0
          ? h('p', { class: 'footnote' },
              h('strong', { text: 'Talks to: ' }), component.talks_to.join(', '))
          : h('p', { class: 'footnote', text: 'Talks to nothing else. It is the bottom of the stack.' }),
      ))),
      null,
    )),

    card('How data moves between them', table([
      { key: 'from', label: 'From', className: 'mono' },
      { key: 'to', label: 'To', className: 'mono' },
      { key: 'carries', label: 'What it carries' },
    ], data.data_flows)),

    card('What is not here yet', h('div', { class: 'card-body' },
      h('p', {
        text:
          'Named plainly rather than left to be discovered. Each of these is a real gap between this ' +
          'build and a production deployment.',
      }),
      h('ul', {}, data.what_is_not_here_yet.map((item) => h('li', { text: item }))),
    ), null),

    card('Environment', h('div', { class: 'card-body' }, keyValues([
      ['Mode', data.environment.mode],
      ['Live funds', data.environment.live_funds_enabled
        ? h('span', { class: 'chip chip-danger' }, 'Enabled')
        : h('span', { class: 'chip chip-ok' }, 'Disabled')],
    ])), null),
  );
}

// ---------------------------------------------------------------------------
// 5. State machine
// ---------------------------------------------------------------------------

export async function stateMachineExplorer(ctx) {
  const data = await get('/api/learning/state-machine');
  const selected = ctx.query.get('state') ?? data.states[0]?.state ?? '';
  const state = data.states.find((s) => s.state === selected) ?? data.states[0];

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Transaction states' }),
        h('p', { class: 'page-sub',
          text: `${data.states.length} states, ${data.transition_count} declared transitions` }),
      ),
    ),

    notice('warning', 'What "settled" means here', h('p', { text: data.note })),

    notice('info', 'There is no function that simply sets a state',
      h('p', {
        text:
          'Every route between two states is declared with the actor allowed to take it, the ' +
          'permission required, the preconditions, the accounting consequence and whether it needs ' +
          're-authentication. A state cannot be reached by any other means.',
      }),
    ),

    card('Every state', table([
      { key: 'state', label: 'State', className: 'mono',
        render: (s) => h('button', {
          class: 'row-link',
          onclick: () => ctx.navigate(`/learning/state-machine?state=${encodeURIComponent(s.state)}`),
        }, s.state) },
      { key: 'plain_english', label: 'What it means' },
      { key: 'is_terminal', label: 'Terminal',
        render: (s) => (s.is_terminal
          ? h('span', { class: 'chip chip-neutral' }, 'Nothing follows')
          : h('span', { class: 'chip chip-info' }, 'Has outward routes')) },
      { key: 'outbound_transitions', label: 'Routes out', align: 'right',
        render: (s) => String(s.outbound_transitions.length) },
    ], data.states)),

    state
      ? card(`Routes out of ${state.state}`, h('div', {},
          h('p', { class: 'card-body ledger-explain', text: state.plain_english ?? '' }),
          table([
            { key: 'event', label: 'Event', className: 'mono' },
            { key: 'to', label: 'Leads to', className: 'mono' },
            { key: 'description', label: 'What happens' },
            { key: 'permitted_actor_types', label: 'Who may',
              render: (t) => t.permitted_actor_types.map(titleCase).join(', ') },
            { key: 'permitted_roles_by_permission', label: 'Permission required', className: 'mono',
              render: (t) => (t.permitted_roles_by_permission.length > 0
                ? t.permitted_roles_by_permission.join(', ')
                : h('span', { class: 'chip chip-neutral' }, 'Not a human action')) },
            { key: 'requires_step_up', label: 'Re-authentication',
              render: (t) => (t.requires_step_up
                ? h('span', { class: 'chip chip-warn' }, 'Required')
                : '—') },
            { key: 'accounting_consequence', label: 'Ledger effect' },
            { key: 'notifies', label: 'Notifies',
              render: (t) => (t.notifies.length > 0 ? t.notifies.map(titleCase).join(', ') : '—') },
            { key: 'preconditions', label: 'Only if',
              render: (t) => (t.preconditions.length > 0
                ? t.preconditions.join('; ')
                : 'No precondition beyond being in this state') },
          ], state.outbound_transitions, { empty: 'This is a terminal state. Nothing follows it.' }),
        ))
      : null,
  );
}

// ---------------------------------------------------------------------------
// 6. Decision log
// ---------------------------------------------------------------------------

export async function decisionLog(ctx) {
  const [data, me] = await Promise.all([get('/api/learning/decisions'), get('/api/me')]);
  const canApprove = me.permissions.includes('learning.decision.approve');

  const open = data.decisions.filter((d) => d.status === 'awaiting_approval');
  const closed = data.decisions.filter((d) => d.status !== 'awaiting_approval');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Decision log' }),
        h('p', { class: 'page-sub', text: `${data.decisions.length} decisions, ${data.open_count} still open` }),
      ),
    ),

    notice('info', 'An open decision means the software is running on a placeholder',
      h('p', { text: data.note }),
    ),

    ...open.map((decision) => card(`${decision.decision_ref} — ${decision.title}`,
      h('div', { class: 'card-body' },
        h('p', { class: 'footnote' }, stateChip(decision.status), ' ',
          decision.blocks ? h('span', { class: 'chip chip-danger' }, `Blocks: ${decision.blocks}`) : null),
        keyValues([
          ['The issue', decision.context],
          ['Options considered', Array.isArray(decision.options_considered)
            ? h('ul', {}, decision.options_considered.map((o) =>
                h('li', { text: typeof o === 'string' ? o : JSON.stringify(o) })))
            : String(decision.options_considered ?? '—')],
          ['Recommended', decision.recommended_option],
          ['Main risk', decision.main_risk],
          ['Regulatory impact', decision.regulatory_impact],
          ['Cost impact', decision.cost_impact],
          ['Reversibility', titleCase(decision.reversibility)],
        ]),
        canApprove
          ? h('div', { style: 'margin-top:.7rem' },
              h('button', { class: 'btn btn-primary', onclick: () => approveDecision(ctx, decision) },
                'Record your decision'))
          : h('p', { class: 'footnote',
              text: 'Recording a decision requires the learning.decision.approve permission.' }),
      ), null)),

    card('Decided', table([
      { key: 'decision_ref', label: 'Reference', className: 'mono' },
      { key: 'title', label: 'Decision' },
      { key: 'status', label: 'Status', render: (d) => stateChip(d.status) },
      { key: 'recommended_option', label: 'Option taken' },
      { key: 'reason_selected', label: 'Why' },
      { key: 'approver', label: 'Approved by' },
      { key: 'approved_at', label: 'When', render: (d) => (d.approved_at ? dateTime(d.approved_at) : '—') },
      { key: 'reversibility', label: 'Reversible', render: (d) => titleCase(d.reversibility) },
    ], closed, { empty: 'No decisions have been recorded yet.' })),
  );
}

async function approveDecision(ctx, decision) {
  const reason = textarea({
    placeholder:
      'Which option you are choosing and why. This is the record of the decision, not a note about it.',
  });

  const result = await modal({
    title: `${decision.decision_ref} — ${decision.title}`,
    confirmLabel: 'Record the decision',
    body: h('div', {},
      h('p', { text: decision.context }),
      h('p', {}, h('strong', { text: 'Recommended: ' }), decision.recommended_option),
      h('p', {}, h('strong', { text: 'Main risk: ' }), decision.main_risk),
      notice('warning', null,
        'Recording a decision here does not change the software. The placeholder it governs must ' +
        'still be replaced through a maker-checker configuration change.'),
      field('Your reasoning', reason),
    ),
    onConfirm: async () => post(`/api/learning/decisions/${encodeURIComponent(decision.decision_ref)}/approve`, {
      reason_selected: reason.value.trim(),
    }),
  });

  if (result) {
    toast('ok', `${result.decision_ref} recorded`, result.next_step);
    ctx.reload();
  }
}

// ---------------------------------------------------------------------------
// 7. Build journal
// ---------------------------------------------------------------------------

export async function buildJournal(ctx) {
  const entries = await get('/api/learning/build-journal');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Build journal' }),
        h('p', { class: 'page-sub', text: `${entries.length} entries` }),
      ),
    ),

    notice('info', 'Written as it happened, including the parts that did not work',
      h('p', {
        text:
          'The most useful entries are the ones recording where a control blocked the build itself. ' +
          'A control that has never inconvenienced anyone has probably never been tested.',
      }),
    ),

    ...entries.map((entry) => card(entry.milestone, h('div', { class: 'card-body' },
      h('p', { class: 'footnote', text: dateOnly(entry.entry_date) }),
      keyValues([
        ['What was built', entry.what_was_built],
        ['What changed', entry.what_changed],
        ['How to test it yourself', entry.how_to_test],
        ['Still simulated', h('span', {}, simulatedChip(), ' ', entry.still_simulated)],
        ['Known limitations', h('span', { style: 'color:var(--warn)', text: entry.known_limitations })],
        ['Decisions still open', entry.open_decisions],
        ['New risks introduced', entry.new_risks],
        ['Questions for you', entry.questions_for_founder],
      ]),
    ), null)),

    entries.length === 0 ? card(null, h('div', { class: 'empty', text: 'No journal entries.' })) : null,
  );
}

// ---------------------------------------------------------------------------
// 8. Risk register
// ---------------------------------------------------------------------------

export async function riskRegister(ctx) {
  const risks = await get('/api/learning/risk-register');
  const blocking = risks.filter((r) => r.blocks_pilot);

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Risk register' }),
        h('p', { class: 'page-sub', text: `${risks.length} risks, ${blocking.length} blocking a pilot` }),
      ),
    ),

    blocking.length > 0
      ? notice('warning', `${blocking.length} risks would block a pilot`,
          h('ul', {}, blocking.map((r) =>
            h('li', {}, h('span', { class: 'mono-inline', text: r.risk_ref }), ' ', r.title,
              r.further_action ? h('span', { class: 'footnote', text: ` — ${r.further_action}` }) : null))))
      : null,

    ...risks.map((risk) => card(`${risk.risk_ref} — ${risk.title}`, h('div', { class: 'card-body' },
      h('p', { class: 'footnote' },
        titleCase(risk.category), ' · ',
        stateChip(risk.control_status), ' ',
        risk.blocks_pilot ? h('span', { class: 'chip chip-danger' }, 'Blocks a pilot') : null,
      ),
      h('p', { text: risk.description }),
      keyValues([
        ['Inherent', `${titleCase(risk.inherent_likelihood)} likelihood, ${titleCase(risk.inherent_impact)} impact`],
        ['Controls in place', risk.existing_controls],
        ['Control status', stateChip(risk.control_status)],
        ['Residual', `${titleCase(risk.residual_likelihood)} likelihood, ${titleCase(risk.residual_impact)} impact`],
        ['Treatment', titleCase(risk.treatment)],
        ['Owner', risk.owner],
        ['Further action', risk.further_action ?? 'None outstanding'],
      ]),
    ), null)),
  );
}

// ---------------------------------------------------------------------------
// 9. Glossary
// ---------------------------------------------------------------------------

export async function glossary(ctx) {
  const terms = await get('/api/learning/glossary');
  const search = ctx.query.get('q') ?? '';
  const shown = search
    ? terms.filter((t) =>
        `${t.term} ${t.short_definition} ${t.plain_english} ${t.why_it_matters}`
          .toLowerCase().includes(search.toLowerCase()))
    : terms;

  const box = input({ placeholder: 'Search the glossary', value: search, id: 'glossary-search' });
  const form = h('form', {
    onsubmit: (event) => {
      event.preventDefault();
      ctx.navigate(`/learning/glossary${box.value.trim() ? `?q=${encodeURIComponent(box.value.trim())}` : ''}`);
    },
    style: 'display:flex; gap:.4rem',
  }, box, h('button', { class: 'btn', type: 'submit' }, 'Search'));

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Glossary' }),
        h('p', { class: 'page-sub', text: `${shown.length} of ${terms.length} terms` }),
      ),
      h('div', { class: 'filters' },
        h('label', { class: 'sr-only', for: 'glossary-search' }, 'Search'), form),
    ),

    card(null, h('div', { class: 'card-body' },
      shown.length === 0
        ? h('div', { class: 'empty', text: 'No term matches that search.' })
        : h('dl', { class: 'kv' }, shown.flatMap((term) => [
            h('dt', { text: term.term }),
            h('dd', {},
              h('p', {}, h('strong', { text: term.short_definition })),
              h('p', { text: term.plain_english }),
              term.why_it_matters
                ? h('p', { class: 'footnote' }, h('strong', { text: 'Why it matters: ' }), term.why_it_matters)
                : null,
              term.common_misunderstanding
                ? h('p', { class: 'footnote' },
                    h('strong', { text: 'Commonly misunderstood as: ' }), term.common_misunderstanding)
                : null,
            ),
          ])),
    ), null),
  );
}

// ---------------------------------------------------------------------------
// 10. Guided demonstration
// ---------------------------------------------------------------------------

/**
 * A scripted path for showing the system to somebody else. It is deliberately written as
 * instructions rather than as an automated tour: a demonstration that clicks itself
 * teaches the audience nothing about whether the person demonstrating understands it.
 */
const DEMO_SCRIPT = [
  {
    title: 'Say what this is, and what it is not',
    path: '/regulator',
    say:
      'Open the supervisory view first. It states plainly that EKORails is not a bank, not a ' +
      'deposit-taking institution, not a licensed payment provider, not a custodian of customer ' +
      'funds and not an admitted sandbox participant — and it shows how each of those is enforced ' +
      'in the software rather than merely promised.',
    watch_for:
      'Your audience will believe the boundary more if you volunteer it than if they have to ask.',
  },
  {
    title: 'Show that nothing here moves real money',
    path: '/regulator/controls',
    say:
      'Nine release gates stand between this build and live funds. None of them can be set from any ' +
      'screen. Point out how many are met — the honest number, not a comforting one.',
    watch_for: 'Somebody will ask whether the banner can be turned off. It cannot; the client blocks the page if the banner and the server disagree.',
  },
  {
    title: 'Create a payment as a customer',
    path: '/transactions/new',
    say:
      'A business initiates a payment to an approved beneficiary. Note that the beneficiary had to be ' +
      'approved separately before it could be used, and that the person initiating cannot be the ' +
      'person who authorises.',
    watch_for: 'The source-of-funds narrative has a minimum length. That is a due-diligence requirement, not a form nicety.',
  },
  {
    title: 'Watch compliance refuse to rubber-stamp it',
    path: '/compliance/cases',
    say:
      'Every transaction in this build raises a compliance case, because the corridor is an ' +
      'unconfirmed placeholder. Open the case and show the rules that were evaluated — including the ' +
      'ones that did not fire, which is the difference between evidence and a gap.',
    watch_for: 'The decision needs a written reason and cannot be edited afterwards.',
  },
  {
    title: 'Route it through treasury',
    path: '/ops/queue',
    say:
      'Treasury issues an indicative quote, requests funding, converts and positions the currency, and ' +
      'submits the instruction. Each of those is a separate step by a separate role.',
    watch_for: 'The quote is indicative until accepted, and this build cannot mark a rate as locked because no partner has contractually locked one.',
  },
  {
    title: 'Break it on purpose',
    path: '/admin/simulation',
    say:
      'Direct a simulator to time out, then submit a settlement. The transaction goes to "outcome ' +
      'unknown" and automatic retry switches off. Explain why: retrying blindly is how a payment gets ' +
      'made twice.',
    watch_for: 'This is the moment that separates a demonstration from a slideshow. Do not skip it.',
  },
  {
    title: 'Show the money in the ledger',
    path: '/finance/trial-balance',
    say:
      'Debits equal credits in every currency. Show that the check runs in SQL against the tables, so ' +
      'a bug in the application cannot make it pass.',
    watch_for: 'There is no customer stored-value account in the chart of accounts. That is the strongest evidence that no customer funds are held.',
  },
  {
    title: 'Reconcile, and find a break',
    path: '/finance/reconciliation',
    say:
      'Run reconciliation. Where our records and a partner\'s disagree, it opens a break rather than ' +
      'adopting either figure, and the break needs an explanation from a person before it closes.',
    watch_for: 'Above the four-eyes threshold, the investigator cannot approve their own closure.',
  },
  {
    title: 'Prove the record cannot be edited',
    path: '/regulator/audit',
    say:
      'The audit trail is hash-chained and verified inside the database. Show a refused action in the ' +
      'trail — a trail containing only successes tells you nothing about what somebody tried to do.',
    watch_for: 'The application role holds no UPDATE or DELETE grant on the audit table. A bug cannot rewrite history.',
  },
  {
    title: 'Finish on what is not done',
    path: '/learning/product-map',
    say:
      'End on the product map and the open decisions. Say which modules are genuinely incomplete and ' +
      'which facts are still placeholders because the sandbox application was not available.',
    watch_for: 'This is the part people remember. Ending on an honest gap is more persuasive than ending on a claim.',
  },
];

export async function guidedDemo(ctx) {
  const step = Math.max(0, Math.min(DEMO_SCRIPT.length - 1, Number(ctx.query.get('step') ?? 0)));
  const current = DEMO_SCRIPT[step];

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Guided demonstration' }),
        h('p', { class: 'page-sub', text: `Step ${step + 1} of ${DEMO_SCRIPT.length}` }),
      ),
      h('div', { class: 'page-actions' },
        step > 0
          ? h('button', { class: 'btn', onclick: () => ctx.navigate(`/learning/demo?step=${step - 1}`) }, 'Previous')
          : null,
        step < DEMO_SCRIPT.length - 1
          ? h('button', { class: 'btn btn-primary', onclick: () => ctx.navigate(`/learning/demo?step=${step + 1}`) }, 'Next step')
          : h('button', { class: 'btn', onclick: () => ctx.navigate('/learning/demo?step=0') }, 'Start again'),
      ),
    ),

    notice('info', 'This script does not click for you, on purpose',
      h('p', {
        text:
          'A tour that runs itself demonstrates the tour. Reading the step, opening the screen and ' +
          'saying it in your own words demonstrates that you understand the system — which is what ' +
          'anyone watching is actually assessing.',
      }),
    ),

    card(`${step + 1}. ${current.title}`, h('div', { class: 'card-body' },
      h('h3', { text: 'What to say' }),
      h('p', { text: current.say }),
      h('h3', { text: 'What to watch for' }),
      h('p', { text: current.watch_for }),
      h('p', { style: 'margin-top:.9rem' },
        h('button', { class: 'btn btn-primary', onclick: () => ctx.navigate(current.path) },
          'Open the screen for this step')),
    ), null),

    card('The whole script', h('div', { class: 'card-body' },
      h('ol', {}, DEMO_SCRIPT.map((s, index) =>
        h('li', {},
          h('button', {
            class: index === step ? 'row-link' : 'row-link',
            style: index === step ? 'font-weight:640' : null,
            onclick: () => ctx.navigate(`/learning/demo?step=${index}`),
          }, s.title),
        ))),
    ), null),
  );
}

// ---------------------------------------------------------------------------
// 11. Assessments
// ---------------------------------------------------------------------------

export async function assessment(ctx) {
  const data = await get(`/api/learning/assessments/${encodeURIComponent(ctx.params.moduleKey)}`);
  const chosen = new Map();

  const resultBox = h('div', {});

  const questions = data.questions.map((question) => {
    const name = `q-${question.ordinal}`;
    return h('fieldset', { style: 'border:0; padding:0; margin:0 0 1.1rem' },
      h('legend', { style: 'font-weight:600; margin-bottom:.4rem' },
        `${question.ordinal}. ${question.question}`),
      ...question.options.map((option, index) => {
        const id = `${name}-${index}`;
        const radio = h('input', {
          type: 'radio', name, id, value: String(index),
          onchange: () => chosen.set(question.ordinal, index),
        });
        return h('div', { style: 'display:flex; gap:.5rem; align-items:flex-start; margin:.2rem 0' },
          radio, h('label', { for: id, text: option }));
      }),
    );
  });

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      try {
        const answers = data.questions.map((q) => (chosen.has(q.ordinal) ? chosen.get(q.ordinal) : -1));
        const result = await post(`/api/learning/assessments/${encodeURIComponent(ctx.params.moduleKey)}`, { answers });
        renderResult(resultBox, result);
      } catch (error) {
        reportError(error);
      }
    },
  },
    ...questions,
    h('button', { class: 'btn btn-primary', type: 'submit' }, 'Check my answers'),
  );

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: `Assessment: ${data.module}` }),
        h('p', { class: 'page-sub', text: `${data.questions.length} questions` }),
      ),
    ),

    notice('info', 'This never restricts what you can do', h('p', { text: data.note })),

    card(null, h('div', { class: 'card-body' }, form), null),
    resultBox,
  );
}

function renderResult(host, result) {
  host.replaceChildren(card(`You scored ${result.score} out of ${result.total}`,
    h('div', { class: 'card-body' },
      ...(result.results ?? []).map((r) => h('div', { style: 'margin-bottom:.8rem' },
        h('p', {},
          r.correct
            ? h('span', { class: 'chip chip-ok' }, 'Correct')
            : h('span', { class: 'chip chip-warn' }, 'Not quite'),
          ' ', r.question),
        r.correct
          ? null
          : h('p', { class: 'footnote' },
              h('strong', { text: 'You chose: ' }), r.your_answer ?? 'nothing', '. ',
              h('strong', { text: 'The answer is: ' }), r.correct_answer),
        h('p', { class: 'ledger-explain', text: r.explanation }),
      )),
      result.note ? h('p', { class: 'footnote', text: result.note }) : null,
    ), null));
  host.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
