#!/usr/bin/env node
/**
 * Captures the interface evidence annex.
 *
 * A regulator receives a document package, not a login. So the interface has to reach them
 * as images — and the images have to be of the SYSTEM RUNNING, not of a design tool.
 * Everything captured here comes from the real application, signed in as the real role,
 * reading the real seeded database. The environment banner is visible in every frame, which
 * is the point: a reader can see that each screen came from a deployment that moves no
 * money.
 *
 * Each capture declares what it EVIDENCES. A screenshot with a caption saying "dashboard"
 * proves nothing; one saying "no account in this chart of accounts could hold a customer's
 * money" can be checked against the image.
 *
 * Usage:
 *   ./scripts/db-reset.sh && npm run build && npm run seed
 *   node scripts/capture-evidence.mjs
 *
 * Writes PNGs to docs/submission/evidence/ and a manifest the annex is generated from.
 * Refuses to run outside DEMO, SANDBOX or TEST.
 */

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/submission/evidence');
const PORT = Number(process.env.EKORAILS_CAPTURE_PORT ?? 8097);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSPHRASE = process.env.EKORAILS_SEED_PASSPHRASE ?? 'Demo-Passphrase-2026!';
const MODE = process.env.EKORAILS_ENV_MODE ?? 'SANDBOX';

if (!['DEMO', 'SANDBOX', 'TEST'].includes(MODE)) {
  console.error(`REFUSED: capture-evidence.mjs will not run with EKORAILS_ENV_MODE=${MODE}.`);
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('Playwright is not installed; cannot capture evidence.');
  console.log('  npm i -D playwright');
  process.exit(0);
}

function totp(email) {
  const out = execFileSync('node', [join(ROOT, 'services/api/dist/src/seed/totp.js'), email], { encoding: 'utf8' });
  const match = out.match(/Code:\s*(\d{6})/);
  if (!match) throw new Error(`No code for ${email}. Is the database seeded?\n${out}`);
  return match[1];
}

/**
 * The captures, grouped by the role that can legitimately see them.
 *
 * Grouped by role rather than by topic because each sign-in costs a fresh time-based code,
 * and the replay guard means consecutive sign-ins for one account have to wait out a step.
 */
const PLAN = [
  {
    email: 'auditor@ekorails.invalid', role: 'Auditor / Regulator',
    captures: [
      {
        file: '01-supervisory-view', path: '/regulator',
        title: 'Supervisory view',
        evidences:
          'The complete list of what EKORails is not — bank, deposit-taker, licensed payment '
          + 'provider, custodian of customer funds — served from the API rather than written on a '
          + 'slide, together with how each is enforced. Sandbox admission is stated as NOT '
          + 'CONFIRMED on the applicant\'s own screen.',
      },
      {
        file: '02-release-gates', path: '/regulator/controls',
        title: 'Release gates and controls',
        evidences:
          'Nine gates stand between this build and live money, each requiring named evidence, '
          + 'and none is met. None is settable from any interface: they are process configuration '
          + 'read once at start-up. The risk register below them shows control status honestly — '
          + 'nothing has reached independently reviewed.',
      },
      {
        file: '03-audit-trail', path: '/regulator/audit?category=authorisation',
        title: 'Audit trail, filtered to authorisation events',
        evidences:
          'The hash chain verifies, computed inside the database rather than by the application. '
          + 'Refused actions appear alongside successful ones — a trail containing only successes '
          + 'says nothing about what was attempted.',
      },
      {
        file: '04-trial-balance', path: '/finance/trial-balance',
        title: 'Trial balance',
        evidences:
          'Debits equal credits in every currency. The check runs in SQL against the tables, and '
          + 'the service refuses to start if it fails.',
      },
      {
        file: '05-chart-of-accounts', path: '/finance/accounts',
        title: 'Ledger accounts',
        evidences:
          'THE CUSTODY EVIDENCE. There is no customer stored-value account anywhere in this chart '
          + 'of accounts — not disabled, absent. Customer money appears only as a receivable or as '
          + 'a balance the PARTNER institution holds.',
      },
      {
        file: '06-compliance-queue', path: '/compliance/cases',
        title: 'Compliance queue, read-only oversight',
        evidences:
          'A supervisor can see every case, its authority level and its service target, through a '
          + 'read-only role whose every write route is refused.',
      },
    ],
  },
  {
    email: 'compliance.analyst@ekorails.invalid', role: 'Compliance Analyst',
    captures: [
      {
        file: '07-compliance-case', path: 'FIRST_CASE',
        title: 'A compliance case in full',
        evidences:
          'Every rule that APPLIED was evaluated and recorded, including those that did not fire — '
          + '"checked and found nothing" is evidence, "never run" is a gap, and storing only '
          + 'triggered rules would make them indistinguishable. Each evaluation carries the rule '
          + 'text, the parameter values in force at the time and the data read.',
      },
      {
        file: '08-rule-library', path: '/compliance/rules',
        title: 'Compliance rule library',
        evidences:
          'Every rule states the risk it addresses, when it fires, the evidence it requires, what '
          + 'the system does, what a person decides, and HOW IT CAN BE WRONG. Rules are immutable '
          + 'once published; a change creates a new version.',
      },
      {
        file: '09-expiring-documents', path: '/compliance/documents?within_days=90',
        title: 'Document expiry monitoring',
        evidences:
          'Customer evidence is tracked to its expiry. An expired document raises a rule against '
          + 'the next transaction relying on it rather than silently lapsing.',
      },
    ],
  },
  {
    email: 'treasury@ekorails.invalid', role: 'Treasury and Settlement Operator',
    captures: [
      {
        file: '10-operations-queue', path: '/ops',
        title: 'Operations console',
        evidences:
          'Work is grouped by what is waiting on a person, not by recency. States where a payment '
          + 'cannot progress without human judgement are pinned to the top.',
      },
      {
        file: '11-transaction-detail', path: 'FIRST_COMPLETED_TXN',
        title: 'A completed payment, end to end',
        evidences:
          'The full lifecycle with the actor, the reason and the timestamp for every transition; '
          + 'the ledger entries with a plain-English explanation of each; and every partner '
          + 'exchange, labelled as simulated.',
      },
      {
        file: '12-liquidity', path: '/ops/liquidity',
        title: 'Liquidity and partner positions',
        evidences:
          'Every balance is held at a PARTNER institution. The FX clearing account is shown '
          + 'separately: a balance there means half a conversion happened, which is an open '
          + 'position with an owner rather than a rounding note.',
      },
    ],
  },
  {
    email: 'finance@ekorails.invalid', role: 'Finance and Reconciliation Analyst',
    captures: [
      {
        file: '13-reconciliation', path: '/finance/reconciliation',
        title: 'Daily reconciliation',
        evidences:
          'Six comparisons run daily. A difference opens a break and adopts neither figure; above '
          + 'the four-eyes threshold the investigator cannot approve the closure.',
      },
      {
        file: '14-exceptions', path: '/ops/exceptions',
        title: 'Exception cases',
        evidences:
          'Every break has an owner, a priority and a service target. A shortfall sits in '
          + 'settlement suspense until somebody explains it; it is never written off silently.',
      },
    ],
  },
  {
    email: 'admin@ekorails.invalid', role: 'System Administrator',
    captures: [
      {
        file: '15-configuration', path: '/admin/configuration',
        title: 'System configuration and unresolved placeholders',
        evidences:
          'The regulatory facts this application seeks to establish are held as explicit '
          + 'placeholders rather than assumed. Configuration is immutable: a change is a new '
          + 'version under maker-checker and never rewrites a historical result.',
      },
      {
        file: '16-simulation-control', path: '/admin/simulation',
        title: 'Partner failure simulation',
        evidences:
          'Eleven failure modes can be produced on demand, so behaviour under failure is OBSERVED '
          + 'rather than described. Note the timeout scenario: the payment stops and automatic '
          + 'retry is disabled, because retrying an instruction whose outcome is unknown is how a '
          + 'payment gets made twice.',
      },
      {
        file: '17-roles', path: '/admin/roles',
        title: 'Role and permission matrix',
        evidences:
          'Nine roles, each with explicit denials rather than merely absent permissions. '
          + 'Separation-of-duties rules are evaluated against the context of an action, so holding '
          + 'two roles does not confer a capability neither role has.',
      },
    ],
  },
  {
    email: 'founder@ekorails.invalid', role: 'Super Administrator',
    captures: [
      {
        file: '18-product-map', path: '/learning/product-map',
        title: 'Build status, module by module',
        evidences:
          'Sixteen modules, each reported at the highest stage it has GENUINELY reached, with what '
          + 'is simulated and what is limited stated per module. Nothing is above "tested", because '
          + 'an independent security review has not taken place.',
      },
      {
        file: '19-state-machine', path: '/learning/state-machine',
        title: 'The settlement state machine',
        evidences:
          'Every route between states is declared with the actor, the permission, the '
          + 'preconditions and the accounting consequence. There is no function that simply sets a '
          + 'state. The note disclaims settlement finality.',
      },
      {
        file: '20-decision-log', path: '/learning/decisions',
        title: 'Founder decision log',
        evidences:
          'Every fact the application could not establish is recorded as an open decision with its '
          + 'options, its recommendation and what it blocks. Nine of ten remain open.',
      },
    ],
  },
];

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const server = spawn('node', [join(ROOT, 'services/api/dist/src/main.js')], {
  env: { ...process.env, EKORAILS_ENV_MODE: MODE, EKORAILS_LOG_LEVEL: 'error', EKORAILS_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(`${BASE}/api/system/health`)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start.\n${serverLog.join('')}`);
}

function launchOptions() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return {};
  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium')) continue;
    for (const rel of ['chrome-linux/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) {
      const c = join(root, entry, rel);
      if (existsSync(c)) candidates.push(c);
    }
  }
  candidates.sort((a, b) => (a.includes('headless') ? 1 : 0) - (b.includes('headless') ? 1 : 0));
  return candidates.length > 0 ? { executablePath: candidates[0] } : {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(page, email) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PASSPHRASE);
  await page.click('button[type=submit]');
  await page.waitForSelector('.modal', { timeout: 20000 });

  // The replay guard refuses a code at or below the step it last accepted, so a fresh
  // sign-in for the same account within one step needs to wait the step out.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.fill('.modal input', totp(email));
    await page.click('.modal .btn-primary');
    try {
      await page.waitForSelector('.sidebar', { timeout: 4000 });
      return;
    } catch {
      await sleep(2000);
    }
  }
  throw new Error(`Could not complete sign-in for ${email}`);
}

/** Paths that have to be discovered from the data rather than written down. */
async function resolvePath(page, path) {
  if (path === 'FIRST_CASE') {
    const cases = await page.evaluate(async () => {
      const r = await fetch('/api/compliance/cases', { headers: { accept: 'application/json' } });
      return (await r.json()).data ?? [];
    });
    const withAssessment = cases.find((c) => c.risk_outcome) ?? cases[0];
    if (!withAssessment) throw new Error('No compliance case to capture.');
    return `/compliance/cases/${withAssessment.reference}`;
  }
  if (path === 'FIRST_COMPLETED_TXN') {
    const txns = await page.evaluate(async () => {
      const r = await fetch('/api/transactions?limit=200', { headers: { accept: 'application/json' } });
      return (await r.json()).data ?? [];
    });
    const completed = txns.find((t) => t.state === 'completed') ?? txns[0];
    if (!completed) throw new Error('No transaction to capture.');
    return `/transactions/${completed.id}`;
  }
  return path;
}

let exitCode = 0;
const manifest = [];

try {
  await waitForServer();
  const browser = await chromium.launch(launchOptions());

  for (const group of PLAN) {
    console.log(`\n== ${group.role}`);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,          // legible when a reviewer zooms a printed page
    });
    const page = await context.newPage();

    await signIn(page, group.email);

    for (const capture of group.captures) {
      const path = await resolvePath(page, capture.path);
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);

      // Every frame must carry the banner. A screenshot of this system without it would
      // misrepresent the deployment it came from.
      const banner = await page.textContent('#environment-banner').catch(() => '');
      if (!banner?.includes('NO LIVE FUNDS')) {
        throw new Error(`${capture.file}: the environment banner is not visible; refusing to capture.`);
      }

      // A full-page capture is taller than the viewport, and the sidebar is sticky with a
      // viewport height — so it stops partway down and leaves a torn edge. Neutralise the
      // stickiness for the capture only. This changes layout, not content: nothing shown or
      // hidden differs from what a user sees, and the banner is asserted above regardless.
      await page.addStyleTag({
        content: `
          .sidebar { position: static !important; height: auto !important; }
          .shell { min-height: 0 !important; align-items: stretch; }
        `,
      });
      await page.waitForTimeout(200);

      const file = `${capture.file}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: true });

      manifest.push({
        file,
        title: capture.title,
        role: group.role,
        path,
        evidences: capture.evidences,
      });
      console.log(`   captured ${file}  ${path}`);
    }

    await context.close();
  }

  await browser.close();

  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`\n${manifest.length} captures written to docs/submission/evidence/`);
} catch (error) {
  console.error(`Capture failed: ${error.message}`);
  exitCode = 1;
} finally {
  server.kill('SIGTERM');
}

process.exit(exitCode);
