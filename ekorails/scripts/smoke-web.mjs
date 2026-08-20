#!/usr/bin/env node
/**
 * Browser smoke test for the six consoles.
 *
 * The brief says a feature is never complete because its interface exists. The unit and
 * API suites prove the server behaves; scripts/check-web.mjs proves the client's modules
 * link up. Neither of them proves that a real person, signed in as a real role, can open
 * a screen and see something correct on it. That is what this does.
 *
 * It signs in as each of the nine roles — password, then a genuine time-based code — and
 * opens every route that role can reach, asserting on each page that:
 *
 *   - the environment banner is present and says what it must say,
 *   - the view rendered content rather than an error notice or an empty shell,
 *   - no route the navigation offers is refused by the route guard,
 *   - nothing rendered as "undefined", "[object Object]" or "NaN",
 *   - the page raised no uncaught error and logged nothing to the browser console.
 *
 * The paths come from the role's OWN rendered navigation, plus a few extras per role that
 * the menu does not offer directly. A hand-written list is a list somebody forgets to add
 * to — which is how the Documents screen stayed broken for back-office roles.
 *
 * That last assertion is stricter than it looks and is the one that earns its keep: it
 * fails on a request the console fires and is refused. A client that asks for things it
 * knows it may not have fills a user's console with 403s, and a real authorisation failure
 * then has nowhere to stand out.
 *
 * It then runs one write journey end to end through the interface — initiate, submit,
 * authorise — because the authorisation path involves a CSRF token and a re-authentication
 * challenge, and those only genuinely work if they work in a browser.
 *
 * Usage:
 *   ./scripts/db-reset.sh && npm run build && npm run seed
 *   node scripts/smoke-web.mjs
 *
 * It starts and stops its own server on a spare port. It WRITES to the database it is
 * pointed at, so it refuses to run outside DEMO, SANDBOX or TEST.
 *
 * Playwright is a development-only dependency and is not installed by default — the
 * runtime has no dependency but `pg`, and this does not change that. If Playwright is
 * absent the script says so and exits 0, so a machine without it does not fail a build
 * over a check it cannot run.
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.EKORAILS_SMOKE_PORT ?? 8099);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSPHRASE = process.env.EKORAILS_SEED_PASSPHRASE ?? 'Demo-Passphrase-2026!';
const MODE = process.env.EKORAILS_ENV_MODE ?? 'SANDBOX';

if (!['DEMO', 'SANDBOX', 'TEST'].includes(MODE)) {
  console.error(`REFUSED: smoke-web.mjs writes to the database and will not run with EKORAILS_ENV_MODE=${MODE}.`);
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('Playwright is not installed; skipping the browser smoke test.');
  console.log('  To run it:  npm i -D playwright   (Chromium is expected at PLAYWRIGHT_BROWSERS_PATH)');
  process.exit(0);
}

// ---------------------------------------------------------------------------

/** A genuine current code for the account, from the same TOTP implementation the API uses. */
function totp(email) {
  const out = execFileSync('node', [join(ROOT, 'services/api/dist/src/seed/totp.js'), email], { encoding: 'utf8' });
  const match = out.match(/Code:\s*(\d{6})/);
  if (!match) throw new Error(`No code produced for ${email}. Is the database seeded?\n${out}`);
  return match[1];
}

const ROLES = [
  {
    email: 'amara.initiator@lagosagri.invalid', label: 'Business Initiator',
    paths: [
      '/dashboard', '/transactions', '/transactions/new', '/beneficiaries', '/documents',
      '/onboarding', '/support', '/reports', '/learning', '/learning/product-map',
      '/learning/glossary', '/learning/demo', '/learning/decisions', '/learning/journal',
      '/learning/walkthrough', '/learning/ledger',
    ],
  },
  {
    email: 'tunde.approver@lagosagri.invalid', label: 'Business Approver',
    paths: ['/dashboard', '/transactions', '/beneficiaries', '/documents', '/reports', '/learning'],
  },
  {
    email: 'compliance.analyst@ekorails.invalid', label: 'Compliance Analyst',
    paths: [
      '/compliance', '/compliance/cases', '/compliance/onboarding', '/compliance/documents',
      '/compliance/rules', '/transactions', '/reports',
    ],
  },
  {
    email: 'compliance.manager@ekorails.invalid', label: 'Compliance Manager',
    paths: ['/compliance', '/compliance/cases', '/compliance/onboarding', '/compliance/rules', '/reports'],
  },
  {
    email: 'treasury@ekorails.invalid', label: 'Treasury Operator',
    paths: [
      '/ops', '/ops/queue', '/ops/liquidity', '/ops/partners', '/ops/exceptions',
      '/transactions', '/finance/trial-balance', '/reports',
    ],
  },
  {
    email: 'finance@ekorails.invalid', label: 'Finance Analyst',
    paths: [
      '/finance', '/finance/accounts', '/finance/trial-balance', '/finance/reconciliation',
      '/ops/exceptions', '/regulator/audit', '/learning/ledger', '/reports',
    ],
  },
  {
    email: 'auditor@ekorails.invalid', label: 'Auditor / Regulator',
    paths: [
      '/regulator', '/regulator/audit', '/regulator/controls', '/transactions',
      '/compliance/cases', '/finance/trial-balance', '/reports', '/learning/risks',
    ],
  },
  {
    email: 'admin@ekorails.invalid', label: 'System Administrator',
    paths: ['/admin', '/admin/roles', '/admin/configuration', '/admin/partners', '/admin/simulation'],
  },
  {
    email: 'founder@ekorails.invalid', label: 'Super Administrator',
    paths: [
      '/learning', '/learning/product-map', '/learning/architecture', '/learning/state-machine',
      '/learning/decisions', '/learning/journal', '/learning/risks', '/learning/glossary',
      '/learning/demo', '/learning/ledger', '/learning/walkthrough', '/admin/roles', '/regulator',
    ],
  },
];

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = spawn('node', [join(ROOT, 'services/api/dist/src/main.js')], {
  env: { ...process.env, EKORAILS_ENV_MODE: MODE, EKORAILS_LOG_LEVEL: 'error', EKORAILS_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/system/health`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start on ${BASE}.\n${serverLog.join('')}`);
}

/**
 * Finds a Chromium to drive.
 *
 * Playwright normally manages its own browser, but a pinned Playwright version and a
 * pre-installed browser rarely agree on a directory name. Rather than download a second
 * copy, look for one already present under PLAYWRIGHT_BROWSERS_PATH and point at it.
 */
function launchOptions() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return {};

  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium')) continue;
    for (const relative of [
      'chrome-linux/chrome',
      'chrome-headless-shell-linux64/chrome-headless-shell',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const candidate = join(root, entry, relative);
      if (existsSync(candidate)) candidates.push(candidate);
    }
  }
  // Prefer a full Chromium over the headless shell: the shell cannot do everything.
  candidates.sort((a, b) => (a.includes('headless') ? 1 : 0) - (b.includes('headless') ? 1 : 0));
  return candidates.length > 0 ? { executablePath: candidates[0] } : {};
}

const failures = [];
let checked = 0;

function note(role, where, message) {
  failures.push(`${role} @ ${where}: ${message}`);
  console.log(`   FAIL ${where} — ${message}`);
}

// ---------------------------------------------------------------------------

async function signIn(page, role) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', role.email);
  await page.fill('input[type=password]', PASSPHRASE);
  await page.click('button[type=submit]');

  // The code is generated only once the dialog is up, so it is always current.
  await page.waitForSelector('.modal', { timeout: 20000 });
  await page.fill('.modal input', totp(role.email));
  await page.click('.modal .btn-primary');
  await page.waitForSelector('.sidebar', { timeout: 20000 });
}

async function checkPage(page, role, path, errors) {
  errors.console.length = 0;
  errors.page.length = 0;

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(350);
  checked += 1;

  const before = failures.length;

  const banner = await page.textContent('#environment-banner').catch(() => null);
  if (!banner || !banner.includes('SANDBOX ENVIRONMENT. NO LIVE FUNDS.')) {
    note(role.label, path, `the environment banner is missing or altered: ${JSON.stringify(banner)}`);
  }

  const main = (await page.textContent('#main-content').catch(() => '')) ?? '';
  if (main.trim().length < 60) {
    note(role.label, path, `rendered almost nothing (${main.trim().length} characters)`);
  }
  if (main.includes('This screen could not load')) {
    note(role.label, path, 'rendered the view-error notice');
  }
  if (main.includes('do not have access to this screen')) {
    note(role.label, path, 'was refused, although the navigation offers it to this role');
  }
  if (main.includes('No such page')) {
    note(role.label, path, 'matched no route');
  }
  for (const broken of ['undefined', '[object Object]', 'NaN']) {
    if (main.includes(broken)) {
      const sample = main.match(new RegExp(`.{0,60}${broken.replace(/[[\]]/g, '\\$&')}.{0,60}`));
      note(role.label, path, `rendered "${broken}": ...${sample ? sample[0].trim() : ''}...`);
    }
  }
  if (errors.page.length > 0) note(role.label, path, `uncaught error: ${errors.page.join(' | ')}`);
  if (errors.console.length > 0) note(role.label, path, `browser console error: ${errors.console.join(' | ')}`);

  if (failures.length === before) console.log(`   ok   ${path}`);
}

// ---------------------------------------------------------------------------
// One write journey, through the interface, with the controls in the way
// ---------------------------------------------------------------------------

async function writeJourney(browser) {
  console.log('\n== Write journey: initiate, submit, authorise');

  const initiator = ROLES[0];
  const approver = ROLES[1];

  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = { console: [], page: [] };
  page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text()); });
  page.on('pageerror', (e) => errors.page.push(String(e)));

  await signIn(page, initiator);
  await page.goto(`${BASE}/transactions/new`, { waitUntil: 'networkidle' });

  const stamp = String(Date.now()).slice(-8);
  await page.selectOption('form select', { index: 0 });
  const textInputs = page.locator('form input[type=text]');
  await textInputs.nth(0).fill('1250000.00');
  await textInputs.nth(1).fill('Settlement of supplier invoice for agricultural inputs');
  await textInputs.nth(2).fill(`SMOKE-${stamp}`);
  await page.locator('form textarea').fill(
    'Revenue from confirmed export sales received into the operating account during the period.',
  );
  await page.click('form button[type=submit]');

  try {
    await page.waitForURL(/\/transactions\/[0-9a-f-]{36}$/, { timeout: 20000 });
  } catch {
    note(initiator.label, 'write journey', `the transaction was not created: ${errors.console.join(' | ')}`);
    await context.close();
    return;
  }

  const url = page.url();
  const reference = (await page.textContent('.page-title')) ?? '';
  console.log(`   created ${reference.trim()}`);

  // Submit it for authorisation.
  const submitButton = page.locator('.page-actions button', { hasText: /Submit/i }).first();
  if (await submitButton.count() === 0) {
    note(initiator.label, 'write journey', 'no submit action was offered on the transaction just created');
    await context.close();
    return;
  }
  await submitButton.click();
  const dialog = page.locator('.modal');
  if (await dialog.count() > 0) {
    const reasonField = dialog.locator('textarea');
    if (await reasonField.count() > 0) {
      await reasonField.fill('Invoice checked against the goods received note and the supplier statement.');
    }
    await dialog.locator('.btn-primary').click();
  }
  await page.waitForTimeout(1200);
  await context.close();

  // The initiator must not be able to authorise their own payment.
  const approverContext = await browser.newContext();
  const approverPage = await approverContext.newPage();
  const approverErrors = { console: [], page: [] };
  approverPage.on('console', (m) => { if (m.type() === 'error') approverErrors.console.push(m.text()); });
  approverPage.on('pageerror', (e) => approverErrors.page.push(String(e)));

  await signIn(approverPage, approver);

  // Completing the second factor at sign-in grants step-up for a few minutes, so an
  // authorisation immediately afterwards is NOT re-challenged — by design. Ask the server
  // whether the window is still open, so the assertion below tests the control rather than
  // the clock.
  const stepUpAlreadyValid = await approverPage.evaluate(async () => {
    const response = await fetch('/api/me', { headers: { accept: 'application/json' } });
    return (await response.json()).data.step_up_valid === true;
  });

  await approverPage.goto(url, { waitUntil: 'networkidle' });

  const authorise = approverPage.locator('.page-actions button', { hasText: /^Authorise$/ }).first();
  if (await authorise.count() === 0) {
    const state = (await approverPage.textContent('#main-content')) ?? '';
    note(approver.label, 'write journey',
      `no authorise action was offered. The transaction may not have been submitted. ${state.slice(0, 160)}`);
    await approverContext.close();
    return;
  }

  await authorise.click();
  const approveDialog = approverPage.locator('.modal');
  await approveDialog.waitFor({ timeout: 10000 });
  const approveReason = approveDialog.locator('textarea');
  if (await approveReason.count() > 0) {
    await approveReason.fill('Authorised. Supplier and amount verified against the purchase order.');
  }
  await approveDialog.locator('.btn-primary').click();

  // Authorisation is a step-up action. Outside the post-sign-in window a second dialog
  // asks for the code again; inside it, the factor is already satisfied.
  await approverPage.waitForTimeout(1200);
  const stepUp = approverPage.locator('.modal', { hasText: 'Confirm it is you' });
  if (await stepUp.count() > 0) {
    console.log('   re-authentication challenged, as it should be');
    await stepUp.locator('input').fill(totp(approver.email));
    await stepUp.locator('.btn-primary').click();
    await approverPage.waitForTimeout(1500);
  } else if (stepUpAlreadyValid) {
    console.log('   not re-challenged: the second factor was still within its window');
  } else {
    note(approver.label, 'write journey',
      'authorisation was not challenged for re-authentication, although the step-up window had closed');
  }

  await approverPage.goto(url, { waitUntil: 'networkidle' });
  await approverPage.waitForTimeout(500);

  // Read the state from the header chip, not from the page. The lifecycle timeline lists
  // every state the payment has passed through, so searching the whole page for the old
  // state finds it in the history and reports a success as a failure.
  const finalState = (await approverPage.textContent('.page-sub').catch(() => '')) ?? '';
  if (finalState.includes('Pending Business Approval')) {
    note(approver.label, 'write journey', 'the payment is still awaiting authorisation after approving it');
  } else {
    console.log(`   authorised; the payment is now ${finalState.split('·').pop().trim()}`);
  }
  if (approverErrors.page.length > 0) {
    note(approver.label, 'write journey', `uncaught error: ${approverErrors.page.join(' | ')}`);
  }

  await approverContext.close();
}

// ---------------------------------------------------------------------------

let exitCode = 0;
try {
  await waitForServer();

  const browser = await chromium.launch(launchOptions());

  for (const role of ROLES) {
    console.log(`\n== ${role.label} (${role.email})`);
    const context = await browser.newContext();
    const page = await context.newPage();

    const errors = { console: [], page: [] };
    page.on('console', (m) => { if (m.type() === 'error') errors.console.push(m.text()); });
    page.on('pageerror', (e) => errors.page.push(String(e)));

    try {
      await signIn(page, role);
      console.log('   signed in');
    } catch (error) {
      note(role.label, 'sign-in', `never reached the console: ${error.message} ${errors.page.join('; ')}`);
      await context.close();
      continue;
    }

    // Every path the role's own navigation offers, read from the rendered sidebar rather
    // than from a list here. A hand-written list is a list somebody forgets to add to: the
    // Documents screen was broken for back-office roles for exactly that reason, because no
    // role's list happened to include it. Deriving the paths means a menu item that exists
    // is a menu item that gets opened.
    const navigable = await page.$$eval(
      '.nav-item[data-path]', (nodes) => nodes.map((node) => node.dataset.path),
    );

    const paths = [...new Set([...navigable, ...role.paths])];
    console.log(`   ${navigable.length} navigation items, ${paths.length} paths to open`);

    for (const path of paths) await checkPage(page, role, path, errors);
    await context.close();
  }

  await writeJourney(browser);
  await browser.close();

  console.log(`\n${'='.repeat(62)}`);
  console.log(`  ${checked} page loads across ${ROLES.length} roles, plus one write journey`);
  console.log(`  ${failures.length} problem(s)`);
  console.log(`${'='.repeat(62)}`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    exitCode = 1;
  }
} catch (error) {
  console.error(`Smoke test could not run: ${error.message}`);
  exitCode = 1;
} finally {
  server.kill('SIGTERM');
}

process.exit(exitCode);
