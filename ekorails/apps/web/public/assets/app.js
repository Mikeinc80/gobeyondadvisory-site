/**
 * Application shell: authentication, navigation and routing.
 *
 * Three properties this file is responsible for:
 *
 *  1. **Six consoles, not one screen with six modes.** Navigation is built from the
 *     permissions the server reports, and a role only ever sees the console it works in.
 *     A business user never renders a compliance queue, because the queue is not in their
 *     navigation and the route refuses them if they type the URL.
 *
 *  2. **The client never decides who you are.** Everything here reads `/api/me`. Hiding a
 *     menu item is a courtesy, not a control — every route this file guards is guarded
 *     again by the API, and again by row-level security in the database.
 *
 *  3. **The banner is verified, not asserted.** After every render the client checks that
 *     the environment shown on screen is the one the server reports, and blocks the page
 *     if they disagree.
 */

import {
  h, mount, clear, get, post, api, ApiError, card, notice, spinner, toast, reportError,
  modal, field, input, titleCase, verifyBannerIntegrity, setStepUpHandler, setPermissions,
  table, stateChip, relativeTime,
} from './core.js';

import * as business from './views-business.js';
import * as operations from './views-operations.js';
import * as compliance from './views-compliance.js';
import * as finance from './views-finance.js';
import * as regulator from './views-regulator.js';
import * as admin from './views-admin.js';
import * as learning from './views-learning.js';

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * `any` lists the permissions that grant access — holding one is enough. A route with no
 * `any` is open to every authenticated user.
 *
 * The ordering matters: patterns are matched in sequence, so `/transactions/new` is
 * declared before `/transactions/:id` or "new" would be read as an identifier.
 */
const ROUTES = [
  { path: '/', view: homeRedirect },

  // Business Portal
  { path: '/dashboard', view: business.businessDashboard, any: ['txn.read'], title: 'Dashboard' },
  { path: '/transactions', view: business.transactionList, any: ['txn.read', 'txn.read.any'], title: 'Transactions' },
  { path: '/transactions/new', view: business.newTransaction, any: ['txn.initiate'], title: 'New transaction' },
  { path: '/transactions/:id', view: business.transactionDetail, any: ['txn.read', 'txn.read.any'], title: 'Transaction' },
  { path: '/beneficiaries', view: business.beneficiaryList, any: ['beneficiary.read'], title: 'Beneficiaries' },
  { path: '/documents', view: business.documentList, any: ['document.read', 'document.read.any'], title: 'Documents' },
  { path: '/onboarding', view: business.onboarding, any: ['org.profile.read'], title: 'Onboarding' },
  { path: '/support', view: business.supportCases, any: ['case.support.raise', 'case.support.manage'], title: 'Support cases' },
  { path: '/reports', view: business.reportsPage, any: ['report.own.read', 'report.operational.read', 'report.compliance.read', 'report.financial.read', 'report.pilot.read'], title: 'Reports' },

  // Operations Console
  { path: '/ops', view: operations.opsDashboard, any: ['treasury.settlement.route', 'treasury.funding.review'], title: 'Operations' },
  { path: '/ops/queue', view: operations.opsQueue, any: ['treasury.settlement.route', 'treasury.funding.review'], title: 'Settlement queue' },
  { path: '/ops/liquidity', view: operations.liquidityView, any: ['treasury.liquidity.read'], title: 'Liquidity' },
  { path: '/ops/partners', view: operations.partnerHealth, any: ['treasury.liquidity.read', 'admin.integration.manage', 'controls.read'], title: 'Partners' },
  { path: '/ops/exceptions', view: operations.exceptionList, any: ['treasury.exception.read', 'recon.break.investigate', 'audit.read'], title: 'Exceptions' },
  { path: '/ops/exceptions/:reference', view: operations.exceptionDetail, any: ['treasury.exception.read', 'recon.break.investigate', 'audit.read'], title: 'Exception' },

  // Compliance Console
  { path: '/compliance', view: compliance.complianceDashboard, any: ['compliance.case.read'], title: 'Compliance' },
  { path: '/compliance/cases', view: compliance.caseList, any: ['compliance.case.read'], title: 'Compliance queue' },
  { path: '/compliance/cases/:reference', view: compliance.caseDetail, any: ['compliance.case.read'], title: 'Case' },
  { path: '/compliance/onboarding', view: compliance.kybQueue, any: ['compliance.kyb.review'], title: 'KYB queue' },
  { path: '/compliance/documents', view: compliance.expiringDocuments, any: ['compliance.case.read'], title: 'Expiring documents' },
  { path: '/compliance/rules', view: compliance.ruleLibrary, any: ['compliance.case.read', 'controls.read', 'learning.read'], title: 'Rule library' },

  // Finance and Reconciliation Console
  { path: '/finance', view: finance.financeDashboard, any: ['ledger.read'], title: 'Finance' },
  { path: '/finance/accounts', view: finance.accountList, any: ['ledger.read'], title: 'Ledger accounts' },
  { path: '/finance/trial-balance', view: finance.trialBalanceView, any: ['ledger.read'], title: 'Trial balance' },
  { path: '/finance/reconciliation', view: finance.reconciliationRuns, any: ['recon.run', 'ledger.read', 'audit.read'], title: 'Reconciliation' },
  { path: '/finance/reconciliation/:reference', view: finance.reconciliationRun, any: ['recon.run', 'ledger.read', 'audit.read'], title: 'Reconciliation run' },

  // Auditor and Regulator Portal
  { path: '/regulator', view: regulator.regulatorOverview, any: ['controls.read'], title: 'Supervisory view' },
  { path: '/regulator/audit', view: regulator.auditTrail, any: ['audit.read'], title: 'Audit trail' },
  { path: '/regulator/controls', view: regulator.controlsView, any: ['controls.read'], title: 'Controls' },

  // System Administration
  { path: '/admin', view: admin.adminDashboard, any: ['admin.config.propose', 'admin.roles.manage', 'admin.integration.manage'], title: 'Administration' },
  { path: '/admin/roles', view: admin.roleMatrix, any: ['admin.roles.manage', 'controls.read', 'audit.read'], title: 'Roles and permissions' },
  { path: '/admin/configuration', view: admin.configurationView, any: ['admin.config.propose', 'controls.read', 'audit.read'], title: 'Configuration' },
  { path: '/admin/partners', view: admin.partnerRegistry, any: ['admin.integration.manage', 'controls.read', 'treasury.liquidity.read', 'audit.read'], title: 'Partner registry' },
  { path: '/admin/simulation', view: admin.simulationControl, any: ['admin.simulation.control'], title: 'Simulation control' },

  // Founder Learning Center
  { path: '/learning', view: learning.learningHome, any: ['learning.read'], title: 'Founder Learning Center' },
  { path: '/learning/product-map', view: learning.productMap, any: ['learning.read'], title: 'Product map' },
  { path: '/learning/walkthrough', view: learning.walkthroughPicker, any: ['learning.read'], title: 'Transaction walkthrough' },
  { path: '/learning/walkthrough/:transactionId', view: learning.walkthrough, any: ['learning.read'], title: 'Transaction walkthrough' },
  { path: '/learning/ledger', view: learning.ledgerExplorer, any: ['learning.read'], title: 'Ledger explorer' },
  { path: '/learning/architecture', view: learning.architectureExplorer, any: ['learning.read'], title: 'Architecture explorer' },
  { path: '/learning/state-machine', view: learning.stateMachineExplorer, any: ['learning.read', 'controls.read'], title: 'Transaction states' },
  { path: '/learning/decisions', view: learning.decisionLog, any: ['learning.read'], title: 'Decision log' },
  { path: '/learning/journal', view: learning.buildJournal, any: ['learning.read'], title: 'Build journal' },
  { path: '/learning/risks', view: learning.riskRegister, any: ['learning.read', 'controls.read'], title: 'Risk register' },
  { path: '/learning/glossary', view: learning.glossary, any: ['learning.read'], title: 'Glossary' },
  { path: '/learning/demo', view: learning.guidedDemo, any: ['learning.read'], title: 'Guided demonstration' },
  { path: '/learning/assessment/:moduleKey', view: learning.assessment, any: ['learning.read'], title: 'Assessment' },
];

/**
 * Navigation, grouped by console. An item appears only if the signed-in user holds one of
 * its permissions — which is why a Business Initiator sees four items and a Super
 * Administrator sees the lot.
 */
const NAVIGATION = [
  {
    label: 'Business',
    items: [
      { path: '/dashboard', label: 'Dashboard', any: ['txn.read'] },
      { path: '/transactions', label: 'Transactions', any: ['txn.read', 'txn.read.any'] },
      { path: '/beneficiaries', label: 'Beneficiaries', any: ['beneficiary.read'] },
      // Deliberately gated on the OWN-documents permission only. A back-office role holds
      // document.read.any and reaches a customer's documents through the case that
      // justifies looking at them — not by browsing every customer's filing cabinet.
      { path: '/documents', label: 'Documents', any: ['document.read'] },
      { path: '/onboarding', label: 'Onboarding', any: ['org.kyb.submit'] },
      { path: '/support', label: 'Support cases', any: ['case.support.raise', 'case.support.manage'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/ops', label: 'Overview', any: ['treasury.settlement.route', 'treasury.funding.review'] },
      { path: '/ops/queue', label: 'Settlement queue', any: ['treasury.settlement.route', 'treasury.funding.review'] },
      { path: '/ops/liquidity', label: 'Liquidity', any: ['treasury.liquidity.read'] },
      { path: '/ops/partners', label: 'Partner health', any: ['treasury.liquidity.read', 'admin.integration.manage'] },
      { path: '/ops/exceptions', label: 'Exceptions', any: ['treasury.exception.read', 'recon.break.investigate'] },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { path: '/compliance', label: 'Overview', any: ['compliance.case.read'] },
      { path: '/compliance/cases', label: 'Case queue', any: ['compliance.case.read'] },
      { path: '/compliance/onboarding', label: 'KYB queue', any: ['compliance.kyb.review'] },
      { path: '/compliance/documents', label: 'Expiring documents', any: ['compliance.case.read'] },
      { path: '/compliance/rules', label: 'Rule library', any: ['compliance.case.read', 'controls.read'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { path: '/finance', label: 'Overview', any: ['ledger.read'] },
      { path: '/finance/accounts', label: 'Ledger accounts', any: ['ledger.read'] },
      { path: '/finance/trial-balance', label: 'Trial balance', any: ['ledger.read'] },
      { path: '/finance/reconciliation', label: 'Reconciliation', any: ['recon.run', 'ledger.read'] },
    ],
  },
  {
    label: 'Oversight',
    items: [
      { path: '/regulator', label: 'Supervisory view', any: ['controls.read'] },
      { path: '/regulator/audit', label: 'Audit trail', any: ['audit.read'] },
      { path: '/regulator/controls', label: 'Controls', any: ['controls.read'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { path: '/admin', label: 'Overview', any: ['admin.config.propose', 'admin.roles.manage', 'admin.integration.manage'] },
      { path: '/admin/roles', label: 'Roles', any: ['admin.roles.manage', 'controls.read'] },
      { path: '/admin/configuration', label: 'Configuration', any: ['admin.config.propose', 'controls.read'] },
      { path: '/admin/partners', label: 'Partner registry', any: ['admin.integration.manage', 'controls.read'] },
      { path: '/admin/simulation', label: 'Simulation control', any: ['admin.simulation.control'] },
    ],
  },
  {
    label: 'Reporting',
    items: [
      { path: '/reports', label: 'Reports', any: ['report.own.read', 'report.operational.read', 'report.compliance.read', 'report.financial.read', 'report.pilot.read'] },
    ],
  },
  {
    label: 'Learn',
    items: [
      { path: '/learning', label: 'Founder Learning Center', any: ['learning.read'] },
      { path: '/learning/demo', label: 'Guided demonstration', any: ['learning.read'] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

const session = {
  me: null,
  environment: null,
  /** Values views may read but must not depend on for authorisation. */
  state: {},
};

/** Records the principal and keeps core.js's permission oracle in step with it. */
function setSession(me) {
  session.me = me;
  setPermissions(me?.permissions ?? []);
}

function permits(route) {
  if (!route.any || route.any.length === 0) return true;
  const held = session.me?.permissions ?? [];
  return route.any.some((p) => held.includes(p));
}

/** The first route in NAVIGATION order the user can actually open. */
function landingPath() {
  for (const group of NAVIGATION) {
    for (const item of group.items) {
      if (permits(item)) return item.path;
    }
  }
  return '/learning';
}

async function homeRedirect(ctx) {
  ctx.navigate(landingPath(), { replace: true });
  return spinner('Opening your console…');
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function matchRoute(pathname) {
  for (const route of ROUTES) {
    const routeParts = route.path.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    if (routeParts.length !== pathParts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < routeParts.length; i += 1) {
      const rp = routeParts[i];
      if (rp.startsWith(':')) params[rp.slice(1)] = decodeURIComponent(pathParts[i]);
      else if (rp !== pathParts[i]) { matched = false; break; }
    }
    if (matched) return { route, params };
  }
  return null;
}

function navigate(path, options = {}) {
  if (options.replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const url = new URL(window.location.href);
  const matched = matchRoute(url.pathname);

  const main = document.getElementById('main-content');
  if (!main) return;

  if (!matched) {
    mount(main, notFoundView(url.pathname));
    return;
  }

  if (!permits(matched.route)) {
    mount(main, forbiddenView(matched.route));
    return;
  }

  document.title = `${matched.route.title ?? 'EKORails'} — EKORails`;
  markCurrentNavigation(url.pathname);
  mount(main, spinner());

  const ctx = {
    params: matched.params,
    query: url.searchParams,
    navigate,
    reload: () => render(),
    state: session.state,
    me: session.me,
  };

  try {
    const view = await matched.route.view(ctx);
    // A slower earlier render must not overwrite a newer one.
    if (token !== renderToken) return;
    mount(main, view);
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  } catch (error) {
    if (token !== renderToken) return;
    if (error instanceof ApiError && error.status === 401) { await bootstrap(); return; }
    mount(main, viewError(error, ctx));
  }

  verifyBannerIntegrity();
}

function notFoundView(pathname) {
  return notice('warning', 'No such page',
    h('p', { text: `Nothing is routed at ${pathname}.` }),
    h('p', {}, h('button', { class: 'btn', onclick: () => navigate(landingPath()) }, 'Back to your console')),
  );
}

function forbiddenView(route) {
  return notice('warning', 'You do not have access to this screen',
    h('p', {
      text:
        'Your roles do not include the permission this screen requires. This is a deliberate ' +
        'separation of duties, not a fault.',
    }),
    h('p', { class: 'mono-inline', text: `Requires one of: ${(route.any ?? []).join(', ')}` }),
    h('p', {}, h('button', { class: 'btn', onclick: () => navigate(landingPath()) }, 'Back to your console')),
  );
}

function viewError(error, ctx) {
  const isApi = error instanceof ApiError;
  return notice('danger', isApi ? error.message : 'This screen could not load',
    h('p', {
      text: isApi
        ? 'The server refused or could not complete the request.'
        : 'Something went wrong rendering this screen.',
    }),
    isApi ? h('p', { class: 'mono-inline', text: `${error.status} ${error.code}` }) : null,
    h('p', {}, h('button', { class: 'btn', onclick: () => ctx.reload() }, 'Try again')),
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function initials(name) {
  return String(name ?? '?')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0].toUpperCase()).join('') || '?';
}

function markCurrentNavigation(pathname) {
  for (const link of document.querySelectorAll('.nav-item[data-path]')) {
    const target = link.dataset.path;
    const isCurrent = target === '/'
      ? pathname === '/'
      : pathname === target || pathname.startsWith(`${target}/`);
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function sidebar(counts) {
  const groups = NAVIGATION
    .map((group) => ({ ...group, items: group.items.filter((item) => permits(item)) }))
    .filter((group) => group.items.length > 0);

  const me = session.me;
  const primaryRole = me.role_details[0];

  return h('nav', { class: 'sidebar', 'aria-label': 'Console navigation' },
    h('div', { class: 'brand' },
      h('div', { class: 'brand-mark', text: 'EK' }),
      h('div', {},
        h('div', { class: 'brand-name', text: 'EKORails' }),
        h('div', { class: 'brand-sub', text: session.environment?.mode ?? 'SANDBOX' }),
      ),
    ),

    ...groups.map((group) => h('div', { class: 'nav-group' },
      h('div', { class: 'nav-label', text: group.label }),
      ...group.items.map((item) => h('button', {
        class: 'nav-item', type: 'button', dataset: { path: item.path },
        onclick: () => navigate(item.path),
      },
        h('span', { text: item.label }),
        counts[item.path] ? h('span', { class: 'nav-count', text: String(counts[item.path]) }) : null,
      )),
    )),

    h('div', { class: 'sidebar-footer' },
      h('div', { class: 'user-chip' },
        h('div', { class: 'user-avatar', text: initials(me.display_name ?? me.full_name) }),
        h('div', {},
          h('div', { class: 'user-name', text: me.display_name ?? me.full_name }),
          h('div', { class: 'user-role', text: primaryRole ? primaryRole.name : 'No role' }),
        ),
      ),
      h('div', { style: 'display:flex; gap:.35rem; margin-top:.5rem; flex-wrap:wrap' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: showWhoAmI }, 'What can I do?'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: signOut }, 'Sign out'),
      ),
    ),
  );
}

/**
 * Shows the user their own permissions and, more usefully, their explicit denials. A role
 * that says what it cannot do is easier to trust than one that only lists what it can.
 */
async function showWhoAmI() {
  const me = session.me;
  await modal({
    title: 'Your access',
    confirmLabel: 'Close',
    body: h('div', {},
      h('p', {
        text:
          'Hiding a menu item is a courtesy. Every action listed here is checked again by the API ' +
          'and again by the database, so this list describes what you can do, not merely what you can see.',
      }),
      ...me.role_details.map((role) => h('div', { style: 'margin-bottom:.9rem' },
        h('h3', { text: role.name }),
        h('p', { class: 'footnote', text: `Realm: ${titleCase(role.realm)}` }),
        role.cannot.length > 0
          ? h('div', {},
              h('p', { class: 'footnote', text: 'Explicitly cannot:' }),
              h('ul', {}, role.cannot.map((c) => h('li', { text: c }))),
            )
          : null,
      )),
      h('details', { class: 'disclose' },
        h('summary', {}, `All ${me.permissions.length} permissions`),
        h('div', {}, h('p', { class: 'mono-inline', text: me.permissions.join('  ') })),
      ),
      h('p', { class: 'footnote', text: `Data masking profile: ${me.masking_profile}` }),
    ),
  });
}

async function signOut() {
  try {
    await post('/api/auth/logout', {});
  } catch {
    // Signing out locally matters even if the server call fails.
  }
  setSession(null);
  await bootstrap();
}

/** Counts that make a queue's size visible before you open it. */
async function navigationCounts() {
  const counts = {};
  const held = session.me?.permissions ?? [];
  const jobs = [];

  if (held.includes('compliance.case.read')) {
    jobs.push(get('/api/compliance/cases?status=open')
      .then((rows) => { if (rows.length) counts['/compliance/cases'] = rows.length; })
      .catch(() => {}));
  }
  if (held.includes('treasury.exception.read') || held.includes('recon.break.investigate')) {
    jobs.push(get('/api/exceptions?open_only=true')
      .then((rows) => { if (rows.length) counts['/ops/exceptions'] = rows.length; })
      .catch(() => {}));
  }
  if (held.includes('txn.read')) {
    jobs.push(get('/api/transactions/requiring-action')
      .then((rows) => { if (rows.length) counts['/transactions'] = rows.length; })
      .catch(() => {}));
  }

  await Promise.all(jobs);
  return counts;
}

async function renderShell() {
  const counts = await navigationCounts();
  const root = document.getElementById('root');

  mount(root,
    h('a', { class: 'skip-link', href: '#main-content' }, 'Skip to content'),
    h('div', { class: 'shell' },
      sidebar(counts),
      h('main', { class: 'main', id: 'main-content', tabindex: '-1' }, spinner()),
    ),
  );

  await render();
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

function loginScreen(message) {
  const email = input({ type: 'email', name: 'email', autocomplete: 'username', required: true });
  const password = input({ type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const errorBox = h('div', { class: 'form-error' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      errorBox.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        await post('/api/auth/login', {
          email: email.value.trim(),
          password: password.value,
        });
        // The second factor is handled by bootstrap(), which asks /api/me what this
        // account still needs. Deciding it here as well would give two answers to one
        // question, and the server's is the one that counts.
        await bootstrap();
      } catch (error) {
        // Deliberately the server's message, which does not distinguish between an unknown
        // email and a wrong password. Telling them apart is how an attacker enumerates users.
        errorBox.textContent = error instanceof ApiError
          ? error.message
          : 'Sign-in could not be completed.';
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
    },
  },
    field('Work email', email),
    field('Password', password),
    errorBox,
    h('div', { style: 'margin-top:.8rem' }, submit),
  );

  return h('div', { class: 'login-wrap' },
    h('div', { class: 'login-card' },
      h('div', { class: 'brand', style: 'border:0; padding-bottom:1rem' },
        h('div', { class: 'brand-mark', text: 'EK' }),
        h('div', {},
          h('div', { class: 'brand-name', text: 'EKORails' }),
          h('div', { class: 'brand-sub', text: 'Settlement orchestration' }),
        ),
      ),
      message ? notice('info', null, message) : null,
      form,
      h('div', { class: 'footnote', style: 'margin-top:1.1rem' },
        h('p', {
          text:
            'This deployment settles through simulators and moves no real money. EKORails is not a ' +
            'bank, a deposit-taking institution, a licensed payment provider or a custodian of ' +
            'customer funds.',
        }),
        h('p', { text: 'All data in this environment is fictional demonstration data.' }),
      ),
    ),
  );
}

/** Second factor at sign-in. Resolves only once the server accepts the code. */
async function verifyMfa() {
  const code = input({ inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000' });
  const accepted = await modal({
    title: 'Enter your authenticator code',
    confirmLabel: 'Verify',
    body: h('div', {},
      h('p', { text: 'Open your authenticator application and enter the current six-digit code.' }),
      field('Code', code),
    ),
    onConfirm: async () => {
      await post('/api/auth/mfa/verify', { code: code.value.trim() });
      return true;
    },
  });
  if (accepted) return true;

  // Cancelling leaves a pre-MFA session, which can read nothing but /api/me. End it
  // rather than leave a half-authenticated session lying around.
  await post('/api/auth/logout', {}).catch(() => {});
  return false;
}

/** First-time enrolment. The secret is shown once and never again. */
async function enrolMfa() {
  const enrolment = await post('/api/auth/mfa/enrol', {});
  const code = input({ inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000' });

  const confirmed = await modal({
    title: 'Set up your second factor',
    confirmLabel: 'Confirm',
    body: h('div', {},
      h('p', {
        text:
          'Add this account to an authenticator application, then enter the code it shows. Your ' +
          'account cannot be used until this is done.',
      }),
      h('p', { class: 'mono-inline', style: 'word-break:break-all', text: enrolment.provisioning_uri ?? '' }),
      enrolment.secret
        ? h('p', {}, 'Secret: ', h('span', { class: 'mono-inline', text: enrolment.secret }))
        : null,
      h('p', {
        class: 'footnote',
        text: 'This secret is shown once. It is not retrievable afterwards; enrolling again replaces it.',
      }),
      field('Code from your authenticator', code),
    ),
    onConfirm: async () => {
      await post('/api/auth/mfa/confirm', { code: code.value.trim() });
      return true;
    },
  });

  if (!confirmed) {
    await post('/api/auth/logout', {}).catch(() => {});
    return false;
  }

  // A fresh code is requested rather than reusing the enrolment one: the server's replay
  // guard refuses a code twice in the same time step, and reusing it would look to the
  // user like their authenticator was wrong.
  return verifyMfa();
}

/**
 * Re-asserts the second factor for a sensitive action. Registered with core.js, which
 * calls it when the server answers STEP_UP_REQUIRED.
 */
async function promptStepUp(reason) {
  const code = input({ inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '6', placeholder: '000000' });
  const result = await modal({
    title: 'Confirm it is you',
    confirmLabel: 'Confirm',
    body: h('div', {},
      h('p', { text: reason || 'This action requires you to re-enter your authenticator code.' }),
      h('p', {
        class: 'footnote',
        text:
          'Sensitive actions ask again even though you are already signed in, so that an unattended ' +
          'session cannot be used to authorise money movement.',
      }),
      field('Code', code),
    ),
    onConfirm: async () => {
      await post('/api/auth/step-up', { code: code.value.trim() });
      return true;
    },
  });
  return result === true;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function bootstrap(message) {
  const root = document.getElementById('root');

  try {
    session.environment = await get('/api/system/environment');
  } catch {
    session.environment = null;
  }

  try {
    setSession(await get('/api/me'));
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      setSession(null);
    } else {
      mount(root, notice('danger', 'The console cannot reach the API',
        h('p', { text: 'The service is not answering. Nothing has been signed in or changed.' }),
        h('p', {}, h('button', { class: 'btn', onclick: () => bootstrap() }, 'Retry')),
      ));
      return;
    }
  }

  if (!session.me) {
    mount(root, loginScreen(message));
    verifyBannerIntegrity();
    return;
  }

  // A pre-MFA session can read /api/me and nothing else. Finish authentication first.
  if (!session.me.mfa_satisfied) {
    const completed = session.me.mfa_enrolled ? await verifyMfa() : await enrolMfa();
    if (!completed) {
      setSession(null);
      mount(root, loginScreen('Sign-in was not completed. Your second factor is still required.'));
      return;
    }
    setSession(await get('/api/me'));
    if (!session.me.mfa_satisfied) {
      setSession(null);
      mount(root, loginScreen('Your second factor was not accepted.'));
      return;
    }
  }

  await renderShell();
}

setStepUpHandler(promptStepUp);
window.addEventListener('popstate', () => render());

// Intercept in-page anchors so navigation stays client-side without inline handlers.
document.addEventListener('click', (event) => {
  const anchor = event.target instanceof Element ? event.target.closest('a[href^="/"]') : null;
  if (!anchor || anchor.hasAttribute('download') || anchor.target === '_blank') return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  navigate(anchor.getAttribute('href'));
});

bootstrap().catch((error) => {
  document.getElementById('root').replaceChildren(
    notice('danger', 'The console failed to start', String(error?.message ?? error)),
  );
});
