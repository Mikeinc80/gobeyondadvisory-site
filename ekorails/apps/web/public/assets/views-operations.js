/**
 * Operations Console — treasury and settlement.
 *
 * This console exists because the person who routes a settlement is not the person who
 * cleared its compliance review and not the person who authorised it on the customer's
 * side. Giving treasury its own screen is how that separation stays visible in daily work
 * rather than only in the permission matrix.
 *
 * The queue is organised by what is waiting on a human, not by recency. A transaction in
 * `outcome_unknown` sits at the top of this console permanently until somebody establishes
 * the true position with the partner, because that is the state in which paying twice
 * becomes possible.
 */

import {
  h, get, post, card, stat, table, notice, keyValues, stateChip, simulatedChip,
  money, dateTime, relativeTime, titleCase, toast, reportError, modal, field, input,
  textarea, select, valueOrPlaceholder,
} from './core.js';

/** States in which the ball is in treasury's court, most urgent first. */
const TREASURY_STATES = [
  {
    state: 'under_investigation',
    label: 'Under investigation',
    why:
      'Something went wrong that the system will not resolve on its own: the partner did not answer, ' +
      'or settled less than instructed. Automatic retry is disabled here — retrying blindly is how a ' +
      'payment gets made twice. Establish the true position with the partner first.',
    urgent: true,
  },
  {
    state: 'compliance_approved',
    label: 'Awaiting quote',
    why: 'Compliance has cleared this. It needs an FX quote before the customer can proceed.',
  },
  {
    state: 'quote_issued',
    label: 'Quote with the customer',
    why: 'An indicative quote has been issued. It expires if the customer does not accept it in time.',
  },
  {
    state: 'quote_accepted',
    label: 'Awaiting funding request',
    why: 'The customer accepted the rate. Funding has to be requested before anything can settle.',
  },
  {
    state: 'awaiting_funding',
    label: 'Awaiting funding',
    why: 'Waiting for the customer to fund the partner account. Nothing settles until it arrives.',
  },
  {
    state: 'funding_confirmed',
    label: 'Ready to prepare',
    why: 'Funds are with the partner. Currency conversion and liquidity positioning come next.',
  },
  {
    state: 'ready_for_settlement',
    label: 'Ready to submit',
    why: 'Converted and positioned. The instruction can be sent to the settlement partner.',
  },
  {
    state: 'submitted_to_partner',
    label: 'With partner',
    why: 'Sent. Waiting on the partner to accept, settle or reject.',
  },
  {
    state: 'partner_processing',
    label: 'Partner processing',
    why: 'The partner accepted the instruction and has not yet reported an outcome.',
  },
  {
    state: 'settled',
    label: 'Settled, awaiting confirmation',
    why:
      'The partner reported the payment as made. That is not settlement finality, which is a legal ' +
      'property nothing in this build can produce.',
  },
  {
    state: 'returned',
    label: 'Returned',
    why:
      'The destination bank sent the money back. The original settlement is not reversed — a return ' +
      'is a new event, and erasing the first would hide what happened.',
    urgent: true,
  },
];


// ---------------------------------------------------------------------------

export async function opsDashboard(ctx) {
  const [queues, exceptions, partners] = await Promise.all([
    Promise.all(TREASURY_STATES.map((s) =>
      get(`/api/transactions?state=${s.state}&limit=100`)
        .then((rows) => ({ ...s, rows }))
        .catch(() => ({ ...s, rows: [] })))),
    get('/api/exceptions?open_only=true').catch(() => []),
    get('/api/admin/partners').catch(() => []),
  ]);

  const waiting = queues.reduce((sum, q) => sum + q.rows.length, 0);
  const urgent = queues.filter((q) => q.urgent).reduce((sum, q) => sum + q.rows.length, 0);
  const degradedPartners = partners.filter((p) => p.status !== 'active');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Operations' }),
        h('p', { class: 'page-sub' },
          'Treasury and settlement. ', simulatedChip('Every partner here is a simulator'),
        ),
      ),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => ctx.navigate('/ops/queue') }, 'Open the queue'),
      ),
    ),

    h('div', { class: 'grid grid-4' },
      stat('Waiting on treasury', String(waiting), 'Across every treasury state'),
      stat('Needs a decision now', String(urgent),
        'Unknown outcomes, short funding and partial settlements',
        urgent > 0 ? 'danger' : null),
      stat('Open exceptions', String(exceptions.length),
        exceptions.filter((e) => e.breachedSla).length > 0
          ? `${exceptions.filter((e) => e.breachedSla).length} past their service target`
          : 'None past their service target',
        exceptions.filter((e) => e.breachedSla).length > 0 ? 'danger' : null),
      stat('Partners not active', String(degradedPartners.length),
        degradedPartners.length > 0 ? degradedPartners.map((p) => p.code).join(', ') : 'All simulators responding'),
    ),

    urgent > 0
      ? notice('warning', 'Some transactions cannot progress without a person',
          h('p', {
            text:
              'Unknown outcomes, short funding and partial settlements are deliberately not automated. ' +
              'Each one needs somebody to establish what actually happened before the system moves it on.',
          }))
      : null,

    ...queues.filter((q) => q.rows.length > 0).map((q) => queueCard(ctx, q)),

    queues.every((q) => q.rows.length === 0)
      ? card('Queue', h('div', { class: 'empty', text: 'Nothing is waiting on treasury.' }))
      : null,
  );
}

function queueCard(ctx, queue) {
  return card(
    `${queue.label} (${queue.rows.length})`,
    h('div', {},
      h('p', { class: 'card-body ledger-explain', text: queue.why }),
      table([
        { key: 'reference', label: 'Reference', className: 'mono',
          render: (r) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/transactions/${r.id}`) }, r.reference) },
        { key: 'organization_name', label: 'Customer' },
        { key: 'beneficiary_name', label: 'Beneficiary' },
        { key: 'send_amount', label: 'Send', align: 'right', render: (r) => money(r.send_amount, r.send_currency) },
        { key: 'expected_receive_amount', label: 'Expected receive', align: 'right',
          render: (r) => money(r.expected_receive_amount, r.receive_currency) },
        { key: 'created_at', label: 'Age', render: (r) => relativeTime(r.created_at) },
      ], queue.rows),
    ),
  );
}

// ---------------------------------------------------------------------------

export async function opsQueue(ctx) {
  const stateFilter = ctx.query.get('state') ?? '';
  const rows = await get(
    `/api/transactions?limit=200${stateFilter ? `&state=${encodeURIComponent(stateFilter)}` : ''}`,
  );

  const description = TREASURY_STATES.find((s) => s.state === stateFilter);

  const filter = select(
    [{ value: '', label: 'Every state' },
      ...TREASURY_STATES.map((s) => ({ value: s.state, label: s.label, selected: s.state === stateFilter })),
    ],
    {
      id: 'ops-queue-state',
      onchange: (e) => ctx.navigate(`/ops/queue${e.target.value ? `?state=${e.target.value}` : ''}`),
    },
  );

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Settlement queue' }),
        h('p', { class: 'page-sub', text: `${rows.length} transactions` }),
      ),
      h('div', { class: 'filters' }, h('label', { class: 'sr-only', for: 'ops-queue-state' }, 'State'), filter),
    ),

    description ? notice('info', description.label, description.why) : null,

    card(null, table([
      { key: 'reference', label: 'Reference', className: 'mono',
        render: (r) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/transactions/${r.id}`) }, r.reference) },
      { key: 'state', label: 'State', render: (r) => stateChip(r.state) },
      { key: 'organization_name', label: 'Customer' },
      { key: 'beneficiary_name', label: 'Beneficiary' },
      { key: 'beneficiary_country', label: 'Destination' },
      { key: 'send_amount', label: 'Send', align: 'right', render: (r) => money(r.send_amount, r.send_currency) },
      { key: 'risk_rating', label: 'Risk', render: (r) => (r.risk_rating ? stateChip(r.risk_rating) : '—') },
      { key: 'created_at', label: 'Created', render: (r) => dateTime(r.created_at) },
    ], rows, { empty: 'Nothing in this queue.' })),
  );
}

// ---------------------------------------------------------------------------

export async function liquidityView(ctx) {
  const accounts = await get('/api/ledger/accounts');

  const partnerAccounts = accounts.filter((a) =>
    ['partner_funding_account', 'partner_settlement_account', 'test_liquidity'].includes(a.category));
  const clearing = accounts.filter((a) => a.category === 'fx_clearing');
  const suspense = accounts.filter((a) =>
    ['settlement_suspense', 'reconciliation_difference'].includes(a.category));

  const openClearing = clearing.filter((a) => a.balanceNatural !== '0.000000' && a.balanceNatural !== '0');
  const openSuspense = suspense.filter((a) => a.balanceNatural !== '0.000000' && a.balanceNatural !== '0');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Liquidity' }),
        h('p', { class: 'page-sub' },
          'Where value sits across the partner accounts. ', simulatedChip('Simulated balances'),
        ),
      ),
    ),

    notice('info', 'These balances are not EKORails money',
      h('p', {
        text:
          'Every figure below records what a partner institution holds, or a position between two ' +
          'currencies mid-conversion. EKORails holds no customer funds: there is no customer ' +
          'stored-value account in the chart of accounts, so the ledger has nowhere to record it.',
      }),
    ),

    h('div', { class: 'grid grid-3' },
      stat('Partner accounts', String(partnerAccounts.length), 'Funding, settlement and test liquidity'),
      stat('Open FX positions', String(openClearing.length),
        openClearing.length === 0
          ? 'Every conversion has been positioned'
          : 'A conversion has not been matched by positioning',
        openClearing.length > 0 ? 'warn' : null),
      stat('Unresolved suspense', String(openSuspense.length),
        openSuspense.length === 0 ? 'Nothing parked' : 'Amounts nobody has yet explained',
        openSuspense.length > 0 ? 'warn' : null),
    ),

    card('Partner positions', table([
      { key: 'code', label: 'Account', className: 'mono' },
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Purpose', render: (a) => titleCase(a.category) },
      { key: 'currency', label: 'Currency' },
      { key: 'totalDebits', label: 'Debits', align: 'right', render: (a) => money(a.totalDebits, null) },
      { key: 'totalCredits', label: 'Credits', align: 'right', render: (a) => money(a.totalCredits, null) },
      { key: 'balanceNatural', label: 'Balance', align: 'right',
        render: (a) => h('strong', { text: money(a.balanceNatural, a.currency) }) },
      { key: 'isSimulated', label: '', render: (a) => (a.isSimulated ? simulatedChip() : null) },
    ], partnerAccounts, { empty: 'No partner accounts.' })),

    card('FX clearing', h('div', {},
      h('p', { class: 'card-body ledger-explain',
        text:
          'A cross-currency conversion posts two legs through this account: one giving up the ' +
          'source currency, one taking on the target. A balance left here means one half happened ' +
          'and the other did not — an open position somebody has to close.' }),
      table([
        { key: 'code', label: 'Account', className: 'mono' },
        { key: 'currency', label: 'Currency' },
        { key: 'balanceNatural', label: 'Balance', align: 'right',
          render: (a) => money(a.balanceNatural, a.currency) },
        { key: 'entryCount', label: 'Entries', align: 'right' },
      ], clearing, { empty: 'No FX clearing accounts.' }),
    )),

    card('Suspense and differences', h('div', {},
      h('p', { class: 'card-body ledger-explain',
        text:
          'A shortfall is never written off quietly. It is parked here with an owner until somebody ' +
          'explains it, which is why a non-zero balance is a task rather than a note.' }),
      table([
        { key: 'code', label: 'Account', className: 'mono' },
        { key: 'name', label: 'Name' },
        { key: 'currency', label: 'Currency' },
        { key: 'balanceNatural', label: 'Balance', align: 'right',
          render: (a) => money(a.balanceNatural, a.currency) },
      ], suspense, { empty: 'No suspense accounts.' }),
    )),
  );
}

// ---------------------------------------------------------------------------

export async function partnerHealth(ctx) {
  const partners = await get('/api/admin/partners');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Partner health' }),
        h('p', { class: 'page-sub' },
          'Who does what, and what is simulated. ', simulatedChip('No live partner is connected'),
        ),
      ),
    ),

    notice('warning', 'Every partner below is a simulator',
      h('p', {
        text:
          'No agreement with any institution has been confirmed to this build, so no partner name ' +
          'here is a claim of a commercial relationship. Each entry records the role a licensed ' +
          'partner would perform and the adapter that stands in for it.',
      }),
    ),

    ...groupBy(partners, 'partner_role').map(([role, members]) => card(titleCase(role), table([
      { key: 'code', label: 'Code', className: 'mono' },
      { key: 'display_name', label: 'Partner', render: (p) => valueOrPlaceholder(p.display_name) },
      { key: 'live_responsibility', label: 'What they would do live' },
      { key: 'licensed_activity', label: 'Licensed activity',
        render: (p) => (p.licensed_activity
          ? h('span', { class: 'chip chip-info' }, 'Requires a licence')
          : h('span', { class: 'chip chip-neutral' }, 'Not a licensed activity')) },
      { key: 'jurisdiction', label: 'Jurisdiction', render: (p) => valueOrPlaceholder(p.jurisdiction) },
      { key: 'contract_reference', label: 'Contract',
        render: (p) => (p.contract_reference
          ? valueOrPlaceholder(p.contract_reference)
          : h('span', { class: 'chip chip-placeholder' }, 'No confirmed agreement')) },
      { key: 'status', label: 'Status', render: (p) => stateChip(p.status) },
      { key: 'event_count', label: 'Calls', align: 'right' },
      { key: 'failure_count', label: 'Failures', align: 'right',
        render: (p) => (Number(p.failure_count) > 0
          ? h('strong', { style: 'color:var(--danger)', text: p.failure_count })
          : p.failure_count) },
      { key: 'avg_latency_ms', label: 'Average latency', align: 'right',
        render: (p) => (p.avg_latency_ms ? `${p.avg_latency_ms} ms` : '—') },
    ], members))),
  );
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = row[key] ?? 'other';
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return [...map.entries()];
}

// ---------------------------------------------------------------------------

export async function exceptionList(ctx) {
  const openOnly = ctx.query.get('open_only') !== 'false';
  const rows = await get(`/api/exceptions${openOnly ? '?open_only=true' : ''}`);

  const breached = rows.filter((r) => r.breachedSla);

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Exceptions' }),
        h('p', { class: 'page-sub', text: `${rows.length} ${openOnly ? 'open' : 'total'}` }),
      ),
      h('div', { class: 'page-actions' },
        h('button', {
          class: 'btn',
          onclick: () => ctx.navigate(`/ops/exceptions?open_only=${openOnly ? 'false' : 'true'}`),
        }, openOnly ? 'Include closed' : 'Open only'),
      ),
    ),

    breached.length > 0
      ? notice('danger', `${breached.length} past their service target`,
          h('p', {
            text:
              'A breached target is not a reason to close an exception faster. It is a reason to ' +
              'record why it took longer, which the resolution note requires.',
          }))
      : null,

    card(null, table([
      { key: 'reference', label: 'Reference', className: 'mono',
        render: (r) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/ops/exceptions/${r.reference}`) }, r.reference) },
      { key: 'exceptionType', label: 'Type', render: (r) => titleCase(r.exceptionType) },
      { key: 'priority', label: 'Priority', render: (r) => stateChip(r.priority) },
      { key: 'status', label: 'Status', render: (r) => stateChip(r.status) },
      { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount, r.currency) },
      { key: 'transactionReference', label: 'Transaction', className: 'mono' },
      { key: 'ownerName', label: 'Owner', render: (r) => r.ownerName ?? h('span', { class: 'chip chip-warn' }, 'Unassigned') },
      { key: 'ageHours', label: 'Age', align: 'right', render: (r) => `${r.ageHours} h` },
      { key: 'breachedSla', label: 'Target',
        render: (r) => (r.breachedSla
          ? h('span', { class: 'chip chip-danger' }, 'Breached')
          : h('span', { class: 'chip chip-ok' }, 'Within target')) },
    ], rows, { empty: 'No exceptions.' })),
  );
}

// ---------------------------------------------------------------------------

export async function exceptionDetail(ctx) {
  const [exc, me] = await Promise.all([
    get(`/api/exceptions/${encodeURIComponent(ctx.params.reference)}`),
    get('/api/me'),
  ]);

  const canInvestigate = me.permissions.includes('recon.break.investigate');
  const canApprove = me.permissions.includes('recon.break.approve');
  const awaitingApproval = exc.status === 'pending_approval';

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: exc.reference }),
        h('p', { class: 'page-sub' },
          titleCase(exc.exception_type), ' · ', stateChip(exc.status), ' ', stateChip(exc.priority),
        ),
      ),
      h('div', { class: 'page-actions' },
        canInvestigate ? h('button', { class: 'btn', onclick: () => noteDialog(ctx, exc) }, 'Add a note') : null,
        canInvestigate && !awaitingApproval && !exc.resolved_at
          ? h('button', { class: 'btn btn-primary', onclick: () => resolveDialog(ctx, exc) }, 'Propose a resolution')
          : null,
        canApprove && awaitingApproval
          ? h('button', { class: 'btn btn-primary', onclick: () => approveResolution(ctx, exc) }, 'Approve the closure')
          : null,
      ),
    ),

    awaitingApproval
      ? notice('info', 'This resolution is waiting on a second person',
          h('p', {
            text:
              'Above the four-eyes threshold, the person who investigated a break cannot be the ' +
              'person who closes it. The server refuses self-approval regardless of what this ' +
              'screen offers.',
          }))
      : null,

    h('div', { class: 'grid grid-2' },
      card('Exception', h('div', { class: 'card-body' }, keyValues([
        ['Reference', h('span', { class: 'mono-inline', text: exc.reference })],
        ['Type', titleCase(exc.exception_type)],
        ['Status', stateChip(exc.status)],
        ['Priority', stateChip(exc.priority)],
        ['Amount', money(exc.amount, exc.currency)],
        ['Transaction', exc.transaction_reference
          ? h('span', { class: 'mono-inline', text: exc.transaction_reference })
          : '—'],
        ['Customer', exc.organization_name ?? '—'],
        ['Partner', exc.partner_name ? h('span', {}, exc.partner_name, ' ', simulatedChip()) : '—'],
        ['Owner', exc.owner_name ?? h('span', { class: 'chip chip-warn' }, 'Unassigned')],
        ['Opened', dateTime(exc.opened_at)],
        ['Service target', exc.sla_due_at ? dateTime(exc.sla_due_at) : '—'],
        ['Resolved', exc.resolved_at ? dateTime(exc.resolved_at) : '—'],
        ['Resolved by', exc.resolved_by_name ?? '—'],
        ['Approved by', exc.approved_by_name ?? '—'],
      ])), null),

      card('Resolution', h('div', { class: 'card-body' },
        exc.resolution
          ? h('p', { text: exc.resolution })
          : h('div', { class: 'empty', text: 'No resolution has been proposed yet.' }),
      ), null),
    ),

    card('Investigation notes', table([
      { key: 'created_at', label: 'When', render: (n) => dateTime(n.created_at) },
      { key: 'author_name', label: 'Author' },
      { key: 'body', label: 'Note' },
      { key: 'evidence_refs', label: 'Evidence',
        render: (n) => ((n.evidence_refs ?? []).length > 0
          ? h('span', { class: 'mono-inline', text: JSON.stringify(n.evidence_refs) })
          : '—') },
    ], exc.notes, { empty: 'No notes yet. An investigation with no notes is not an investigation.' })),
  );
}

async function noteDialog(ctx, exc) {
  const body = textarea({ placeholder: 'What did you find, and where did you look?' });
  const result = await modal({
    title: `Note on ${exc.reference}`,
    confirmLabel: 'Add the note',
    body: h('div', {},
      h('p', { text: 'Notes are permanent. They cannot be edited or removed once written.' }),
      field('Note', body),
    ),
    onConfirm: async () => {
      await post(`/api/exceptions/${encodeURIComponent(exc.reference)}/note`, { body: body.value.trim() });
      return true;
    },
  });
  if (result) { toast('ok', 'Note added'); ctx.reload(); }
}

async function resolveDialog(ctx, exc) {
  const resolution = textarea({
    placeholder:
      'What happened, what you did about it, and why that is the right answer. Someone reading ' +
      'this a year from now should not need to ask you.',
  });
  const result = await modal({
    title: `Resolve ${exc.reference}`,
    confirmLabel: 'Propose the resolution',
    body: h('div', {},
      h('p', {
        text:
          'Above the four-eyes threshold this proposal does not close the break by itself — it ' +
          'goes to a second person for approval.',
      }),
      field('Resolution', resolution),
    ),
    onConfirm: async () => {
      const outcome = await post(`/api/exceptions/${encodeURIComponent(exc.reference)}/resolve`, {
        resolution: resolution.value.trim(),
      });
      return outcome;
    },
  });
  if (result) {
    toast('ok', result.status === 'pending_approval' ? 'Sent for approval' : 'Break resolved');
    ctx.reload();
  }
}

async function approveResolution(ctx, exc) {
  const result = await modal({
    title: `Approve the closure of ${exc.reference}`,
    confirmLabel: 'Approve',
    body: h('div', {},
      h('p', { text: 'You are confirming that the resolution below explains the break.' }),
      h('p', { class: 'ledger-explain', text: exc.resolution ?? '' }),
      h('p', {
        class: 'footnote',
        text: 'If you proposed this resolution yourself, the server will refuse this approval.',
      }),
    ),
    onConfirm: async () => {
      await post(`/api/exceptions/${encodeURIComponent(exc.reference)}/approve`, {});
      return true;
    },
  });
  if (result) { toast('ok', 'Closure approved'); ctx.reload(); }
}
