/**
 * Business Portal.
 *
 * What a customer sees: their onboarding status, their beneficiaries and documents, the
 * transactions waiting on them, and the full history of any transaction they can reach.
 *
 * Nothing here is visible across organisations. That is enforced by row-level security in
 * the database, not by this file — but this file also never asks for another
 * organisation's data, because a UI that asks and is refused is a UI that will one day
 * ask and be answered.
 */

import {
  h, get, post, put, card, stat, table, notice, keyValues, stateChip, simulatedChip,
  valueOrPlaceholder, money, dateTime, dateOnly, relativeTime, titleCase, toast,
  reportError, modal, field, input, textarea, select, spinner, downloadBlob, api,
} from './core.js';

// ---------------------------------------------------------------------------

export async function businessDashboard(ctx) {
  const [me, requiring, transactions, notifications] = await Promise.all([
    get('/api/me'),
    get('/api/transactions/requiring-action').catch(() => []),
    get('/api/transactions?limit=8'),
    get('/api/notifications').catch(() => []),
  ]);

  const org = me.organization;
  const unread = notifications.filter((n) => n.status !== 'read');

  const completed = transactions.filter((t) => t.state === 'completed').length;
  const inFlight = transactions.filter(
    (t) => !['completed', 'rejected', 'cancelled', 'expired', 'failed', 'returned'].includes(t.state),
  ).length;

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: org.legal_name }),
        h('p', { class: 'page-sub' },
          'Business portal. Onboarding status: ', stateChip(org.onboarding_status),
          org.suspended ? h('span', {}, ' ', stateChip('suspended', 'Suspended')) : null,
        ),
      ),
      org.onboarding_status === 'approved' && !org.suspended
        ? h('div', { class: 'page-actions' },
            h('button', { class: 'btn btn-primary', onclick: () => ctx.navigate('/transactions/new') },
              'New transaction'),
          )
        : null,
    ),

    org.onboarding_status !== 'approved'
      ? notice('warning', 'Onboarding is not complete',
          h('p', {},
            'Your organisation is ', h('strong', { text: titleCase(org.onboarding_status) }),
            '. You cannot initiate transactions until onboarding is approved.'),
          h('p', {},
            h('button', { class: 'btn', onclick: () => ctx.navigate('/onboarding') },
              'Continue onboarding')),
        )
      : null,

    h('div', { class: 'grid grid-4', style: 'margin-bottom:.85rem' },
      stat('Awaiting your action', String(requiring.length), requiring.length > 0 ? 'Review below' : 'Nothing pending',
        requiring.length > 0 ? 'warn' : null),
      stat('In flight', String(inFlight), 'Not yet completed'),
      stat('Completed', String(completed), 'Of the most recent 8'),
      stat('Unread notices', String(unread.length), unread.length ? 'See notifications' : 'All read'),
    ),

    requiring.length > 0
      ? card('Requires your action',
          table([
            { key: 'reference', label: 'Reference', className: 'mono',
              render: (r) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/transactions/${r.id}`) }, r.reference) },
            { key: 'beneficiary_name', label: 'Beneficiary' },
            { key: 'send_amount', label: 'Amount', align: 'right',
              render: (r) => money(r.send_amount, r.send_currency) },
            { key: 'state', label: 'State', render: (r) => stateChip(r.state) },
            { key: 'why', label: 'Why you',
              render: (r) => r.initiated_by_me
                ? h('span', { class: 'chip chip-neutral' }, 'You initiated this')
                : h('span', { class: 'chip chip-warn' }, 'Needs your authorisation') },
            { key: 'created_at', label: 'Created', render: (r) => relativeTime(r.created_at) },
          ], requiring, { empty: 'Nothing is waiting on you.' }),
        )
      : null,

    card('Recent transactions',
      table([
        { key: 'reference', label: 'Reference', className: 'mono',
          render: (r) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/transactions/${r.id}`) }, r.reference) },
        { key: 'beneficiary_name', label: 'Beneficiary' },
        { key: 'send_amount', label: 'Send', align: 'right',
          render: (r) => money(r.send_amount, r.send_currency) },
        { key: 'expected_receive_amount', label: 'Receive', align: 'right',
          render: (r) => money(r.actual_receive_amount ?? r.expected_receive_amount, r.receive_currency) },
        { key: 'state', label: 'State', render: (r) => stateChip(r.state) },
        { key: 'risk_rating', label: 'Risk',
          render: (r) => r.risk_rating ? stateChip(r.risk_rating) : '—' },
        { key: 'created_at', label: 'Created', render: (r) => dateTime(r.created_at) },
      ], transactions, { empty: 'No transactions yet.' }),
      h('button', { class: 'btn btn-sm', onclick: () => ctx.navigate('/transactions') }, 'View all'),
    ),

    notifications.length > 0
      ? card('Notifications',
          table([
            { key: 'subject', label: 'Subject' },
            { key: 'event_type', label: 'Type', render: (n) => titleCase(n.event_type) },
            { key: 'created_at', label: 'When', render: (n) => relativeTime(n.created_at) },
            { key: 'status', label: '', render: (n) => n.status === 'read'
              ? '' : h('span', { class: 'chip chip-info' }, 'New') },
          ], notifications.slice(0, 8)),
        )
      : null,
  );
}

// ---------------------------------------------------------------------------

export async function transactionList(ctx) {
  const stateFilter = ctx.query.get('state') ?? '';
  const rows = await get(`/api/transactions?limit=200${stateFilter ? `&state=${encodeURIComponent(stateFilter)}` : ''}`);
  const me = await get('/api/me');

  const stateSelect = select(
    [{ value: '', label: 'All states' }, ...[
      'draft', 'pending_business_approval', 'pending_compliance', 'compliance_approved',
      'quote_issued', 'awaiting_funding', 'funding_confirmed', 'ready_for_settlement',
      'submitted_to_partner', 'settled', 'beneficiary_confirmed', 'reconciled', 'completed',
      'rejected', 'failed', 'returned', 'under_investigation', 'expired', 'cancelled',
    ].map((s) => ({ value: s, label: titleCase(s), selected: s === stateFilter }))],
    { onchange: (e) => ctx.navigate(`/transactions${e.target.value ? `?state=${e.target.value}` : ''}`) },
  );

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Transactions' }),
        h('p', { class: 'page-sub' },
          `${rows.length} transaction(s)`,
          me.scope === 'global' ? ' across all organisations.' : ' for your organisation.'),
      ),
      me.permissions.includes('txn.initiate')
        ? h('div', { class: 'page-actions' },
            h('button', { class: 'btn btn-primary', onclick: () => ctx.navigate('/transactions/new') }, 'New transaction'))
        : null,
    ),
    h('div', { class: 'filters' }, field('State', stateSelect)),
    card(null, table([
      { key: 'reference', label: 'Reference', className: 'mono',
        render: (r) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/transactions/${r.id}`) }, r.reference) },
      ...(me.scope === 'global' ? [{ key: 'organization_code', label: 'Organisation' }] : []),
      { key: 'beneficiary_name', label: 'Beneficiary' },
      { key: 'send_amount', label: 'Send', align: 'right', render: (r) => money(r.send_amount, r.send_currency) },
      { key: 'receive', label: 'Receive', align: 'right',
        render: (r) => money(r.actual_receive_amount ?? r.expected_receive_amount, r.receive_currency) },
      { key: 'state', label: 'State', render: (r) => stateChip(r.state) },
      { key: 'risk_rating', label: 'Risk', render: (r) => r.risk_rating ? stateChip(r.risk_rating) : '—' },
      { key: 'invoice_number', label: 'Invoice', className: 'mono' },
      { key: 'created_at', label: 'Created', render: (r) => dateTime(r.created_at) },
    ], rows, { empty: 'No transactions match this filter.' })),
  );
}

// ---------------------------------------------------------------------------

export async function transactionDetail(ctx) {
  const data = await get(`/api/transactions/${ctx.params.id}`);
  const me = await get('/api/me');
  const txn = data.transaction;

  const canApprove = me.permissions.includes('txn.approve')
    && txn.state === 'pending_business_approval';
  const canComplianceDecide = me.permissions.includes('compliance.alert.clear')
    && ['pending_compliance', 'under_investigation'].includes(txn.state);
  const canQuote = me.permissions.includes('fx.quote.issue') && txn.state === 'compliance_approved';
  const canTreasury = me.permissions.includes('treasury.settlement.route');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: txn.reference }),
        h('p', { class: 'page-sub' },
          txn.organization_name, ' → ', txn.beneficiary_name, ' · ', stateChip(txn.state),
          ' ', simulatedChip('Simulated settlement'),
        ),
      ),
      h('div', { class: 'page-actions' },
        canApprove ? h('button', { class: 'btn btn-primary',
          onclick: () => approveDialog(ctx, txn) }, 'Authorise') : null,
        canApprove ? h('button', { class: 'btn btn-danger',
          onclick: () => approveDialog(ctx, txn, false) }, 'Decline') : null,
        canComplianceDecide ? h('button', { class: 'btn btn-primary',
          onclick: () => complianceDialog(ctx, txn) }, 'Compliance decision') : null,
        canQuote ? h('button', { class: 'btn btn-primary',
          onclick: () => quoteDialog(ctx, txn) }, 'Issue quote') : null,
        canTreasury ? treasuryActions(ctx, txn) : null,
        h('button', { class: 'btn', onclick: () => ctx.navigate(`/learning/walkthrough/${txn.id}`) },
          'Explain this transaction'),
      ),
    ),

    h('div', { class: 'grid grid-2' },
      card('Transaction', h('div', { class: 'card-body' }, keyValues([
        ['Reference', h('span', { class: 'mono-inline', text: txn.reference })],
        ['State', stateChip(txn.state)],
        ['Send', money(txn.send_amount, txn.send_currency)],
        ['Expected receive', money(txn.expected_receive_amount, txn.receive_currency)],
        ['Actual receive', txn.actual_receive_amount
          ? money(txn.actual_receive_amount, txn.receive_currency)
          : h('span', { class: 'chip chip-neutral' }, 'Not yet settled')],
        ['Corridor', h('span', {}, txn.corridor_code, ' ',
          txn.corridor_is_placeholder ? h('span', { class: 'chip chip-placeholder' }, 'Unconfirmed corridor') : null)],
        ['Purpose', txn.purpose],
        ['Invoice', txn.invoice_number ? h('span', { class: 'mono-inline', text: txn.invoice_number }) : '—'],
        ['Risk outcome', txn.risk_rating ? stateChip(txn.risk_rating) : '—'],
        ['Initiated by', txn.initiated_by_name ?? '—'],
        ['Authorised by', txn.approved_by_name
          ?? h('span', { class: 'chip chip-neutral' }, 'Not yet authorised')],
        ['Created', dateTime(txn.created_at)],
        ['Completed', txn.completed_at ? dateTime(txn.completed_at) : '—'],
      ])), null),

      card('Exceptions',
        data.exceptions.length > 0
          ? table([
              { key: 'reference', label: 'Reference', className: 'mono' },
              { key: 'exception_type', label: 'Type', render: (e) => titleCase(e.exception_type) },
              { key: 'priority', label: 'Priority', render: (e) => stateChip(e.priority) },
              { key: 'amount', label: 'Amount', align: 'right', render: (e) => money(e.amount, e.currency) },
              { key: 'status', label: 'Status', render: (e) => stateChip(e.status) },
            ], data.exceptions)
          : h('div', { class: 'empty', text: 'No exceptions raised against this transaction.' }),
      ),
    ),

    h('div', { class: 'grid grid-2', style: 'margin-top:.85rem' },
      card('Lifecycle', h('div', { class: 'card-body' },
        h('div', { class: 'timeline' }, data.transitions.map((t) => h('div', { class: 'tl-step' },
          h('div', { class: `tl-dot ${toneForState(t.to_state)}`, text: '' }),
          h('div', {},
            h('div', { class: 'tl-title', text: titleCase(t.to_state) }),
            h('div', { class: 'tl-meta' },
              dateTime(t.occurred_at), ' · ',
              t.actor_name ?? t.partner_name ?? titleCase(t.actor_type),
              t.actor_role ? ` (${titleCase(t.actor_role)})` : '',
            ),
            h('div', { class: 'tl-reason', text: t.reason }),
            t.journal_reference
              ? h('div', { class: 'tl-explain' },
                  h('dl', {},
                    h('dt', { text: `Ledger journal ${t.journal_reference}` }),
                    h('dd', { text: t.journal_explanation ?? '' }),
                  ))
              : null,
          ),
        ))),
      ), null),

      card('Ledger', h('div', { class: 'card-body' },
        data.journals.length === 0
          ? h('div', { class: 'empty', text: 'No ledger entries yet. Nothing is owed until a quote is accepted.' })
          : h('div', {}, data.journals.map((j) => h('details', { class: 'disclose' },
              h('summary', {},
                h('span', { class: 'mono-inline', text: j.reference }), ' ',
                titleCase(j.journal_type), ' ',
                j.posting_status === 'reversed' ? stateChip('reversed', 'Reversed') : null,
              ),
              h('div', {},
                h('p', { class: 'ledger-explain', text: j.plain_english }),
                h('div', {}, j.entries.map((e) => h('div', { class: 'ledger-entry' },
                  h('span', { class: `dir dir-${e.direction}`, text: e.direction }),
                  h('div', {},
                    h('div', { class: 'ledger-account', text: e.account_name }),
                    h('div', { class: 'ledger-explain', text: e.narrative }),
                  ),
                  h('span', { class: 'ledger-amount', text: money(e.amount, e.currency) }),
                ))),
              ),
            ))),
      ), null),
    ),

    h('div', { class: 'grid grid-2', style: 'margin-top:.85rem' },
      card('Partner interactions',
        table([
          { key: 'operation', label: 'Operation' },
          { key: 'direction', label: 'Direction' },
          { key: 'outcome', label: 'Outcome', render: (e) => stateChip(e.outcome) },
          { key: 'simulation_scenario', label: 'Scenario',
            render: (e) => e.simulation_scenario ? simulatedChip(titleCase(e.simulation_scenario)) : simulatedChip() },
          { key: 'latency_ms', label: 'Latency', align: 'right',
            render: (e) => e.latency_ms ? `${e.latency_ms} ms` : '—' },
          { key: 'occurred_at', label: 'When', render: (e) => dateTime(e.occurred_at) },
        ], data.integration_events, { empty: 'No partner calls yet.' }),
      ),

      card('Audit trail',
        table([
          { key: 'seq', label: 'Seq', className: 'mono' },
          { key: 'category', label: 'Category', render: (a) => titleCase(a.category) },
          { key: 'action', label: 'Action', className: 'mono' },
          { key: 'outcome', label: 'Outcome', render: (a) => stateChip(a.outcome) },
          { key: 'actor_role', label: 'Role', render: (a) => a.actor_role ? titleCase(a.actor_role) : '—' },
          { key: 'occurred_at', label: 'When', render: (a) => dateTime(a.occurred_at) },
        ], data.audit_events, { empty: 'No audit events.' }),
      ),
    ),
  );
}

function toneForState(state) {
  if (['completed', 'settled', 'reconciled', 'beneficiary_confirmed', 'compliance_approved'].includes(state)) return 'is-ok';
  if (['failed', 'rejected', 'returned', 'cancelled'].includes(state)) return 'is-danger';
  if (['under_investigation', 'expired', 'additional_information_required'].includes(state)) return 'is-warn';
  return '';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function approveDialog(ctx, txn, approve = true) {
  const reason = textarea({
    placeholder: approve
      ? 'What did you check before authorising this? For example: matched against the purchase order and the supplier statement.'
      : 'Why are you declining this?',
  });

  const result = await modal({
    title: approve ? `Authorise ${txn.reference}` : `Decline ${txn.reference}`,
    tone: approve ? 'primary' : 'danger',
    confirmLabel: approve ? 'Authorise' : 'Decline',
    body: h('div', {},
      notice('info', null,
        h('p', {},
          'You are providing the SECOND authorisation. ',
          h('strong', { text: 'The person who created this transaction cannot be the person who authorises it.' }),
          ' If that is you, this will be refused.'),
      ),
      keyValues([
        ['Beneficiary', txn.beneficiary_name],
        ['Amount', money(txn.send_amount, txn.send_currency)],
        ['Purpose', txn.purpose],
        ['Initiated by', txn.initiated_by_name ?? '—'],
      ]),
      h('div', { style: 'margin-top:.85rem' }, field('Reason (recorded permanently)', reason)),
    ),
    onConfirm: async () => {
      await post(`/api/transactions/${txn.id}/approve`, {
        approve, reason: reason.value.trim() || (approve ? 'Authorised.' : 'Declined.'),
      });
      return true;
    },
  });

  if (result) {
    toast('ok', approve ? 'Transaction authorised' : 'Transaction declined',
      approve ? 'It has moved to compliance review.' : 'The reason has been recorded.');
    ctx.reload();
  }
}

async function complianceDialog(ctx, txn) {
  const decision = select([
    { value: 'approve', label: 'Approve — clear to proceed' },
    { value: 'request_information', label: 'Request more information from the customer' },
    { value: 'suspend', label: 'Suspend pending investigation' },
    { value: 'reject', label: 'Reject' },
  ]);
  const reason = textarea({
    placeholder:
      'At least 20 characters. State what you reviewed and why you reached this decision. ' +
      'This is written to an append-only table and cannot be edited afterwards.',
  });

  const result = await modal({
    title: `Compliance decision — ${txn.reference}`,
    confirmLabel: 'Record decision',
    body: h('div', {},
      notice('warning', null,
        h('p', { text: 'This decision is permanent. It cannot be edited or deleted, by anyone, including an administrator.' })),
      field('Decision', decision),
      field('Written reason', reason, 'Minimum 20 characters. "Looks fine" is not a reason.'),
    ),
    onConfirm: async () => {
      if (reason.value.trim().length < 20) {
        throw new Error('A written reason of at least 20 characters is required.');
      }
      await post(`/api/transactions/${txn.id}/compliance-decision`, {
        decision: decision.value, reason: reason.value.trim(),
      });
      return true;
    },
  });

  if (result) { toast('ok', 'Decision recorded', 'It is now part of the permanent record.'); ctx.reload(); }
}

async function quoteDialog(ctx, txn) {
  const providerRate = input({ class: 'mono', placeholder: '0.000618000000', value: '0.000618000000' });
  const referenceRate = input({ class: 'mono', placeholder: '0.000625000000', value: '0.000625000000' });
  const source = select([
    { value: 'mock_liquidity_provider', label: 'Mock liquidity provider (simulated)' },
    { value: 'manual_treasury_entry', label: 'Manually entered by treasury' },
    { value: 'test_market_data_provider', label: 'Test market-data provider' },
  ]);

  const result = await modal({
    title: `Issue quote — ${txn.reference}`,
    confirmLabel: 'Issue quote',
    body: h('div', {},
      notice('warning', 'This rate is simulated',
        h('p', { text:
          'No institution is offering this rate and it is not a market observation. The quote will be ' +
          'labelled as simulated and can never be marked as contractually locked.' })),
      keyValues([
        ['Send', money(txn.send_amount, txn.send_currency)],
        ['Receive currency', txn.receive_currency],
      ]),
      h('div', { style: 'margin-top:.85rem' },
        field('Reference (mid-market) rate', referenceRate, 'What the market is observed at. Used to compute the spread.'),
        field('Provider rate', providerRate, 'What the liquidity source is offering. The difference is the spread.'),
        field('Rate source', source),
      ),
    ),
    onConfirm: async () => {
      const quote = await post(`/api/transactions/${txn.id}/quote`, {
        provider_rate: providerRate.value.trim(),
        reference_rate: referenceRate.value.trim(),
        quote_source: source.value,
        validity_seconds: 3600,
      });
      return quote;
    },
  });

  if (result) {
    toast('ok', `Quote ${result.reference} issued`,
      `${result.rateLabel}. Spread ${result.spreadBps} bps.`);
    ctx.reload();
  }
}

function treasuryActions(ctx, txn) {
  const steps = [
    { state: 'awaiting_funding', label: 'Confirm funding', path: 'funding/confirm' },
    { state: 'funding_confirmed', label: 'Prepare settlement', path: 'settlement/prepare' },
    { state: 'ready_for_settlement', label: 'Submit to partner', path: 'settlement/submit' },
    { state: 'reconciled', label: 'Complete', path: 'complete' },
  ];
  const step = steps.find((s) => s.state === txn.state);
  if (!step) return null;

  return h('button', {
    class: 'btn btn-primary',
    onclick: async () => {
      try {
        const result = await post(`/api/transactions/${txn.id}/${step.path}`);
        const outcome = result?.outcome ?? result?.transition ?? result;
        toast('ok', step.label + ' done',
          result?.finalState ? `Now: ${titleCase(result.finalState)}` : 'Step complete.');
        if (result?.exceptionReference) {
          toast('error', 'An exception was raised', result.exceptionReference);
        }
        ctx.reload();
      } catch (error) { reportError(error); }
    },
  }, step.label);
}

// ---------------------------------------------------------------------------

export async function newTransaction(ctx) {
  const [me, beneficiaries, admin] = await Promise.all([
    get('/api/me'),
    get('/api/beneficiaries'),
    get('/api/admin/configuration').catch(() => null),
  ]);

  const approved = beneficiaries.filter((b) => b.status === 'approved' && !b.requires_rereview);

  if (approved.length === 0) {
    return h('div', {},
      h('h1', { class: 'page-title', text: 'New transaction' }),
      notice('warning', 'No approved beneficiary',
        h('p', { text:
          'A beneficiary must be reviewed and approved by compliance before it can be paid. ' +
          'This is the control that stops a substituted beneficiary being paid without anyone looking.' }),
        h('p', {}, h('button', { class: 'btn', onclick: () => ctx.navigate('/beneficiaries') }, 'Manage beneficiaries')),
      ),
    );
  }

  const beneficiary = select(approved.map((b) => ({
    value: b.id, label: `${b.legal_name} — ${b.institution_name} ****${b.identifier_last4} (${b.currency})`,
  })));
  const amount = input({ class: 'mono', placeholder: '5000000.000000' });
  const purpose = input({ placeholder: 'Settlement of supplier invoice for goods received' });
  const invoiceNumber = input({ class: 'mono', placeholder: 'INV-2026-0001' });
  const sourceOfFunds = textarea({
    placeholder:
      'Where did these funds come from? At least 20 characters, and be specific: this is a ' +
      'due-diligence requirement, not a formality.',
  });

  const corridor = admin?.corridors?.[0];
  const errorBox = h('div', { class: 'form-error' });

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      errorBox.textContent = '';
      try {
        const created = await post('/api/transactions', {
          beneficiary_id: beneficiary.value,
          corridor_id: corridor?.id ?? ctx.state.corridorId,
          send_amount: amount.value.trim(),
          send_currency: corridor?.origin_currency ?? 'NGN',
          receive_currency: corridor?.destination_currency ?? 'USD',
          purpose: purpose.value.trim(),
          source_of_funds: sourceOfFunds.value.trim(),
          invoice_number: invoiceNumber.value.trim() || null,
        });
        toast('ok', `Created ${created.reference}`, 'Submit it for authorisation when ready.');
        ctx.navigate(`/transactions/${created.id}`);
      } catch (error) {
        errorBox.textContent = error.message + (error.details?.failures ? ` (${error.details.failures.join('; ')})` : '');
        reportError(error);
      }
    },
  },
    field('Beneficiary', beneficiary, 'Only approved beneficiaries can be paid.'),
    field('Amount to send', amount,
      `In ${corridor?.origin_currency ?? 'the corridor currency'}. Use a decimal string, for example 5000000.00`),
    field('Purpose', purpose),
    field('Invoice number', invoiceNumber,
      'Used to detect a duplicate payment against the same invoice, beneficiary and amount.'),
    field('Source of funds', sourceOfFunds, 'Minimum 20 characters.'),
    errorBox,
    h('div', { class: 'page-actions', style: 'margin-top:1rem' },
      h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create draft'),
      h('button', { class: 'btn', type: 'button', onclick: () => ctx.navigate('/transactions') }, 'Cancel'),
    ),
  );

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'New transaction' }),
        h('p', { class: 'page-sub', text:
          'Creating a draft does not send anything. It must then be authorised by a different person ' +
          'and cleared by compliance before a price is even quoted.' }),
      ),
    ),
    corridor?.is_placeholder
      ? notice('warning', 'The pilot corridor is not yet confirmed',
          h('p', {},
            'This corridor is running on placeholder values (',
            h('span', { class: 'mono-inline', text: corridor.origin_country }), ' → ',
            h('span', { class: 'mono-inline', text: corridor.destination_country }),
            ') because the regulatory filing has not been supplied. Every transaction will therefore ',
            h('strong', { text: 'require manual compliance review' }), ' — none can clear automatically.'))
      : null,
    h('div', { style: 'max-width:640px' }, card(null, h('div', { class: 'card-body' }, form))),
  );
}

// ---------------------------------------------------------------------------

export async function beneficiaryList(ctx) {
  const [me, rows] = await Promise.all([get('/api/me'), get('/api/beneficiaries')]);
  const canAdd = me.permissions.includes('beneficiary.write');
  const canReview = me.permissions.includes('beneficiary.review');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Beneficiaries' }),
        h('p', { class: 'page-sub', text:
          'A beneficiary must be reviewed and approved before its first payment. Changing a material ' +
          'detail — the name, the bank or the account — automatically clears that approval and sends ' +
          'it back for review.' }),
      ),
      canAdd ? h('div', { class: 'page-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => addBeneficiaryDialog(ctx) }, 'Add beneficiary')) : null,
    ),
    card(null, table([
      { key: 'legal_name', label: 'Legal name' },
      { key: 'country', label: 'Country' },
      { key: 'institution_name', label: 'Institution' },
      { key: 'identifier_last4', label: 'Account', className: 'mono',
        render: (b) => `****${b.identifier_last4}` },
      { key: 'currency', label: 'Currency' },
      { key: 'status', label: 'Status',
        render: (b) => h('span', {}, stateChip(b.status),
          b.requires_rereview ? h('span', {}, ' ', stateChip('additional_information_required', 'Re-review needed')) : null) },
      { key: 'relationship_to_sender', label: 'Relationship' },
      { key: 'approved_at', label: 'Approved', render: (b) => b.approved_at ? dateOnly(b.approved_at) : '—' },
      ...(canReview ? [{ key: 'actions', label: '', render: (b) =>
        b.status === 'pending_review' || b.requires_rereview
          ? h('button', { class: 'btn btn-sm', onclick: () => reviewBeneficiaryDialog(ctx, b) }, 'Review')
          : '' }] : []),
    ], rows, { empty: 'No beneficiaries yet.' })),
  );
}

async function addBeneficiaryDialog(ctx) {
  const legalName = input({ placeholder: 'Rotterdam Commodity Partners BV' });
  const country = input({ placeholder: 'NL', maxlength: 2, class: 'mono' });
  const registration = input({ placeholder: 'Registration number (optional)' });
  const institution = input({ placeholder: 'Beneficiary bank name' });
  const institutionCountry = input({ placeholder: 'NL', maxlength: 2, class: 'mono' });
  const swift = input({ placeholder: 'DEMONL2AXXX', class: 'mono' });
  const identifier = input({ placeholder: 'Account identifier / IBAN', class: 'mono' });
  const currency = input({ placeholder: 'USD', maxlength: 3, class: 'mono', value: 'USD' });
  const scheme = select([
    { value: 'iban', label: 'IBAN' }, { value: 'nuban', label: 'NUBAN' },
    { value: 'account_number', label: 'Account number' },
    { value: 'sort_code_account', label: 'Sort code and account' },
    { value: 'other', label: 'Other' },
  ]);
  const purpose = input({ placeholder: 'Payment for goods under supply agreement' });
  const relationship = input({ placeholder: 'Overseas supplier since 2023' });

  const result = await modal({
    title: 'Add beneficiary',
    confirmLabel: 'Add and screen',
    body: h('div', {},
      notice('info', null, h('p', { text:
        'The account identifier is encrypted before it is stored. Only the last four digits are ever ' +
        'displayed, and the full number never appears in a log, an export or a notification.' })),
      field('Legal name', legalName),
      field('Country', country, 'Two-letter code.'),
      field('Registration number', registration),
      field('Bank / institution', institution),
      field('Institution country', institutionCountry),
      field('SWIFT / BIC', swift),
      field('Identifier scheme', scheme),
      field('Account identifier', identifier),
      field('Currency', currency),
      field('Payment purpose', purpose),
      field('Relationship to your business', relationship),
    ),
    onConfirm: async () => post('/api/beneficiaries', {
      legal_name: legalName.value.trim(),
      registration_number: registration.value.trim() || null,
      country: country.value.trim().toUpperCase(),
      address: { country: country.value.trim().toUpperCase() },
      payment_purpose: purpose.value.trim(),
      relationship_to_sender: relationship.value.trim(),
      bank: {
        account_holder_name: legalName.value.trim(),
        institution_name: institution.value.trim(),
        institution_country: institutionCountry.value.trim().toUpperCase(),
        swift_bic: swift.value.trim().toUpperCase() || null,
        identifier_scheme: scheme.value,
        identifier: identifier.value.trim(),
        currency: currency.value.trim().toUpperCase(),
      },
    }),
  });

  if (result) {
    toast('ok', `Beneficiary ${result.displayCode} added`,
      'Screening has run. It cannot be paid until compliance approves it.');
    ctx.reload();
  }
}

async function reviewBeneficiaryDialog(ctx, beneficiary) {
  const decision = select([
    { value: 'approve', label: 'Approve' },
    { value: 'request_information', label: 'Request more information' },
    { value: 'reject', label: 'Reject' },
  ]);
  const reason = textarea({ placeholder: 'What did you verify, and through what channel?' });

  const result = await modal({
    title: `Review ${beneficiary.legal_name}`,
    confirmLabel: 'Record decision',
    body: h('div', {},
      beneficiary.requires_rereview
        ? notice('warning', 'Re-review required',
            h('p', { text: beneficiary.rereview_reason ?? 'Material details changed after approval.' }))
        : null,
      keyValues([
        ['Legal name', beneficiary.legal_name],
        ['Country', beneficiary.country],
        ['Institution', beneficiary.institution_name],
        ['Account', `****${beneficiary.identifier_last4}`],
        ['SWIFT / BIC', beneficiary.swift_bic ?? '—'],
        ['Relationship', beneficiary.relationship_to_sender],
        ['Account verification', stateChip(beneficiary.account_verification)],
      ]),
      h('div', { style: 'margin-top:.85rem' },
        field('Decision', decision),
        field('Reason', reason, 'Minimum 10 characters. Recorded permanently.'),
      ),
    ),
    onConfirm: async () => post(`/api/beneficiaries/${beneficiary.id}/review`, {
      decision: decision.value, reason: reason.value.trim(),
    }),
  });

  if (result) { toast('ok', 'Beneficiary decision recorded'); ctx.reload(); }
}

// ---------------------------------------------------------------------------

export async function documentList(ctx) {
  const rows = await get('/api/documents');
  const me = await get('/api/me');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Documents' }),
        h('p', { class: 'page-sub', text:
          'Every document is hashed on upload so it can be proved unchanged, and every download link ' +
          'is short-lived and recorded against the person who requested it.' }),
      ),
    ),
    card(null, table([
      { key: 'document_type', label: 'Type', render: (d) => titleCase(d.document_type) },
      { key: 'original_filename', label: 'File', className: 'mono' },
      { key: 'version', label: 'Ver', align: 'right' },
      { key: 'malware_scan_status', label: 'Scan', render: (d) => stateChip(d.malware_scan_status) },
      { key: 'content_sha256', label: 'Content hash', className: 'mono',
        render: (d) => h('span', { title: d.content_sha256 }, d.content_sha256.slice(0, 12) + '…') },
      { key: 'expires_on', label: 'Expires',
        render: (d) => d.expires_on
          ? h('span', {}, dateOnly(d.expires_on), ' ',
              d.expired ? stateChip('expired', 'Expired')
                : d.expiring_soon ? stateChip('medium', 'Expiring') : null)
          : '—' },
      { key: 'classification', label: 'Classification', render: (d) => titleCase(d.classification) },
      { key: 'created_at', label: 'Uploaded', render: (d) => dateOnly(d.created_at) },
      { key: 'actions', label: '', render: (d) => h('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          try {
            const link = await post(`/api/documents/${d.id}/download-url`, { reason: 'Reviewed in console' });
            toast('info', 'Signed link minted',
              `Valid until ${dateTime(link.expiresAt)}. This access has been recorded.`);
          } catch (error) { reportError(error); }
        },
      }, 'Get link') },
    ], rows, { empty: 'No documents uploaded.' })),
    notice('info', 'A note on document scanning',
      h('p', { text:
        'Uploads are checked for type, structure and active content, and the EICAR test signature is ' +
        'detected. That is NOT a full antivirus scan. Connecting a real scanning service is a named ' +
        'gap in the pilot readiness report (risk R-12).' })),
  );
}

// ---------------------------------------------------------------------------

export async function onboarding(ctx) {
  const data = await get('/api/onboarding');
  const me = await get('/api/me');
  const org = data.organization;
  const canEdit = me.permissions.includes('org.profile.write')
    && ['draft', 'additional_information_required'].includes(org.onboarding_status);

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Onboarding' }),
        h('p', { class: 'page-sub' }, 'Status: ', stateChip(org.onboarding_status)),
      ),
      canEdit && data.profile
        ? h('div', { class: 'page-actions' },
            h('button', { class: 'btn btn-primary', onclick: () => submitKyb(ctx) }, 'Submit for review'))
        : null,
    ),

    h('div', { class: 'grid grid-2' },
      card('Workflow', h('div', { class: 'card-body' },
        h('div', { class: 'timeline' }, data.workflow_statuses.map((status) => {
          const reached = data.workflow_statuses.indexOf(org.onboarding_status) >= data.workflow_statuses.indexOf(status);
          const current = status === org.onboarding_status;
          return h('div', { class: 'tl-step' },
            h('div', { class: `tl-dot ${current ? 'is-warn' : reached ? 'is-ok' : ''}` }),
            h('div', {},
              h('div', { class: 'tl-title', text: titleCase(status) }),
              current ? h('div', { class: 'tl-meta', text: 'Current status' }) : null,
            ),
          );
        })),
      ), null),

      card('Business profile', h('div', { class: 'card-body' },
        data.profile
          ? keyValues([
              ['Legal name', data.profile.legal_business_name],
              ['Trading name', data.profile.trading_name ?? '—'],
              ['Registration number', h('span', { class: 'mono-inline', text: data.profile.registration_number })],
              ['Jurisdiction', data.profile.jurisdiction],
              ['Incorporated', dateOnly(data.profile.date_of_incorporation)],
              ['Business activity', data.profile.business_activity],
              ['Industry', titleCase(data.profile.industry_code)],
              ['Expected monthly volume', money(data.profile.expected_monthly_volume, data.profile.expected_monthly_currency)],
              ['Expected transaction size', money(data.profile.expected_transaction_size, data.profile.expected_txn_currency)],
              ['Source of funds', data.profile.source_of_funds],
              ['Purpose of transactions', data.profile.purpose_of_transactions],
              ['Submitted', data.profile.submitted_at ? dateTime(data.profile.submitted_at) : 'Not yet submitted'],
              ['Profile version', String(data.profile.version)],
            ])
          : h('div', { class: 'empty', text: 'No profile yet.' }),
      ), null),
    ),

    h('div', { class: 'grid grid-2', style: 'margin-top:.85rem' },
      card('Directors and beneficial owners',
        h('div', {},
          table([
            { key: 'full_name', label: 'Name' },
            { key: 'capacities', label: 'Capacity', render: (p) =>
              h('span', {}, (p.capacities ?? []).map((c) =>
                h('span', {}, h('span', { class: 'chip chip-neutral' },
                  titleCase(c.capacity) + (c.ownership_percent ? ` ${c.ownership_percent}%` : '')), ' '))) },
            { key: 'nationality', label: 'Nationality' },
            { key: 'is_pep', label: 'PEP', render: (p) => p.is_pep
              ? stateChip('medium', 'Declared PEP') : h('span', { class: 'chip chip-neutral' }, 'No') },
            { key: 'verification_status', label: 'Verification', render: (p) => stateChip(p.verification_status) },
            { key: 'id_number_last4', label: 'ID', className: 'mono',
              render: (p) => p.id_number_last4 ? `****${p.id_number_last4}` : '—' },
          ], data.people, { empty: 'No people registered.' }),
          h('div', { class: 'card-body' },
            notice(data.ownership_coverage.complete ? 'ok' : 'warning', null,
              h('p', { text: data.ownership_coverage.note })),
          ),
        ),
      ),

      card('Documents',
        table([
          { key: 'document_type', label: 'Type', render: (d) => titleCase(d.document_type) },
          { key: 'malware_scan_status', label: 'Scan', render: (d) => stateChip(d.malware_scan_status) },
          { key: 'expires_on', label: 'Expires', render: (d) => d.expires_on ? dateOnly(d.expires_on) : '—' },
        ], data.documents, { empty: 'No documents uploaded.' }),
      ),
    ),
  );
}

async function submitKyb(ctx) {
  const result = await modal({
    title: 'Submit for compliance review',
    confirmLabel: 'Submit',
    body: h('div', {},
      h('p', { text:
        'Submitting runs sanctions, PEP and adverse-media screening against your company and every ' +
        'registered director and beneficial owner, and places the case in the compliance queue.' }),
      h('p', { text:
        'After submission the profile is versioned rather than edited, so the analyst\'s view of what ' +
        'they approved stays intact.' }),
    ),
    onConfirm: () => post('/api/onboarding/submit'),
  });
  if (result) {
    toast('ok', 'Submitted for review', `${result.screeningCases.length} screening case(s) opened.`);
    ctx.reload();
  }
}

// ---------------------------------------------------------------------------

export async function supportCases(ctx) {
  const [me, rows] = await Promise.all([get('/api/me'), get('/api/support-cases')]);

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Support and complaints' }),
        h('p', { class: 'page-sub', text: 'Cases carry a service-level timer and a named owner.' }),
      ),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => raiseCaseDialog(ctx) }, 'Raise a case')),
    ),
    card(null, table([
      { key: 'reference', label: 'Reference', className: 'mono' },
      { key: 'category', label: 'Category', render: (c) => titleCase(c.category) },
      { key: 'subject', label: 'Subject' },
      { key: 'priority', label: 'Priority', render: (c) => stateChip(c.priority) },
      { key: 'status', label: 'Status', render: (c) => stateChip(c.status) },
      { key: 'owner_name', label: 'Owner', render: (c) => c.owner_name ?? 'Unassigned' },
      { key: 'sla', label: 'SLA', render: (c) => c.breached_sla
        ? stateChip('critical', 'Breached') : h('span', { class: 'chip chip-ok' }, 'Within target') },
      { key: 'opened_at', label: 'Opened', render: (c) => relativeTime(c.opened_at) },
    ], rows, { empty: 'No cases.' })),
  );
}

async function raiseCaseDialog(ctx) {
  const category = select([
    { value: 'customer_support', label: 'Customer support' },
    { value: 'complaint', label: 'Complaint' },
    { value: 'transaction_investigation', label: 'Transaction investigation' },
    { value: 'data_access_request', label: 'Data access request' },
  ]);
  const priority = select([
    { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' },
    { value: 'low', label: 'Low' }, { value: 'critical', label: 'Critical' },
  ]);
  const subject = input({ placeholder: 'Short summary' });
  const description = textarea({ placeholder: 'What happened, and what outcome are you looking for?' });

  const result = await modal({
    title: 'Raise a case', confirmLabel: 'Raise case',
    body: h('div', {},
      field('Category', category), field('Priority', priority),
      field('Subject', subject), field('Description', description)),
    onConfirm: () => post('/api/support-cases', {
      category: category.value, priority: priority.value,
      subject: subject.value.trim(), description: description.value.trim(),
    }),
  });

  if (result) { toast('ok', `Case ${result.reference} raised`); ctx.reload(); }
}

// ---------------------------------------------------------------------------

export async function reportsPage(ctx) {
  const definitions = await get('/api/reports');
  const state = { active: definitions[0]?.key ?? null, data: null };

  const body = h('div', {});

  async function load(key) {
    state.active = key;
    mountInto(body, spinner());
    try {
      const data = await get(`/api/reports/${key}?format=json`);
      state.data = data;
      mountInto(body, renderReport(data, key));
    } catch (error) {
      reportError(error);
      mountInto(body, notice('danger', 'Could not load report', error.message));
    }
  }

  function mountInto(node, child) {
    while (node.firstChild) node.removeChild(node.firstChild);
    node.append(child);
  }

  function renderReport(data, key) {
    return h('div', {},
      h('div', { class: 'page-actions', style: 'margin-bottom:.75rem' },
        ...['csv', 'xlsx', 'pdf'].map((format) => h('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            try {
              const result = await api(`/api/reports/${key}?format=${format}`);
              downloadBlob(result.blob, `${key}-${new Date().toISOString().slice(0, 10)}.${format}`);
              toast('ok', `${format.toUpperCase()} exported`,
                'The export is recorded with a content hash and the masking profile that produced it.');
            } catch (error) { reportError(error); }
          },
        }, `Export ${format.toUpperCase()}`)),
        h('span', { class: 'chip chip-neutral' }, `Masking: ${data.masking_profile}`),
      ),
      data.summary ? card('Summary', h('div', { class: 'card-body' },
        h('pre', { text: JSON.stringify(data.summary, null, 2) }))) : null,
      h('div', { style: 'margin-top:.85rem' },
        card(`${data.title} — ${data.rows.length} row(s)`,
          table(data.columns.map((c) => ({
            key: c, label: titleCase(c),
            align: /amount|value|count|total|rate|percent|fee|balance|debits|credits/.test(c) ? 'right' : null,
            render: (row) => formatCell(c, row[c]),
          })), data.rows, { empty: 'No rows for this period.' }))),
    );
  }

  function formatCell(column, value) {
    if (value === null || value === undefined) return '—';
    if (/_at$|^generated/.test(column)) return dateTime(value);
    if (/^is_|_simulated$/.test(column)) return value === true || value === 'true'
      ? simulatedChip('Yes') : h('span', { class: 'chip chip-neutral' }, 'No');
    if (/state|status|rating|result|outcome|priority/.test(column) && typeof value === 'string') {
      return stateChip(value);
    }
    if (/amount|value|total|balance|debits|credits|fee/.test(column) && /^-?\d+(\.\d+)?$/.test(String(value))) {
      return money(value, null);
    }
    return String(value);
  }

  await load(state.active);

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Reports' }),
        h('p', { class: 'page-sub', text:
          'The same report shows different detail depending on your role, and every export is recorded ' +
          'with a hash of exactly what was produced.' }),
      ),
    ),
    h('div', { class: 'tabs', role: 'tablist' }, definitions.map((d) =>
      h('button', {
        class: 'tab', role: 'tab', type: 'button',
        'aria-selected': String(d.key === state.active),
        onclick: (event) => {
          for (const tab of event.target.parentElement.children) tab.setAttribute('aria-selected', 'false');
          event.target.setAttribute('aria-selected', 'true');
          load(d.key);
        },
      }, d.title))),
    body,
  );
}
