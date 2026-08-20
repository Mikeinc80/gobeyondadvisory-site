/**
 * Finance and Reconciliation Console.
 *
 * The ledger is the part of this system that is allowed to be boring. Balances are never
 * stored — they are summed from journal entries every time they are read, so there is no
 * cached figure that can drift away from the entries behind it. Corrections are made by
 * posting a reversal, never by editing an entry, so both the mistake and the correction
 * stay on the record.
 *
 * The trial balance at the top of this console is the single check that catches almost
 * everything: if debits and credits do not net to zero in every currency, something is
 * wrong that no amount of screen design will hide.
 */

import {
  h, get, post, card, stat, table, notice, keyValues, stateChip, simulatedChip,
  money, dateTime, dateOnly, titleCase, toast, reportError, modal, field, input,
  textarea, select,
} from './core.js';

// ---------------------------------------------------------------------------

export async function financeDashboard(ctx) {
  const [tb, runs, me] = await Promise.all([
    get('/api/ledger/trial-balance'),
    get('/api/reconciliation/runs').catch(() => []),
    get('/api/me'),
  ]);

  const integrity = tb.integrity;
  const balanced = integrity.trialBalanceBalanced
    && integrity.unbalancedJournals.length === 0
    && integrity.singleLineJournals.length === 0;

  const latest = runs[0] ?? null;
  const openBreaks = runs.reduce((sum, r) => sum + Number(r.items_broken ?? 0), 0);
  const canRun = me.permissions.includes('recon.run');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Finance and reconciliation' }),
        h('p', { class: 'page-sub' },
          'The ledger, the trial balance and the daily reconciliation. ',
          simulatedChip('Simulated balances'),
        ),
      ),
      h('div', { class: 'page-actions' },
        canRun ? h('button', { class: 'btn btn-primary', onclick: () => runReconciliation(ctx) }, 'Run reconciliation') : null,
        h('button', { class: 'btn', onclick: () => ctx.navigate('/finance/trial-balance') }, 'Trial balance'),
      ),
    ),

    balanced
      ? notice('ok', 'The ledger balances',
          h('p', {
            text:
              `Debits equal credits in every currency across ${integrity.journalCount} journals and ` +
              `${integrity.entryCount} entries. The database refuses an unbalanced journal at commit, ` +
              'so this is a confirmation rather than a discovery.',
          }))
      : notice('danger', 'The ledger does not balance',
          h('p', { text: 'Stop and investigate before relying on any figure in this console.' }),
          integrity.unbalancedJournals.length > 0
            ? h('p', { class: 'mono-inline', text: JSON.stringify(integrity.unbalancedJournals) })
            : null,
          integrity.singleLineJournals.length > 0
            ? h('p', { class: 'mono-inline', text: `Single-line journals: ${integrity.singleLineJournals.join(', ')}` })
            : null,
        ),

    h('div', { class: 'grid grid-4' },
      stat('Journals', String(integrity.journalCount), `${integrity.entryCount} entries`),
      stat('Currencies', String(tb.trial_balance.length), 'Each must net to zero on its own'),
      stat('Reconciliation runs', String(runs.length),
        latest ? `Last run ${dateOnly(latest.business_date)}` : 'Never run'),
      stat('Breaks found', String(openBreaks),
        openBreaks > 0 ? 'Each one is an exception with an owner' : 'Every compared item matched',
        openBreaks > 0 ? 'warn' : null),
    ),

    card('Trial balance', h('div', {},
      h('p', { class: 'card-body ledger-explain', text: tb.note }),
      table([
        { key: 'currency', label: 'Currency' },
        { key: 'totalDebits', label: 'Debits', align: 'right', render: (r) => money(r.totalDebits, null) },
        { key: 'totalCredits', label: 'Credits', align: 'right', render: (r) => money(r.totalCredits, null) },
        { key: 'difference', label: 'Difference', align: 'right',
          render: (r) => h('strong', {
            style: r.balanced ? null : 'color:var(--danger)',
            text: money(r.difference, r.currency),
          }) },
        { key: 'balanced', label: 'Result',
          render: (r) => (r.balanced
            ? h('span', { class: 'chip chip-ok' }, 'Balanced')
            : h('span', { class: 'chip chip-danger' }, 'Out of balance')) },
      ], tb.trial_balance),
    )),

    card('Recent reconciliation runs', table([
      { key: 'reference', label: 'Reference', className: 'mono',
        render: (r) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/finance/reconciliation/${r.reference}`) }, r.reference) },
      { key: 'run_type', label: 'Compares', render: (r) => titleCase(r.run_type) },
      { key: 'business_date', label: 'Business date', render: (r) => dateOnly(r.business_date) },
      { key: 'items_total', label: 'Items', align: 'right' },
      { key: 'items_matched', label: 'Matched', align: 'right' },
      { key: 'items_broken', label: 'Breaks', align: 'right',
        render: (r) => (Number(r.items_broken) > 0
          ? h('strong', { style: 'color:var(--danger)', text: String(r.items_broken) })
          : String(r.items_broken)) },
      { key: 'status', label: 'Status', render: (r) => stateChip(r.status) },
    ], runs.slice(0, 10), { empty: 'Reconciliation has not been run in this environment.' })),
  );
}

async function runReconciliation(ctx) {
  const businessDate = input({ type: 'date', value: new Date().toISOString().slice(0, 10) });
  const result = await modal({
    title: 'Run the daily reconciliation',
    confirmLabel: 'Run it',
    body: h('div', {},
      h('p', {
        text:
          'This compares the transaction record against the ledger, the ledger against each ' +
          'partner statement, funding against settlement, fees, and the currency position. ' +
          'Anything that does not match becomes an exception with an owner.',
      }),
      h('p', {
        class: 'footnote',
        text: 'It writes new records. It never edits or deletes an existing one.',
      }),
      field('Business date', businessDate),
    ),
    onConfirm: async () => post(`/api/reconciliation/run?business_date=${businessDate.value}`, {}),
  });

  if (result) {
    toast(result.allClean ? 'ok' : 'info',
      result.allClean ? 'Everything matched' : `${result.totalBreaks} breaks found`,
      `${result.runs.length} comparisons for ${result.businessDate}.`);
    ctx.reload();
  }
}

// ---------------------------------------------------------------------------

export async function accountList(ctx) {
  const currency = ctx.query.get('currency') ?? '';
  const accounts = await get(`/api/ledger/accounts${currency ? `?currency=${encodeURIComponent(currency)}` : ''}`);
  const currencies = [...new Set(accounts.map((a) => a.currency))];

  const filter = select(
    [{ value: '', label: 'Every currency' },
      ...currencies.map((c) => ({ value: c, label: c, selected: c === currency })),
    ],
    {
      id: 'account-currency',
      onchange: (e) => ctx.navigate(`/finance/accounts${e.target.value ? `?currency=${e.target.value}` : ''}`),
    },
  );

  const byType = new Map();
  for (const account of accounts) {
    if (!byType.has(account.accountType)) byType.set(account.accountType, []);
    byType.get(account.accountType).push(account);
  }

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Ledger accounts' }),
        h('p', { class: 'page-sub', text: `${accounts.length} accounts` }),
      ),
      h('div', { class: 'filters' },
        h('label', { class: 'sr-only', for: 'account-currency' }, 'Currency'), filter),
    ),

    notice('info', 'There is no customer stored-value account here, and that is deliberate',
      h('p', {
        text:
          'EKORails does not hold customer funds, so the chart of accounts gives it nowhere to record ' +
          'holding them. Customer money appears as a receivable owed to a partner or as a balance the ' +
          'partner institution holds — never as an EKORails balance.',
      }),
    ),

    ...[...byType.entries()].map(([type, rows]) => card(`${titleCase(type)} accounts`, table([
      { key: 'code', label: 'Code', className: 'mono' },
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Purpose', render: (a) => titleCase(a.category) },
      { key: 'currency', label: 'Currency' },
      { key: 'normalSide', label: 'Normal side', render: (a) => titleCase(a.normalSide) },
      { key: 'totalDebits', label: 'Debits', align: 'right', render: (a) => money(a.totalDebits, null) },
      { key: 'totalCredits', label: 'Credits', align: 'right', render: (a) => money(a.totalCredits, null) },
      { key: 'balanceNatural', label: 'Balance', align: 'right',
        render: (a) => h('strong', { text: money(a.balanceNatural, a.currency) }) },
      { key: 'entryCount', label: 'Entries', align: 'right' },
      { key: 'isSimulated', label: '', render: (a) => (a.isSimulated ? simulatedChip() : null) },
    ], rows))),

    h('p', { class: 'footnote' },
      'Every balance above is summed from journal entries at the moment you loaded this page. ',
      'No balance is stored anywhere, so none of them can be stale.'),
  );
}

// ---------------------------------------------------------------------------

export async function trialBalanceView(ctx) {
  const tb = await get('/api/ledger/trial-balance');
  const integrity = tb.integrity;

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Trial balance' }),
        h('p', { class: 'page-sub', text: 'Debits and credits, by currency' }),
      ),
    ),

    notice(integrity.trialBalanceBalanced ? 'ok' : 'danger',
      integrity.trialBalanceBalanced ? 'In balance' : 'Out of balance',
      h('p', {
        text:
          'A cross-currency payment is two conversions, not one movement, so each currency has to ' +
          'balance on its own. A journal that mixes currencies still nets to zero within each of ' +
          'them, or the database refuses it at commit time.',
      }),
    ),

    card(null, table([
      { key: 'currency', label: 'Currency' },
      { key: 'totalDebits', label: 'Total debits', align: 'right', render: (r) => money(r.totalDebits, null) },
      { key: 'totalCredits', label: 'Total credits', align: 'right', render: (r) => money(r.totalCredits, null) },
      { key: 'difference', label: 'Difference', align: 'right',
        render: (r) => h('strong', {
          style: r.balanced ? null : 'color:var(--danger)',
          text: money(r.difference, r.currency),
        }) },
      { key: 'balanced', label: 'Result',
        render: (r) => (r.balanced
          ? h('span', { class: 'chip chip-ok' }, 'Balanced')
          : h('span', { class: 'chip chip-danger' }, 'Out of balance')) },
    ], tb.trial_balance)),

    card('Integrity checks', h('div', { class: 'card-body' }, keyValues([
      ['Journals', String(integrity.journalCount)],
      ['Entries', String(integrity.entryCount)],
      ['Trial balance nets to zero',
        integrity.trialBalanceBalanced
          ? h('span', { class: 'chip chip-ok' }, 'Yes')
          : h('span', { class: 'chip chip-danger' }, 'No')],
      ['Unbalanced journals',
        integrity.unbalancedJournals.length === 0
          ? h('span', { class: 'chip chip-ok' }, 'None')
          : h('span', { class: 'mono-inline', text: JSON.stringify(integrity.unbalancedJournals) })],
      ['Single-entry journals',
        integrity.singleLineJournals.length === 0
          ? h('span', { class: 'chip chip-ok' }, 'None')
          : h('span', { class: 'mono-inline', text: integrity.singleLineJournals.join(', ') })],
    ])), null),

    h('p', { class: 'footnote' },
      'These checks are run in SQL against the tables themselves, not against anything the ',
      'application remembers. A bug in the application cannot make them pass.'),
  );
}

// ---------------------------------------------------------------------------

export async function reconciliationRuns(ctx) {
  const [runs, me] = await Promise.all([get('/api/reconciliation/runs'), get('/api/me')]);
  const canRun = me.permissions.includes('recon.run');

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: 'Reconciliation' }),
        h('p', { class: 'page-sub', text: `${runs.length} runs recorded` }),
      ),
      h('div', { class: 'page-actions' },
        canRun ? h('button', { class: 'btn btn-primary', onclick: () => runReconciliation(ctx) }, 'Run reconciliation') : null,
      ),
    ),

    notice('info', 'A difference is never resolved by overwriting one side',
      h('p', {
        text:
          'When the two records disagree, reconciliation opens a break and leaves both records as ' +
          'they are. Somebody then explains the difference, and the explanation is what closes it.',
      }),
    ),

    card(null, table([
      { key: 'reference', label: 'Reference', className: 'mono',
        render: (r) => h('button', { class: 'row-link', onclick: () => ctx.navigate(`/finance/reconciliation/${r.reference}`) }, r.reference) },
      { key: 'run_type', label: 'Compares', render: (r) => titleCase(r.run_type) },
      { key: 'partner_name', label: 'Partner',
        render: (r) => (r.partner_name ? h('span', {}, r.partner_name, ' ', simulatedChip()) : '—') },
      { key: 'business_date', label: 'Business date', render: (r) => dateOnly(r.business_date) },
      { key: 'items_total', label: 'Items', align: 'right' },
      { key: 'items_matched', label: 'Matched', align: 'right' },
      { key: 'items_broken', label: 'Breaks', align: 'right',
        render: (r) => (Number(r.items_broken) > 0
          ? h('strong', { style: 'color:var(--danger)', text: String(r.items_broken) })
          : String(r.items_broken)) },
      { key: 'unexplained_amount', label: 'Unexplained', align: 'right',
        render: (r) => money(r.unexplained_amount, r.currency) },
      { key: 'status', label: 'Status', render: (r) => stateChip(r.status) },
      { key: 'finished_at', label: 'Finished', render: (r) => (r.finished_at ? dateTime(r.finished_at) : '—') },
    ], runs, { empty: 'Reconciliation has not been run.' })),
  );
}

// ---------------------------------------------------------------------------

const RESULT_EXPLANATIONS = {
  matched: 'Both sides agree on the reference and the amount.',
  amount_difference: 'Both sides have the record, but the amounts differ. Somebody has to say which is right and why.',
  missing_partner_record: 'We have a record the partner does not. Either it never reached them, or their file is late.',
  missing_internal_record: 'The partner has a record we do not. This is the more serious direction: money may have moved without us knowing.',
  duplicate: 'The same item appears twice on one side. Treat it as a payment risk until proven otherwise.',
  unmatched: 'Nothing on the other side corresponds to this item.',
};

export async function reconciliationRun(ctx) {
  const run = await get(`/api/reconciliation/runs/${encodeURIComponent(ctx.params.reference)}`);
  const items = run.items ?? [];
  const byResult = new Map();
  for (const item of items) {
    if (!byResult.has(item.result)) byResult.set(item.result, []);
    byResult.get(item.result).push(item);
  }

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: run.reference }),
        h('p', { class: 'page-sub' },
          titleCase(run.run_type), ' · ', dateOnly(run.business_date), ' · ', stateChip(run.status),
        ),
      ),
    ),

    h('div', { class: 'grid grid-4' },
      stat('Items compared', String(run.items_total)),
      stat('Matched', String(run.items_matched)),
      stat('Breaks', String(run.items_broken), 'Each opened as an exception',
        Number(run.items_broken) > 0 ? 'danger' : null),
      stat('Unexplained', money(run.unexplained_amount, run.currency),
        'The amount nobody has yet accounted for'),
    ),

    ...[...byResult.entries()].map(([result, rows]) => card(
      `${titleCase(result)} (${rows.length})`,
      h('div', {},
        h('p', { class: 'card-body ledger-explain',
          text: RESULT_EXPLANATIONS[result] ?? 'No explanation is recorded for this result type.' }),
        table([
          { key: 'internal_ref', label: 'Our reference', className: 'mono' },
          { key: 'internal_kind', label: 'Kind', render: (i) => titleCase(i.internal_kind) },
          { key: 'internal_amount', label: 'Our amount', align: 'right',
            render: (i) => money(i.internal_amount, i.internal_currency) },
          { key: 'external_ref', label: 'Their reference', className: 'mono' },
          { key: 'external_amount', label: 'Their amount', align: 'right',
            render: (i) => money(i.external_amount, i.external_currency) },
          { key: 'difference_amount', label: 'Difference', align: 'right',
            render: (i) => (i.difference_amount
              ? h('strong', { style: 'color:var(--danger)', text: money(i.difference_amount, i.difference_currency) })
              : '—') },
          { key: 'detail', label: 'Detail',
            render: (i) => (i.detail ? h('span', { class: 'mono-inline', text: JSON.stringify(i.detail) }) : '—') },
        ], rows),
      ),
    )),

    items.length === 0
      ? card(null, h('div', { class: 'empty', text: 'This run compared nothing. There was no activity on that business date.' }))
      : null,
  );
}
