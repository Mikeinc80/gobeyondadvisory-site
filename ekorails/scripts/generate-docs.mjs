#!/usr/bin/env node
/**
 * Generates the documents that describe what the code does.
 *
 * A written role matrix and a coded one disagree eventually. Whichever is wrong, the
 * damage is the same: somebody relies on the document. So the documents that describe
 * mechanism — the permission matrix, the state machine, the API surface, the rule
 * library, the data model — are produced FROM the definitions the software actually uses,
 * and regenerating them is part of the build.
 *
 * The documents that describe judgement — the risk register, the threat model, the
 * privacy assessment, the manuals — are written by hand, because generating them would
 * mean generating the judgement, and there is no judgement in the code to read.
 *
 * Each generated file carries a header saying it is generated and from what. If you find
 * yourself editing one, edit the definition instead and run this.
 *
 * Usage: node scripts/generate-docs.mjs [--check]
 *   --check  regenerates into memory and fails if any file on disk differs. Wired into
 *            scripts/test.sh so a definition change that is not reflected in the
 *            documents fails the build rather than being noticed a quarter later.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const CHECK = process.argv.includes('--check');

const DIST = join(ROOT, 'services/api/dist/src');
if (!existsSync(DIST)) {
  console.error('The API is not built. Run: npx tsc -p services/api/tsconfig.json');
  process.exit(2);
}

const { ROLES, PERMISSIONS, SEPARATION_RULES } = await import(join(DIST, 'auth/rbac.js'));
const { describeStateMachine, TRANSITIONS, TERMINAL_STATES } = await import(join(DIST, 'modules/settlement/machine.js'));
const { RULES } = await import(join(DIST, 'modules/compliance/rules.js'));
const { REPORT_DEFINITIONS } = await import(join(DIST, 'modules/reporting/reports.js'));
const { buildRouter } = await import(join(DIST, 'http/routes.js'));
const { RELEASE_GATES } = await import(join(DIST, 'core/env.js'));
const { FOUNDER_DECISIONS, RISK_REGISTER, BUILD_JOURNAL, MODULES } = await import(join(DIST, 'seed/learning.js'));

const written = [];
const differing = [];

function emit(filename, body) {
  const header =
    `<!--\n` +
    `  GENERATED FILE — do not edit.\n\n` +
    `  Produced by scripts/generate-docs.mjs from the definitions the software actually\n` +
    `  uses. If this document is wrong, the code is wrong: change the code and regenerate.\n` +
    `  \`node scripts/generate-docs.mjs --check\` fails the build when the two disagree.\n` +
    `-->\n\n`;

  const content = header + body.trimEnd() + '\n';
  const path = join(DOCS, filename);

  if (CHECK) {
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (existing !== content) differing.push(filename);
    return;
  }
  writeFileSync(path, content, 'utf8');
  written.push(filename);
}

const esc = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');

// ---------------------------------------------------------------------------
// 04 — Data model
// ---------------------------------------------------------------------------

function generateDataModel() {
  const files = readdirSync(join(ROOT, 'db/migrations')).filter((f) => f.endsWith('.sql')).sort();

  const tables = [];
  for (const file of files) {
    const sql = readFileSync(join(ROOT, 'db/migrations', file), 'utf8');
    for (const match of sql.matchAll(/CREATE TABLE (\w+)\s*\(([\s\S]*?)\n\);/g)) {
      const [, name, body] = match;
      const columns = [];
      const references = [];

      for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('--') || /^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE)\b/i.test(line)) continue;
        const columnMatch = line.match(/^(\w+)\s+([A-Za-z][\w ()]*?)(?:\s+(?:NOT NULL|NULL|DEFAULT|REFERENCES|CHECK|UNIQUE|PRIMARY)\b|,|$)/);
        if (!columnMatch) continue;

        const [, column, type] = columnMatch;
        const ref = line.match(/REFERENCES\s+(\w+)/);
        if (ref) references.push({ column, table: ref[1] });

        columns.push({
          name: column,
          type: type.trim(),
          notNull: /\bNOT NULL\b/.test(line),
          references: ref ? ref[1] : null,
          enumerated: (line.match(/CHECK\s*\([^)]*IN\s*\(([^)]*)\)/) ?? [])[1] ?? null,
        });
      }

      tables.push({ name, file, columns, references });
    }
  }

  const money = tables.flatMap((t) =>
    t.columns.filter((c) => /NUMERIC\(24,\s*6\)/i.test(c.type)).map((c) => `${t.name}.${c.name}`));
  const rates = tables.flatMap((t) =>
    t.columns.filter((c) => /NUMERIC\(24,\s*12\)/i.test(c.type)).map((c) => `${t.name}.${c.name}`));

  const lines = [];
  lines.push('# 04 — Data model');
  lines.push('');
  lines.push(`${tables.length} tables across ${files.length} migrations.`);
  lines.push('');
  lines.push('## The properties this schema is responsible for');
  lines.push('');
  lines.push('The database is the enforcement layer, not a store the application writes to. Three');
  lines.push('things are true of it that no amount of careful application code could guarantee:');
  lines.push('');
  lines.push('- **Money is fixed-precision.** Every monetary column is `NUMERIC(24,6)` and every');
  lines.push('  exchange rate is `NUMERIC(24,12)`. No monetary value is ever stored as a floating-point');
  lines.push('  number, anywhere, and the application reads them as strings so IEEE-754 never touches');
  lines.push('  a figure that represents money.');
  lines.push('- **A journal that does not balance cannot be committed.** A deferred constraint trigger');
  lines.push('  sums each journal by currency at commit time and raises if the sum is not zero.');
  lines.push('- **Evidence cannot be edited.** Audit events, journal entries, compliance decisions,');
  lines.push('  transitions and case notes carry append-only triggers, and the application role holds');
  lines.push('  no `UPDATE` or `DELETE` grant on them. A bug in the application cannot rewrite history.');
  lines.push('');
  lines.push(`## Monetary columns (${money.length})`);
  lines.push('');
  lines.push('Every one is `NUMERIC(24,6)`.');
  lines.push('');
  lines.push(money.map((m) => `\`${m}\``).join(', ') || '_None._');
  lines.push('');
  lines.push(`## Exchange-rate columns (${rates.length})`);
  lines.push('');
  lines.push('Every one is `NUMERIC(24,12)`. Rates carry more precision than money because a rate is');
  lines.push('multiplied by a large amount, and rounding the rate rounds the result by much more.');
  lines.push('');
  lines.push(rates.map((r) => `\`${r}\``).join(', ') || '_None._');
  lines.push('');
  lines.push('## Entity relationships');
  lines.push('');
  lines.push('Rendered as a diagram below and listed in full afterwards. Read the arrows as');
  lines.push('"references": the source table holds a foreign key into the target.');
  lines.push('');
  lines.push('```mermaid');
  lines.push('erDiagram');

  const seen = new Set();
  for (const table of tables) {
    for (const ref of table.references) {
      const key = `${table.name}->${ref.table}`;
      if (seen.has(key) || ref.table === table.name) continue;
      seen.add(key);
      lines.push(`  ${ref.table} ||--o{ ${table.name} : "${ref.column}"`);
    }
  }
  lines.push('```');
  lines.push('');
  lines.push('## Tables');
  lines.push('');

  for (const table of tables) {
    lines.push(`### \`${table.name}\``);
    lines.push('');
    lines.push(`Defined in \`db/migrations/${table.file}\`.`);
    lines.push('');
    lines.push('| Column | Type | Required | References | Permitted values |');
    lines.push('|---|---|---|---|---|');
    for (const column of table.columns) {
      lines.push(
        `| \`${column.name}\` | \`${esc(column.type)}\` | ${column.notNull ? 'yes' : 'no'} | ` +
        `${column.references ? `\`${column.references}\`` : '—'} | ` +
        `${column.enumerated ? esc(column.enumerated.replace(/'/g, '')) : '—'} |`,
      );
    }
    lines.push('');
  }

  emit('04-data-model.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// 05 — API reference
// ---------------------------------------------------------------------------

function generateApiReference() {
  const router = buildRouter();
  const routes = router.all();

  const byTag = new Map();
  for (const route of routes) {
    const tag = (route.tags ?? ['other'])[0];
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(route);
  }

  const lines = [];
  lines.push('# 05 — API reference');
  lines.push('');
  lines.push(`${routes.length} endpoints. A machine-readable OpenAPI 3.1 description of the same`);
  lines.push('surface is served at `GET /api/openapi.json`, generated from the same registrations.');
  lines.push('');
  lines.push('## Conventions that hold everywhere');
  lines.push('');
  lines.push('- **Envelope.** Every JSON response carries `data` plus a `meta` block containing the');
  lines.push('  environment, the banner and a request id. Errors carry `error` with a `code`, a');
  lines.push('  message safe to show a user, and `details`.');
  lines.push('- **The banner travels on every response**, including 404s and 500s, in the');
  lines.push('  `X-EKORails-Environment` header. A client that renders a different environment from');
  lines.push('  the one the server reports is showing a claim the server does not support.');
  lines.push('- **Authentication** is an opaque session token in an `HttpOnly` cookie. State-changing');
  lines.push('  requests must additionally present the CSRF token from the readable `ekorails_csrf`');
  lines.push('  cookie in an `X-CSRF-Token` header.');
  lines.push('- **Permissions are checked per route**, and again in the service, and again by');
  lines.push('  row-level security in the database. A route listing several permissions grants access');
  lines.push('  to a caller holding ANY of them.');
  lines.push('- **404, not 403, for another organisation\'s records.** Telling a caller that a record');
  lines.push('  exists but is not theirs is itself a disclosure.');
  lines.push('- **Rate limits** are per identity where there is a session and per hashed network');
  lines.push('  address otherwise. Authentication endpoints are limited far more tightly than reads.');
  lines.push('');
  lines.push('## Status codes');
  lines.push('');
  lines.push('| Code | Means |');
  lines.push('|---|---|');
  lines.push('| 200 / 201 | Success. |');
  lines.push('| 400 | The request was malformed or a required field was missing or invalid. |');
  lines.push('| 401 | Not authenticated, or authenticated but the second factor is outstanding. |');
  lines.push('| 403 | Permission denied, CSRF failure, a separation-of-duties refusal, or re-authentication required. |');
  lines.push('| 404 | Not found — including records outside the caller\'s organisation. |');
  lines.push('| 409 | A conflicting concurrent change. |');
  lines.push('| 422 | An integrity guard refused the operation. The request was well formed; the system will not do it. |');
  lines.push('| 429 | Rate limited. |');
  lines.push('');

  for (const [tag, group] of [...byTag.entries()].sort()) {
    lines.push(`## ${tag[0].toUpperCase()}${tag.slice(1)}`);
    lines.push('');
    lines.push('| Method | Path | Requires | What it does |');
    lines.push('|---|---|---|---|');
    for (const route of group.sort((a, b) => a.pattern.localeCompare(b.pattern))) {
      const auth = route.auth === 'none' ? 'nothing (public)'
        : route.auth === 'session_pre_mfa' ? 'a session, second factor outstanding'
        : (route.permissions ?? []).length > 0 ? (route.permissions).map((p) => `\`${p}\``).join(' or ')
        : 'a session';
      lines.push(`| \`${route.method}\` | \`${route.pattern}\` | ${auth} | ${esc(route.summary)} |`);
    }
    lines.push('');
  }

  lines.push('## Reports');
  lines.push('');
  lines.push('Each report is served at `GET /api/reports/{key}` in `json`, `csv`, `xlsx` or `pdf`.');
  lines.push('Every non-JSON export is recorded with a content hash, the parameters used and the');
  lines.push('masking profile that produced it, so an export can be tied back to what was asked for.');
  lines.push('');
  lines.push('| Key | Title | Family | Requires | Filters |');
  lines.push('|---|---|---|---|---|');
  for (const definition of REPORT_DEFINITIONS) {
    lines.push(
      `| \`${definition.key}\` | ${esc(definition.title)} | ${definition.family} | ` +
      `\`${definition.permission}\` | ${definition.filters.join(', ') || '—'} |`,
    );
  }

  emit('05-api-reference.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// 07 — Transaction states
// ---------------------------------------------------------------------------

function generateStateMachine() {
  const states = describeStateMachine();

  const lines = [];
  lines.push('# 07 — Transaction states');
  lines.push('');
  lines.push(`${states.length} states and ${TRANSITIONS.length} declared transitions.`);
  lines.push('');
  lines.push('## Why this is a table and not a status column');
  lines.push('');
  lines.push('There is no function anywhere in this system that sets a transaction\'s state. Every');
  lines.push('route between two states is declared with the actor type allowed to take it, the');
  lines.push('permission required, the preconditions, the accounting consequence, who is notified and');
  lines.push('whether it requires re-authentication. A state that is not reachable by a declared edge');
  lines.push('is not reachable at all.');
  lines.push('');
  lines.push('That matters most in the states nobody wants to think about. When a partner does not');
  lines.push('answer, the payment goes to `under_investigation` and automatic retry is switched off,');
  lines.push('because retrying an instruction whose outcome is unknown is how a payment gets made');
  lines.push('twice. Getting out of that state requires a person who has established what actually');
  lines.push('happened.');
  lines.push('');
  lines.push('## What "settled" does not mean');
  lines.push('');
  lines.push('`settled` means the partner reported the payment as made. It is not settlement finality,');
  lines.push('which is a legal property conferred by a settlement system operator, and nothing in this');
  lines.push('build can produce it. A payment that has settled can still be returned, and a return is');
  lines.push('a new event: the original settlement is never reversed, because erasing it would hide');
  lines.push('what happened.');
  lines.push('');
  lines.push('## Diagram');
  lines.push('');
  lines.push('```mermaid');
  lines.push('stateDiagram-v2');
  for (const transition of TRANSITIONS) {
    lines.push(`  ${transition.from} --> ${transition.to} : ${transition.event}`);
  }
  lines.push('```');
  lines.push('');
  lines.push('## States');
  lines.push('');
  lines.push('| State | Terminal | What it means |');
  lines.push('|---|---|---|');
  for (const state of states) {
    lines.push(`| \`${state.state}\` | ${state.is_terminal ? 'yes' : 'no'} | ${esc(state.plain_english)} |`);
  }
  lines.push('');
  lines.push(`Terminal states: ${TERMINAL_STATES.map((s) => `\`${s}\``).join(', ')}.`);
  lines.push('');
  lines.push('## Transitions');
  lines.push('');

  for (const state of states) {
    if (state.outbound_transitions.length === 0) continue;
    lines.push(`### From \`${state.state}\``);
    lines.push('');
    lines.push('| Event | Leads to | Actor | Permission | Re-auth | Preconditions | Ledger effect | Notifies |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const t of state.outbound_transitions) {
      lines.push(
        `| \`${t.event}\` | \`${t.to}\` | ${t.permitted_actor_types.join(', ')} | ` +
        `${t.permitted_roles_by_permission.length > 0 ? t.permitted_roles_by_permission.map((p) => `\`${p}\``).join(', ') : '— (not a human action)'} | ` +
        `${t.requires_step_up ? 'yes' : 'no'} | ` +
        `${t.preconditions.length > 0 ? esc(t.preconditions.join('; ')) : '—'} | ` +
        `${esc(t.accounting_consequence)} | ` +
        `${t.notifies.length > 0 ? t.notifies.join(', ') : '—'} |`,
      );
    }
    lines.push('');
    for (const t of state.outbound_transitions) {
      lines.push(`- **\`${t.event}\`** — ${esc(t.description)}`);
    }
    lines.push('');
  }

  emit('07-transaction-states.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// 08 — Role and permission matrix
// ---------------------------------------------------------------------------

function generateRoleMatrix() {
  const roles = Object.values(ROLES);
  const permissions = Object.entries(PERMISSIONS);

  const lines = [];
  lines.push('# 08 — Role and permission matrix');
  lines.push('');
  lines.push(`${roles.length} roles, ${permissions.length} permissions, ${SEPARATION_RULES.length} separation-of-duties rules.`);
  lines.push('');
  lines.push('## How to read this');
  lines.push('');
  lines.push('Permissions are additive; separation-of-duties rules are subtractive and win. A user who');
  lines.push('somehow holds two roles does not thereby acquire a capability that neither role has,');
  lines.push('because the separation rules are evaluated against the CONTEXT of the action — who');
  lines.push('initiated the thing being approved, who investigated the break being closed — and not');
  lines.push('against the permission set.');
  lines.push('');
  lines.push('Every role also carries explicit denials. An absent permission is an oversight waiting to');
  lines.push('happen; a stated "cannot" is a control somebody has to deliberately remove.');
  lines.push('');
  lines.push('The same structure is seeded into the `role`, `permission` and `role_permission` tables,');
  lines.push('so an auditor can read the effective matrix out of the database and compare it with this');
  lines.push('document without trusting either.');
  lines.push('');
  lines.push('## Roles');
  lines.push('');

  for (const role of roles) {
    lines.push(`### ${role.name}`);
    lines.push('');
    lines.push(`\`${role.code}\` · realm: ${role.realm} · ` +
      `re-authentication for sensitive actions: ${role.requiresStepUp ? 'required' : 'not required'}` +
      `${role.isBreakGlass ? ' · **break glass**' : ''}`);
    lines.push('');
    lines.push(role.description);
    lines.push('');
    lines.push('**Cannot:**');
    lines.push('');
    for (const denial of role.explicitDenials) lines.push(`- ${denial}`);
    lines.push('');
    lines.push(`**Holds ${role.permissions.length} permissions:** ${role.permissions.map((p) => `\`${p}\``).join(', ')}`);
    lines.push('');
  }

  lines.push('## Matrix');
  lines.push('');
  lines.push(`| Permission | Sensitive | ${roles.map((r) => r.code.replace(/_/g, ' ')).join(' | ')} |`);
  lines.push(`|---|---|${roles.map(() => '---').join('|')}|`);
  for (const [code, permission] of permissions) {
    const cells = roles.map((r) => (r.permissions.includes(code) ? 'X' : ''));
    lines.push(`| \`${code}\` | ${permission.sensitive ? 'yes' : ''} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## Permissions');
  lines.push('');
  lines.push('| Permission | Domain | Sensitive | What it allows | Held by |');
  lines.push('|---|---|---|---|---|');
  for (const [code, permission] of permissions) {
    const holders = roles.filter((r) => r.permissions.includes(code));
    lines.push(
      `| \`${code}\` | ${permission.domain} | ${permission.sensitive ? 'yes' : 'no'} | ` +
      `${esc(permission.description)} | ${holders.length} of ${roles.length} roles |`,
    );
  }
  lines.push('');
  lines.push('## Separation of duties');
  lines.push('');
  lines.push('| Rule | Action | What is refused |');
  lines.push('|---|---|---|');
  for (const rule of SEPARATION_RULES) {
    lines.push(`| \`${rule.code}\` | \`${rule.action}\` | ${esc(rule.description)} |`);
  }

  emit('08-role-permission-matrix.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// 09 — Compliance control matrix
// ---------------------------------------------------------------------------

function generateComplianceMatrix() {
  const byCategory = new Map();
  for (const rule of RULES) {
    if (!byCategory.has(rule.category)) byCategory.set(rule.category, []);
    byCategory.get(rule.category).push(rule);
  }

  const lines = [];
  lines.push('# 09 — Compliance control matrix');
  lines.push('');
  lines.push(`${RULES.length} rules across ${byCategory.size} categories.`);
  lines.push('');
  lines.push('## How the engine records what it did');
  lines.push('');
  lines.push('Every rule that APPLIES to a subject is evaluated against it, and the result is written');
  lines.push('whether or not the rule fired. A rule that was checked and found nothing is evidence; a');
  lines.push('rule that was never run is a gap. If only triggered rules were stored the two would be');
  lines.push('indistinguishable a year later.');
  lines.push('');
  lines.push('Each evaluation is self-contained: it stores the rule text, the parameter values in');
  lines.push('force, the data the rule read, a hash of the inputs and a hash of the whole ruleset. It');
  lines.push('is not read back from current configuration, so a later rule change cannot alter what a');
  lines.push('past decision appears to have been based on.');
  lines.push('');
  lines.push('## What this build cannot decide');
  lines.push('');
  lines.push('The corridor is an unconfirmed placeholder, so `CORRIDOR_PLACEHOLDER_UNCONFIRMED` fires');
  lines.push('on every transaction. No transaction in this build can clear compliance automatically.');
  lines.push('That is intended behaviour for a system whose regulatory scope has not been confirmed,');
  lines.push('not a defect in the engine, and it will stop being true when the corridor is confirmed');
  lines.push('and the placeholder is replaced under maker-checker.');
  lines.push('');
  lines.push('`HIGH_RISK_JURISDICTION` ships with an EMPTY jurisdiction list. A list of high-risk');
  lines.push('countries is a regulatory fact, and none was available to this build, so none has been');
  lines.push('invented. The rule is present and evaluates to "not triggered" against an empty list,');
  lines.push('which is visible in every assessment rather than silently absent.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Rule | Category | Severity | On trigger | Applies to |');
  lines.push('|---|---|---|---|---|');
  for (const rule of RULES) {
    lines.push(
      `| \`${rule.key}\` | ${rule.category} | ${rule.severity} | ${rule.onTrigger} | ` +
      `${(rule.appliesTo ?? []).join(', ') || '—'} |`,
    );
  }
  lines.push('');

  for (const [category, rules] of [...byCategory.entries()].sort()) {
    lines.push(`## ${category[0].toUpperCase()}${category.slice(1).replace(/_/g, ' ')}`);
    lines.push('');
    for (const rule of rules) {
      lines.push(`### \`${rule.key}\` — ${rule.name}`);
      lines.push('');
      lines.push(`Version ${rule.version} · severity ${rule.severity} · on trigger: ${rule.onTrigger}`);
      lines.push('');
      lines.push('| | |');
      lines.push('|---|---|');
      lines.push(`| **Risk it addresses** | ${esc(rule.riskAddressed)} |`);
      lines.push(`| **When it fires** | ${esc(rule.triggerCondition)} |`);
      lines.push(`| **Evidence required** | ${esc(rule.requiredEvidence)} |`);
      lines.push(`| **What the system does** | ${esc(rule.automatedAction)} |`);
      lines.push(`| **What a person decides** | ${esc(rule.humanDecision)} |`);
      lines.push(`| **How it can be wrong** | ${esc(rule.falsePositiveRisk)} |`);
      lines.push(`| **Policy basis** | ${esc(rule.policyBasis)} |`);
      lines.push(`| **Parameters** | \`${esc(JSON.stringify(rule.parameters ?? {}))}\` |`);
      lines.push('');
    }
  }

  emit('09-compliance-control-matrix.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// 10 — Requirements traceability
// ---------------------------------------------------------------------------

/**
 * Requirements, and the test that proves each one.
 *
 * The `verifiedBy` entries are matched against the actual `test('...')` names in the
 * suites. A requirement claiming a test that does not exist fails the build, which is
 * the only thing that stops a traceability matrix becoming a work of fiction — the
 * failure mode of every such matrix is a row asserting coverage that was renamed away
 * two quarters ago.
 *
 * Requirements with NO test are listed too, in their own section, with what is missing
 * stated plainly. A matrix with no gaps is a matrix nobody checked.
 */
const REQUIREMENTS = [
  {
    id: 'REQ-01', area: 'Regulatory boundary',
    requirement: 'This deployment moves no real money, and live functionality cannot be activated through any interface.',
    source: 'Brief — "The MVP must default to simulated settlement. Live-mode functionality must remain disabled behind a configuration flag and must not be activatable through the user interface."',
    enforcedBy: 'Nine release gates read from process configuration at start-up; assertLiveMoneyPermitted() throws unconditionally in this build.',
    verifiedBy: [
      'assertLiveMoneyPermitted throws in this build',
      'the environment mode cannot be changed through the API',
      'every single gate must be met; eight of nine is still a refusal',
      'PRODUCTION with unmet gates REFUSES to start',
      'there are nine release gates, each with stated evidence',
    ],
  },
  {
    id: 'REQ-02', area: 'Regulatory boundary',
    requirement: 'The environment banner appears on every screen and every response, and cannot be suppressed.',
    source: 'Brief — persistent banner "SANDBOX ENVIRONMENT. NO LIVE FUNDS."',
    enforcedBy: 'First element in the document; a response header on every request; the client blocks the page if the rendered banner disagrees with the server.',
    verifiedBy: [
      'the environment banner is on every response, including errors',
      'the response envelope always carries the banner and simulation flag',
    ],
  },
  {
    id: 'REQ-03', area: 'Regulatory boundary',
    requirement: 'EKORails is never presented as a bank, a custodian of customer funds, or an admitted sandbox participant.',
    source: 'Brief — regulatory boundary list.',
    enforcedBy: 'No customer stored-value account exists in the chart of accounts; a public boundary statement; a claims lint over every user-facing string.',
    verifiedBy: [
      'the chart of accounts contains no customer stored-value account',
      'the regulatory boundary is served publicly and states what EKORails is not',
      'a business user has no ledger read permission and sees only their own accounts',
    ],
  },
  {
    id: 'REQ-04', area: 'Money',
    requirement: 'Monetary amounts are stored using fixed-precision decimal types. Floating point is never used for money.',
    source: 'Brief — "Store monetary amounts using fixed-precision decimal types. Never use floating-point storage for money."',
    enforcedBy: 'NUMERIC(24,6) columns; a BigInt-backed Decimal that refuses construction from a fractional JavaScript number; amounts travel to the browser as strings.',
    verifiedBy: [
      'fractional JS numbers cannot be used to construct money',
      'constructing from a value with too many decimals is REFUSED, not truncated',
      'the classic float failure does not occur',
      'very large amounts do not lose precision',
      'addition and subtraction are exact at scale',
      'the canonical string form round-trips exactly',
    ],
  },
  {
    id: 'REQ-05', area: 'Ledger',
    requirement: 'Every journal balances within each currency, and an unbalanced journal cannot exist.',
    source: 'Brief — double-entry ledger.',
    enforcedBy: 'A deferred CONSTRAINT TRIGGER that sums by currency at commit and raises otherwise.',
    verifiedBy: [
      'an unbalanced journal is refused at commit by the database',
      'a cross-currency journal must balance within EACH currency',
      'a single-line journal is refused',
      'the trial balance nets to zero in every currency',
      'the application layer refuses an imbalance before it reaches the database',
    ],
  },
  {
    id: 'REQ-06', area: 'Ledger',
    requirement: 'Ledger entries cannot be edited or deleted. Corrections are made by reversal.',
    source: 'Brief — audit-log protection; accounting integrity.',
    enforcedBy: 'No UPDATE/DELETE grant for the application role; append-only triggers that raise even for the table owner.',
    verifiedBy: [
      'the application role cannot UPDATE a journal entry',
      'the application role cannot DELETE a journal entry',
      'even the schema owner cannot UPDATE a journal entry',
      'even the schema owner cannot DELETE a journal entry',
      'a partner rejection unwinds the positioning by reversal, not deletion',
      'a return is a new event; the original settlement journal stands',
    ],
  },
  {
    id: 'REQ-07', area: 'Audit',
    requirement: 'The audit trail is append-only and tamper-evident, and refusals are recorded as carefully as successes.',
    source: 'Brief — audit-log protection.',
    enforcedBy: 'Hash-chained entries verified by a SQL function; append-only triggers; withheld grants; deliberately permissive RLS on UPDATE/DELETE so an attempt raises loudly rather than matching zero rows.',
    verifiedBy: [
      'the audit hash chain verifies and detects tampering',
      'the application role has no UPDATE privilege on the audit trail',
      'the application role has no DELETE privilege on the audit trail',
      'even the schema owner is refused by the append-only trigger on UPDATE',
      'even the schema owner is refused by the append-only trigger on DELETE',
      'the audit record is genuinely unchanged after the attempts',
      'every login attempt, successful or not, is recorded',
    ],
  },
  {
    id: 'REQ-08', area: 'Access control',
    requirement: 'One organisation cannot read another organisation\'s data.',
    source: 'Brief — least privilege; role "cannot" statements.',
    enforcedBy: 'Row-level security with FORCE on every table carrying customer data, driven by a transaction-local security context.',
    verifiedBy: [
      'organisation A cannot see organisation B\'s transactions, at the database level',
      'the isolation holds across every organisation-scoped table',
      'a request with no security context sees nothing at all',
      'a cross-organisation quote acceptance returns not-found, not forbidden',
    ],
  },
  {
    id: 'REQ-09', area: 'Access control',
    requirement: 'The nine specified roles exist, each with its stated permissions and its explicit denials.',
    source: 'Brief — nine user roles with can/cannot lists.',
    enforcedBy: 'Roles declared as data, seeded into the database, denials stated explicitly rather than implied by absence.',
    verifiedBy: [
      'all nine roles from the specification exist',
      'every role states what it explicitly cannot do',
      'every role permission exists in the permission catalogue',
      'a business initiator cannot approve, clear compliance or touch the ledger',
      'a treasury operator cannot clear a compliance alert',
      'an analyst cannot approve a high-risk KYB case',
      'the auditor role is read-only: it holds no write permission at all',
      'a System Administrator holds no permission that could reach a compliance decision',
    ],
  },
  {
    id: 'REQ-10', area: 'Access control',
    requirement: 'The person who initiates a transaction cannot authorise it.',
    source: 'Brief — dual authorisation.',
    enforcedBy: 'A separation rule evaluated against the transaction\'s initiator, refused by the state machine and again by the database.',
    verifiedBy: [
      'the state machine refuses the approve edge for the initiator',
      'the service layer refuses a self-approval and audits the attempt',
      'the database refuses a self-approval even if the service layer is bypassed',
      'separation-of-duties rules fire on the involved user',
    ],
  },
  {
    id: 'REQ-11', area: 'Authentication',
    requirement: 'Multi-factor authentication, with re-authentication before value-moving actions.',
    source: 'Brief — MFA; step-up for sensitive operations.',
    enforcedBy: 'RFC 6238 TOTP with a step replay guard; step-up required by declared transitions; scrypt passwords; lockout.',
    verifiedBy: [
      'TOTP generates and verifies, and refuses a replayed step',
      'TOTP tolerates one step of clock drift but not two',
      'the value-moving edges require step-up authentication',
      'failed logins lock the account after the threshold',
      'a wrong password and an unknown email give the same response',
      'password hashes verify and differ per salt',
      'the password policy weights length and rejects contextual words',
    ],
  },
  {
    id: 'REQ-12', area: 'Web security',
    requirement: 'CSRF protection, strict security headers, and rate limiting.',
    source: 'Brief — OWASP ASVS / API Top 10; CSRF; CSP; rate limiting.',
    enforcedBy: 'Double-submit CSRF token; CSP with a nonce and no inline script; per-identity rate limits.',
    verifiedBy: [
      'a state-changing request without the CSRF header is refused',
      'a request with the WRONG CSRF token is refused',
      'a GET does not require a CSRF token',
      'security headers are strict',
      'the login endpoint is rate limited',
      'an oversized body is refused',
      'a malformed JSON body is rejected cleanly',
    ],
  },
  {
    id: 'REQ-13', area: 'Logging',
    requirement: 'Passwords, tokens, complete identification numbers, bank credentials, private keys and unmasked documents are never logged.',
    source: 'Brief — "Never log: Passwords, Authentication tokens, Complete identification numbers, Full bank-account credentials, Private cryptographic keys, Unmasked sensitive documents."',
    enforcedBy: 'A redaction layer over structured logging, asserted against real logging output.',
    verifiedBy: [
      'the redaction layer removes credentials and masks identifiers',
      'no audit event in the database contains an unredacted secret',
      'no integration event payload contains an unmasked account identifier',
    ],
  },
  {
    id: 'REQ-14', area: 'Compliance',
    requirement: 'Every applicable rule is evaluated and recorded, whether or not it fires, and a decision can be reconstructed later.',
    source: 'Brief — compliance rule library; reproducible decisions.',
    enforcedBy: 'Self-contained evaluations storing the rule text, parameters, data used, an input hash and a ruleset hash.',
    verifiedBy: [
      'every required check from the specification is present',
      'every rule states its subject scope',
      'every rule carries the plain-English fields the Learning Center renders',
      'rule keys and versions are unique',
      'the high-risk jurisdiction list is empty and says why',
      'no rule cites a regulation the filing has not supplied without saying so',
      'the case the engine opened carries its reasoning, authored by the engine and not by a person',
    ],
  },
  {
    id: 'REQ-15', area: 'Compliance',
    requirement: 'A transaction cannot bypass compliance review, and prohibited outcomes block rather than warn.',
    source: 'Brief — compliance-first.',
    enforcedBy: 'No transition edge skips compliance; prohibited-severity rules reject or suspend.',
    verifiedBy: [
      'no edge exists that would skip compliance',
      'prohibited-severity rules reject or suspend, never merely review',
      'the compliance engine also treats suspension as prohibited',
      'a suspended organisation is refused at creation and the attempt is audited',
      'a match against the simulated list suspends rather than silently allowing',
      'a PEP hit routes to enhanced due diligence and requires a manager',
      'a missing limit is treated as a block, never as unlimited',
      'an amount over the per-transaction limit is rejected, not merely flagged',
    ],
  },
  {
    id: 'REQ-16', area: 'AI',
    requirement: 'AI extraction proposes; it never confirms. A human must confirm extracted information.',
    source: 'Brief — "Do not claim AI verification is conclusive... A human must confirm extracted information."',
    enforcedBy: 'Extraction writes to a separate table with status proposed; the compliance engine never reads it; a recorded human confirmation is required.',
    verifiedBy: [
      'a proposal is recorded as proposed and says it has no effect',
      'an unconfirmed proposal cannot influence a compliance outcome',
      'confirming records the person, and the audit event says the proposal was advisory',
      'a transaction without source-of-funds evidence cannot auto-clear',
    ],
  },
  {
    id: 'REQ-17', area: 'Settlement',
    requirement: 'An unknown partner outcome does not retry automatically, and the same instruction cannot cause a second payment.',
    source: 'Brief — settlement failure handling.',
    enforcedBy: 'Deterministic idempotency keys; an unknown-outcome state with retry disabled, reachable only by non-user actors.',
    verifiedBy: [
      'a timeout produces an UNKNOWN outcome, a suspense posting and a critical exception',
      'resubmitting the same idempotency key does not instruct a second payment',
      'the unknown-outcome edge exists and is reachable only by non-users',
      'a partner cannot take a compliance or approval edge',
    ],
  },
  {
    id: 'REQ-18', area: 'Settlement',
    requirement: 'Settlement finality is never claimed, and a return does not erase the settlement it follows.',
    source: 'Brief — do not overstate what settlement means.',
    enforcedBy: 'A disclaimer carried by the state machine description; the returned-payment edge posts a new journal rather than a reversal.',
    verifiedBy: [
      'finality is never claimed anywhere in the machine',
      'the state-machine view disclaims settlement finality',
      'the returned-payment edge does NOT reverse the settlement journal',
    ],
  },
  {
    id: 'REQ-19', area: 'Reconciliation',
    requirement: 'Differences open a break with an owner, and closure above the threshold requires a second person.',
    source: 'Brief — reconciliation and exception handling.',
    enforcedBy: 'Reconciliation opens exception cases; four-eyes approval refused for the investigator.',
    verifiedBy: [
      'a partner statement that disagrees with the ledger produces a break',
      'closing a break above the threshold requires a second person',
    ],
  },
  {
    id: 'REQ-20', area: 'FX',
    requirement: 'A rate is indicative until accepted, never described as locked without a contractual lock, and an expired quote is refused.',
    source: 'Brief — forbidden FX language; "Locked until [time]" only where contractually locked.',
    enforcedBy: 'Simulated quotes cannot carry a lock; expiry enforced at acceptance; the claims lint fails the build on prohibited language.',
    verifiedBy: [
      'a simulated quote can never be marked as contractually locked',
      'an expired quote cannot be accepted',
      'an FX spread is computed in basis points from reference and provider rates',
    ],
  },
  {
    id: 'REQ-21', area: 'Reporting',
    requirement: 'Reports export in multiple formats, safely, with each export recorded.',
    source: 'Brief — reporting and export.',
    enforcedBy: 'CSV/XLSX/PDF writers with formula-injection neutralisation and precision preservation; exports recorded with a content hash and masking profile.',
    verifiedBy: [
      'a report exports as CSV, XLSX and PDF, and each export is recorded',
      'CSV neutralises formula injection',
      'CSV quotes correctly per RFC 4180',
      'XLSX keeps very long numbers as text so precision is not lost',
      'PDF paginates rather than truncating',
      'the report catalogue is filtered by the caller\'s permissions',
      'a customer can run a report of their own activity',
    ],
  },
  {
    id: 'REQ-22', area: 'Privacy',
    requirement: 'Personal data is encrypted at field level and masked by default, and oversight views expose no personal names.',
    source: 'Brief — data protection; masking.',
    enforcedBy: 'AES-256-GCM field encryption; masking profiles derived from roles and applied server-side.',
    verifiedBy: [
      'field encryption round-trips and is authenticated',
      'masking profiles are correct for each realm',
      'the regulator overview exposes no personal names',
      'off-platform notifications refuse to carry financial detail',
      'no stored notification body violates the off-platform rule',
    ],
  },
  {
    id: 'REQ-23', area: 'Continuity',
    requirement: 'A backup restores with its history, its ledger balance and its audit chain intact.',
    source: 'Brief — disaster recovery.',
    enforcedBy: 'A dedicated read-only backup role, because FORCE row-level security silently empties a dump taken as the owner.',
    verifiedBy: [
      'a logical backup restores with history, ledger balance and audit chain intact',
    ],
    gap: 'The test proves the mechanism. NO RESTORATION OF A REAL DEPLOYMENT HAS EVER BEEN PERFORMED. See R-14 and EKORAILS_GATE_DR_TESTED.',
  },
  {
    id: 'REQ-24', area: 'Honesty',
    requirement: 'No feature is reported as complete because its interface exists, and unfinished work is not concealed.',
    source: 'Brief — "Never report a feature as complete merely because the interface exists." / "Do not conceal incomplete functionality."',
    enforcedBy: 'Eight completion stages; the product map reports the highest stage genuinely reached; the build journal and risk register state what is unfinished.',
    verifiedBy: [
      'the product map reports honest completion stages',
    ],
  },
  {
    id: 'REQ-25', area: 'Honesty',
    requirement: 'No claim is made that EKORails is not entitled to make.',
    source: 'Brief — forbidden FX language; regulatory boundary.',
    enforcedBy: 'A claims lint over every user-facing string in the repository, failing the build on prohibited language.',
    verifiedBy: [],
    gap: 'Verified by scripts/lint-claims.mjs in the build rather than by a test in the suites. The lint covers this repository only; it cannot police a slide deck, a website or a conversation. See R-15.',
  },
];

function generateTraceability() {
  const suites = ['unit', 'mandatory', 'api'];
  const testNames = new Set();
  for (const suite of suites) {
    const source = readFileSync(join(ROOT, `services/api/test/${suite}.test.ts`), 'utf8');
    for (const match of source.matchAll(/\btest\(\s*'((?:[^'\\]|\\.)*)'/g)) {
      testNames.add(match[1].replace(/\\'/g, "'"));
    }
  }

  // A requirement naming a test that does not exist is the failure mode of every
  // traceability matrix. Fail rather than print it.
  const missing = [];
  for (const requirement of REQUIREMENTS) {
    for (const name of requirement.verifiedBy) {
      if (!testNames.has(name)) missing.push(`${requirement.id} names a test that does not exist: "${name}"`);
    }
  }
  if (missing.length > 0) {
    console.error('Traceability matrix is out of date:\n');
    for (const problem of missing) console.error(`  - ${problem}`);
    console.error('\nEither the test was renamed, or the requirement is not actually covered.');
    process.exit(1);
  }

  const covered = REQUIREMENTS.filter((r) => r.verifiedBy.length > 0);
  const gaps = REQUIREMENTS.filter((r) => r.gap);
  const totalAssertions = REQUIREMENTS.reduce((sum, r) => sum + r.verifiedBy.length, 0);

  const lines = [];
  lines.push('# 10 — Requirements traceability');
  lines.push('');
  lines.push(`${REQUIREMENTS.length} requirements. ${covered.length} carry at least one automated test.`);
  lines.push(`${totalAssertions} named tests across ${testNames.size} in the suites.`);
  lines.push('');
  lines.push('## Why this document checks itself');
  lines.push('');
  lines.push('The failure mode of every traceability matrix is a row asserting coverage by a test that');
  lines.push('was renamed away two quarters ago. So each test named below is matched against the actual');
  lines.push('`test(...)` names in the suites when this document is generated, and a name that does not');
  lines.push('resolve **fails the build**.');
  lines.push('');
  lines.push('It does not prove the tests are good. It proves they exist and are named here honestly.');
  lines.push('');
  lines.push(`## Requirements with a gap (${gaps.length})`);
  lines.push('');
  lines.push('Listed first, because a matrix whose gaps are at the bottom is a matrix nobody reads to');
  lines.push('the bottom of.');
  lines.push('');
  for (const requirement of gaps) {
    lines.push(`- **${requirement.id}** — ${esc(requirement.requirement)}`);
    lines.push(`  - ${esc(requirement.gap)}`);
  }
  lines.push('');
  lines.push('## Matrix');
  lines.push('');
  lines.push('| Ref | Area | Requirement | Tests |');
  lines.push('|---|---|---|---|');
  for (const requirement of REQUIREMENTS) {
    lines.push(
      `| \`${requirement.id}\` | ${requirement.area} | ${esc(requirement.requirement)} | ` +
      `${requirement.verifiedBy.length > 0 ? String(requirement.verifiedBy.length) : '**none**'} |`,
    );
  }
  lines.push('');
  lines.push('## Detail');
  lines.push('');
  for (const requirement of REQUIREMENTS) {
    lines.push(`### ${requirement.id} — ${requirement.requirement}`);
    lines.push('');
    lines.push(`**Area:** ${requirement.area}`);
    lines.push('');
    lines.push(`**Source:** ${requirement.source}`);
    lines.push('');
    lines.push(`**Enforced by:** ${requirement.enforcedBy}`);
    lines.push('');
    if (requirement.verifiedBy.length > 0) {
      lines.push(`**Verified by ${requirement.verifiedBy.length} test(s):**`);
      lines.push('');
      for (const name of requirement.verifiedBy) lines.push(`- \`${name}\``);
      lines.push('');
    }
    if (requirement.gap) {
      lines.push(`**Gap:** ${requirement.gap}`);
      lines.push('');
    }
  }

  emit('10-requirements-traceability.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// 11 — Risk register
// ---------------------------------------------------------------------------

const LIKELIHOOD_ORDER = ['rare', 'unlikely', 'possible', 'likely', 'almost_certain'];
const IMPACT_ORDER = ['minor', 'moderate', 'major', 'severe', 'critical'];

function generateRiskRegister() {
  const blocking = RISK_REGISTER.filter((r) => r.blocks);
  const notImplemented = RISK_REGISTER.filter((r) => !String(r.status).startsWith('implemented'));

  const lines = [];
  lines.push('# 11 — Risk register');
  lines.push('');
  lines.push(`${RISK_REGISTER.length} risks. ${blocking.length} would block a pilot.`);
  lines.push('');
  lines.push('## The column that matters');
  lines.push('');
  lines.push('`Control status` is the honest column, and it is the reason this register is worth');
  lines.push('reading. A risk register that lists a control for every risk tells you nothing: the');
  lines.push('question is always whether the control exists, whether anyone has tested it, and whether');
  lines.push('anyone independent has looked at it. The five values are:');
  lines.push('');
  lines.push('| Status | Means |');
  lines.push('|---|---|');
  lines.push('| `not_implemented` | Nothing is in place. The control is an intention. |');
  lines.push('| `documented_only` | It is written down. No code enforces it. |');
  lines.push('| `implemented_untested` | Code exists. Nothing proves it works. |');
  lines.push('| `implemented_tested` | Code exists and an automated test exercises it, including its failure mode. |');
  lines.push('| `implemented_and_independently_reviewed` | As above, and somebody who did not build it has examined it. |');
  lines.push('');
  lines.push(`**Nothing in this build has reached the fifth status.** No independent security review has`);
  lines.push('taken place, which is itself a release gate (`EKORAILS_GATE_SECURITY_REVIEW`) and is why');
  lines.push('the highest honest status here is `implemented_tested`.');
  lines.push('');
  lines.push(`${notImplemented.length} of ${RISK_REGISTER.length} risks carry a control that is not fully implemented.`);
  lines.push('');
  lines.push('## Risks that block a pilot');
  lines.push('');
  lines.push('| Ref | Risk | Why it blocks | What would clear it |');
  lines.push('|---|---|---|---|');
  for (const risk of blocking) {
    lines.push(`| \`${risk.ref}\` | ${esc(risk.title)} | ${esc(risk.description)} | ${esc(risk.action)} |`);
  }
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Ref | Category | Risk | Inherent | Control status | Residual | Owner | Treatment | Blocks pilot |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const risk of RISK_REGISTER) {
    lines.push(
      `| \`${risk.ref}\` | ${risk.category} | ${esc(risk.title)} | ${risk.il} / ${risk.ii} | ` +
      `\`${risk.status}\` | ${risk.rl} / ${risk.ri} | ${esc(risk.owner)} | ${risk.treatment} | ` +
      `${risk.blocks ? '**yes**' : 'no'} |`,
    );
  }
  lines.push('');
  lines.push('## Detail');
  lines.push('');
  for (const risk of RISK_REGISTER) {
    lines.push(`### \`${risk.ref}\` — ${risk.title}`);
    lines.push('');
    lines.push(`Category: ${risk.category}${risk.blocks ? ' · **blocks a pilot**' : ''}`);
    lines.push('');
    lines.push(risk.description);
    lines.push('');
    lines.push('| | |');
    lines.push('|---|---|');
    lines.push(`| **Inherent** | ${risk.il} likelihood, ${risk.ii} impact |`);
    lines.push(`| **Controls in place** | ${esc(risk.controls)} |`);
    lines.push(`| **Control status** | \`${risk.status}\` |`);
    lines.push(`| **Residual** | ${risk.rl} likelihood, ${risk.ri} impact |`);
    lines.push(`| **Movement** | ${describeMovement(risk)} |`);
    lines.push(`| **Owner** | ${esc(risk.owner)} |`);
    lines.push(`| **Treatment** | ${risk.treatment} |`);
    lines.push(`| **Further action** | ${esc(risk.action)} |`);
    lines.push('');
  }

  emit('11-risk-register.md', lines.join('\n'));
}

/** States plainly what the controls actually moved, rather than implying they moved everything. */
function describeMovement(risk) {
  const likelihoodMoved = LIKELIHOOD_ORDER.indexOf(risk.il) - LIKELIHOOD_ORDER.indexOf(risk.rl);
  const impactMoved = IMPACT_ORDER.indexOf(risk.ii) - IMPACT_ORDER.indexOf(risk.ri);

  if (likelihoodMoved <= 0 && impactMoved <= 0) {
    return 'The controls did not reduce either likelihood or impact. They make the risk visible rather than smaller.';
  }
  if (impactMoved <= 0) {
    return `Likelihood reduced by ${likelihoodMoved} band(s). Impact is unchanged: if this happens anyway, it is just as bad.`;
  }
  return `Likelihood reduced by ${likelihoodMoved} band(s) and impact by ${impactMoved}.`;
}

// ---------------------------------------------------------------------------
// 25 — Pilot readiness
// ---------------------------------------------------------------------------

const STAGE_ORDER = [
  'designed', 'frontend_built', 'backend_built', 'integrated',
  'tested', 'security_reviewed', 'founder_accepted', 'pilot_ready',
];

/**
 * The verdict is COMPUTED, not asserted.
 *
 * A readiness report whose conclusion is typed in by whoever wrote it is a report that
 * says whatever that person hoped. This one derives from the actual state of the release
 * gates, the blocking risks, the open decisions and the honest build stage of each module,
 * and it cannot say "ready" while any of those says otherwise.
 */
function computeVerdict() {
  const gatesUnmet = RELEASE_GATES.filter((g) => process.env[g.key] !== 'true');
  const blockingRisks = RISK_REGISTER.filter((r) => r.blocks);
  const openDecisions = FOUNDER_DECISIONS.length;
  const notPilotReady = MODULES.filter((m) => m.stage !== 'pilot_ready');

  const dependencies = [];
  if (gatesUnmet.some((g) => /REGULATORY_APPROVAL|LICENCE_VERIFIED/.test(g.key))) {
    dependencies.push('REGULATORY DEPENDENCY');
  }
  if (gatesUnmet.some((g) => /PARTNER_CONTRACTS/.test(g.key))) {
    dependencies.push('PARTNER DEPENDENCY');
  }
  if (gatesUnmet.some((g) => /SECURITY_REVIEW|PRIVACY_REVIEW/.test(g.key))) {
    dependencies.push('SECURITY DEPENDENCY');
  }
  if (openDecisions > 0) dependencies.push('FOUNDER DECISION REQUIRED');

  const verdict = (gatesUnmet.length === 0 && blockingRisks.length === 0 && notPilotReady.length === 0)
    ? 'READY'
    : (gatesUnmet.length > 0 || blockingRisks.length > 0)
      ? 'NOT READY'
      : 'READY WITH CONDITIONS';

  return { verdict, dependencies, gatesUnmet, blockingRisks, openDecisions, notPilotReady };
}

function generatePilotReadiness() {
  const v = computeVerdict();
  const stageCounts = new Map();
  for (const module of MODULES) {
    stageCounts.set(module.stage, (stageCounts.get(module.stage) ?? 0) + 1);
  }

  const lines = [];
  lines.push('# 25 — Pilot readiness report');
  lines.push('');
  lines.push(`## Verdict: **${v.verdict}**`);
  lines.push('');
  lines.push(v.dependencies.map((d) => `**${d}**`).join(' · '));
  lines.push('');
  lines.push('This verdict is computed when the document is generated, from the actual state of the');
  lines.push('release gates, the blocking risks, the open founder decisions and the honest build stage');
  lines.push('of every module. It is not a sentence somebody typed. It cannot read "ready" while any of');
  lines.push('those says otherwise, which is the only way a readiness report stays worth reading.');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push(`| Release gates met | ${RELEASE_GATES.length - v.gatesUnmet.length} of ${RELEASE_GATES.length} |`);
  lines.push(`| Risks that block a pilot | ${v.blockingRisks.length} of ${RISK_REGISTER.length} |`);
  lines.push(`| Founder decisions open | ${v.openDecisions} of ${FOUNDER_DECISIONS.length} |`);
  lines.push(`| Modules at pilot-ready | ${MODULES.length - v.notPilotReady.length} of ${MODULES.length} |`);
  lines.push('');
  lines.push('## What the verdict is not saying');
  lines.push('');
  lines.push('It is not saying the software does not work. It does: a payment runs end to end, the');
  lines.push('ledger balances, every failure path can be produced deliberately and is handled, and');
  lines.push('every screen renders for every role in a real browser.');
  lines.push('');
  lines.push('It is saying that a pilot is a regulated activity with real customers and real money, and');
  lines.push('the things standing between this build and one are mostly not engineering.');
  lines.push('');
  lines.push('## Release gates');
  lines.push('');
  lines.push('Each requires named evidence. None is settable from any interface; they are process-level');
  lines.push('configuration read once at start-up. Setting one without the evidence behind it is not a');
  lines.push('configuration change — it is a false statement about the state of the business.');
  lines.push('');
  lines.push('| Gate | Evidence required | Met |');
  lines.push('|---|---|---|');
  for (const gate of RELEASE_GATES) {
    const met = process.env[gate.key] === 'true';
    lines.push(`| \`${gate.key}\` | ${esc(gate.evidence)} | ${met ? 'yes' : '**no**'} |`);
  }
  lines.push('');
  lines.push('## What blocks a pilot');
  lines.push('');
  lines.push(`### Risks (${v.blockingRisks.length})`);
  lines.push('');
  lines.push('| Ref | Risk | What would clear it |');
  lines.push('|---|---|---|');
  for (const risk of v.blockingRisks) {
    lines.push(`| \`${risk.ref}\` | ${esc(risk.title)} | ${esc(risk.action)} |`);
  }
  lines.push('');
  lines.push(`### Decisions (${v.openDecisions})`);
  lines.push('');
  lines.push('| Ref | Decision | Blocks |');
  lines.push('|---|---|---|');
  for (const decision of FOUNDER_DECISIONS) {
    lines.push(`| \`${decision.ref}\` | ${esc(decision.title)} | ${esc(decision.blocks)} |`);
  }
  lines.push('');
  lines.push('## Build status, module by module');
  lines.push('');
  lines.push('The stage shown is the highest each module has GENUINELY reached. An interface existing');
  lines.push('is not a stage. `security_reviewed` requires an independent review, which has not taken');
  lines.push('place, so nothing here is above `tested`.');
  lines.push('');
  lines.push('| Stage | Modules |');
  lines.push('|---|---|');
  for (const stage of STAGE_ORDER) {
    const count = stageCounts.get(stage) ?? 0;
    if (count > 0) lines.push(`| \`${stage}\` | ${count} |`);
  }
  lines.push('');
  lines.push('| Module | Stage | What is simulated | Known limitations |');
  lines.push('|---|---|---|---|');
  for (const module of MODULES) {
    lines.push(
      `| ${esc(module.title)} | \`${module.stage}\` | ${esc(module.simulatedParts)} | ` +
      `${esc(module.knownLimitations)} |`,
    );
  }
  lines.push('');
  lines.push('## What works, stated as plainly as what does not');
  lines.push('');
  lines.push('- A payment runs from creation to completion with a balanced ledger, without anybody');
  lines.push('  touching the database.');
  lines.push('- Eleven partner failure scenarios can be produced deliberately, and each is handled:');
  lines.push('  a timeout stops rather than retries, a shortfall goes to suspense with an owner, a');
  lines.push('  return is a new event rather than a reversal.');
  lines.push('- The ledger balances in every currency, checked in SQL at start-up and on demand.');
  lines.push('- The audit chain verifies, and refusals are recorded as carefully as successes.');
  lines.push('- Separation of duties is refused at the state machine, at the service and at the');
  lines.push('  database — three independent times.');
  lines.push('- Every console renders for every role in a real browser, and the client makes no');
  lines.push('  request it is not entitled to make.');
  lines.push('- A compliance decision made today can be reconstructed from the record alone.');
  lines.push('');
  lines.push('## What does not work, or does not exist');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| No corridor is confirmed | A rule fires on every transaction. **No transaction in this build can clear compliance automatically.** Intended behaviour, not a defect |');
  lines.push('| No partner is real | Every partner is a simulator. No agreement with any institution has been confirmed |');
  lines.push('| No independent security review | Nothing in the risk register has reached `implemented_and_independently_reviewed` |');
  lines.push('| No restoration test | The procedure exists and has never been executed. Backups that have not been restored are not backups |');
  lines.push('| No antivirus | Document checks are structural and are not described as scanning anywhere |');
  lines.push('| No blob store | Documents are metadata-tracked and encrypted; no managed object store is connected |');
  lines.push('| No managed key store | The encryption key derives from process configuration on the same host as the data |');
  lines.push('| No partner callback authentication | No signature scheme exists, because no partner can call in. Must be designed before one is connected |');
  lines.push('| No access-pattern monitoring | Insider browsing is recorded and nobody is told |');
  lines.push('| No uptime measurement | Therefore no availability figure is claimed anywhere |');
  lines.push('| No subject access process | An individual has no route to request their data |');
  lines.push('| No accounting period close | The daily reconciliation is not a close and is not presented as one |');
  lines.push('| One person | Every separation of duties in the software is held by one pair of hands |');
  lines.push('');
  lines.push('## The shortest path to a pilot');
  lines.push('');
  lines.push('In dependency order. Steps 1 and 2 are not engineering, and nothing after them can start');
  lines.push('until they are done.');
  lines.push('');
  lines.push('1. **Attach the CBN Regulatory Sandbox application to this repository.** It resolves');
  lines.push('   FD-002, FD-003, FD-005, FD-006 and FD-007 between them, and until it exists no');
  lines.push('   transaction can clear compliance.');
  lines.push('2. **Contract a settlement partner and a screening provider**, and verify the licence');
  lines.push('   under which each activity is performed. FD-004.');
  lines.push('3. **Appoint a compliance officer and a second engineer.** R-16. No amount of further');
  lines.push('   engineering substitutes for this.');
  lines.push('4. **Commission an independent security review** and close its findings.');
  lines.push('5. **Perform and evidence a restoration test.** R-14.');
  lines.push('6. **Connect a managed key store and a virus-scanning service.** R-08 and R-12.');
  lines.push('7. **Complete the privacy impact assessment** and the cross-border transfer assessment.');
  lines.push('   FD-008.');
  lines.push('8. **Design partner callback authentication** before any partner is connected.');
  lines.push('9. **Rehearse the incident, continuity and recovery plans.** All three are written and');
  lines.push('   none has been practised.');
  lines.push('10. **Replace each placeholder under maker-checker**, and re-run this report.');
  lines.push('');
  lines.push('## The build journal');
  lines.push('');
  for (const entry of BUILD_JOURNAL) {
    lines.push(`### ${entry.milestone} — ${entry.date}`);
    lines.push('');
    lines.push(`**Built:** ${entry.built}`);
    lines.push('');
    lines.push(`**Still simulated:** ${entry.simulated}`);
    lines.push('');
    lines.push(`**Known limitations:** ${entry.limitations}`);
    lines.push('');
    lines.push(`**Open:** ${entry.open}`);
    lines.push('');
    lines.push(`**For the founder:** ${entry.questions}`);
    lines.push('');
  }

  emit('25-pilot-readiness-report.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// A — Founder decisions
// ---------------------------------------------------------------------------

function generateFounderDecisions() {
  const lines = [];
  lines.push('# A — Founder decisions required');
  lines.push('');
  lines.push(`${FOUNDER_DECISIONS.length} decisions. **All are open.** None has been approved.`);
  lines.push('');
  lines.push('## Why these exist');
  lines.push('');
  lines.push('The CBN Regulatory Sandbox application is the controlling source for the corridor, the');
  lines.push('limits, the settlement mechanism, the partner roles, the reporting obligations and the');
  lines.push('pilot terms. It was not available to this build.');
  lines.push('');
  lines.push('The instruction in that situation was explicit: do not invent a regulatory or commercial');
  lines.push('fact. So none has been invented. Each fact that would have come from the filing is either');
  lines.push('an `INSERT_APPROVED_*` placeholder that the software carries visibly through to every');
  lines.push('screen, or a decision below, or a statement the system simply refuses to make.');
  lines.push('');
  lines.push('Each decision carries one recommendation, not a menu. A menu is a way of not deciding.');
  lines.push('');
  lines.push('## What an approval here does and does not do');
  lines.push('');
  lines.push('Recording an approval in the Founder Learning Center records the founder\'s choice and');
  lines.push('writes an audit event. **It does not change any configuration.** The placeholder the');
  lines.push('decision governs must still be replaced through a maker-checker configuration change, by');
  lines.push('two different people. That separation is deliberate: a decision and its implementation');
  lines.push('are different acts and should leave different records.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Ref | Decision | Recommendation | Reversibility | Blocks |');
  lines.push('|---|---|---|---|---|');
  for (const decision of FOUNDER_DECISIONS) {
    lines.push(
      `| \`${decision.ref}\` | ${esc(decision.title)} | ${esc(decision.recommended)} | ` +
      `${decision.reversibility.replace(/_/g, ' ')} | ${esc(decision.blocks)} |`,
    );
  }
  lines.push('');
  lines.push('## Detail');
  lines.push('');
  for (const decision of FOUNDER_DECISIONS) {
    lines.push(`### ${decision.ref} — ${decision.title}`);
    lines.push('');
    lines.push('**Status:** awaiting approval');
    lines.push('');
    lines.push('**The issue**');
    lines.push('');
    lines.push(decision.context);
    lines.push('');
    lines.push('**Options considered**');
    lines.push('');
    lines.push('| Option | What follows from it |');
    lines.push('|---|---|');
    for (const option of decision.options) {
      lines.push(`| ${esc(option.option)} | ${esc(option.consequence)} |`);
    }
    lines.push('');
    lines.push(`**Recommended:** ${decision.recommended}`);
    lines.push('');
    lines.push(`**Main risk:** ${decision.risk}`);
    lines.push('');
    lines.push('| | |');
    lines.push('|---|---|');
    lines.push(`| Regulatory impact | ${esc(decision.regulatory)} |`);
    lines.push(`| Cost impact | ${esc(decision.cost)} |`);
    lines.push(`| Reversibility | ${decision.reversibility.replace(/_/g, ' ')} |`);
    lines.push(`| Blocks | ${esc(decision.blocks)} |`);
    lines.push('');
  }

  emit('A-founder-decisions.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// B — Claims lint
// ---------------------------------------------------------------------------

function generateClaimsLint() {
  const source = readFileSync(join(ROOT, 'scripts/lint-claims.mjs'), 'utf8');

  /** Pulls `{ pattern: /.../, [qualifier: /.../,] why: '...' }` entries out of the lint. */
  function entries(afterMarker) {
    const from = source.indexOf(afterMarker);
    const to = source.indexOf('\n];', from);
    const section = source.slice(from, to);
    return [...section.matchAll(
      /pattern:\s*(\/.+?\/[a-z]*),\s*\n(?:\s*qualifier:\s*(\/.+?\/[a-z]*),\s*\n)?\s*why:\s*((?:'(?:[^'\\]|\\.)*'\s*\+?\s*\n?\s*)+)/g,
    )].map((m) => ({
      pattern: m[1],
      qualifier: m[2] ?? null,
      why: m[3].trim().replace(/'\s*\+\s*\n?\s*'/g, '').replace(/^'|',?$/g, '').replace(/\\'/g, "'"),
    }));
  }

  const prohibited = entries('const PROHIBITED = [');
  const suspect = entries('const SUSPECT = [');

  const lines = [];
  lines.push('# B — Claims lint');
  lines.push('');
  lines.push('## What it is for');
  lines.push('');
  lines.push('The most likely way this project causes harm is not a technical failure. It is a');
  lines.push('sentence: a screen, a report or a slide claiming that EKORails holds customer funds,');
  lines.push('or has a regulatory approval it does not have, or guarantees a rate. None of those is');
  lines.push('true, and each is easy to write by accident when you are trying to sound confident.');
  lines.push('');
  lines.push('So the phrases are a lint, and the lint runs in the build. It scans every user-facing');
  lines.push('string in the repository and fails on language the entity is not entitled to use.');
  lines.push('');
  lines.push('## How a phrase is excused');
  lines.push('');
  lines.push('Three ways, all visible in review:');
  lines.push('');
  lines.push('1. The text NEGATES the phrase — "EKORails is not a bank" is not a claim to be a bank.');
  lines.push('2. The text QUOTES it as blocked language, which is what the lint\'s own word list does.');
  lines.push('3. The line, or the line above it, carries an explicit `claims-lint-allow: <reason>`');
  lines.push('   marker. This is the escape hatch, and it is deliberately noisy: a reviewer sees the');
  lines.push('   marker and the stated reason in the diff.');
  lines.push('');
  lines.push('## What it cannot do');
  lines.push('');
  lines.push('It covers this repository. It cannot police a slide deck, a website, an email or a');
  lines.push('conversation, and the same word list has to be applied to those by review before');
  lines.push('publication. That gap is recorded in the risk register.');
  lines.push('');
  lines.push('It also cannot catch a claim made in words it does not know. The list below is a');
  lines.push('starting point, not a proof of innocence.');
  lines.push('');
  lines.push('## The word list');
  lines.push('');
  lines.push(`### Prohibited (${prohibited.length}) — always a failure`);
  lines.push('');
  lines.push('| Pattern | Why it is refused |');
  lines.push('|---|---|');
  for (const entry of prohibited) {
    lines.push(`| \`${esc(entry.pattern)}\` | ${esc(entry.why)} |`);
  }
  lines.push('');
  lines.push(`### Suspect (${suspect.length}) — fine in context, wrong without it`);
  lines.push('');
  lines.push('These are phrases that are frequently, but not always, a misstatement. Each requires a');
  lines.push('qualifier on the same line or in the comment above it; without one it fails.');
  lines.push('');
  lines.push('| Pattern | Qualifier that excuses it | Why it is watched |');
  lines.push('|---|---|---|');
  for (const entry of suspect) {
    lines.push(`| \`${esc(entry.pattern)}\` | \`${esc(entry.qualifier ?? '—')}\` | ${esc(entry.why)} |`);
  }
  lines.push('');
  lines.push('## Running it');
  lines.push('');
  lines.push('```');
  lines.push('node scripts/lint-claims.mjs');
  lines.push('```');
  lines.push('');
  lines.push('It runs as part of `./scripts/test.sh` and in CI. A violation fails the build.');

  emit('B-claims-lint.md', lines.join('\n'));
}

// ---------------------------------------------------------------------------

generateDataModel();
generateApiReference();
generateStateMachine();
generateRoleMatrix();
generateComplianceMatrix();
generateTraceability();
generateRiskRegister();
generatePilotReadiness();
generateFounderDecisions();
generateClaimsLint();

if (CHECK) {
  if (differing.length === 0) {
    console.log('Generated documents are up to date.');
    process.exit(0);
  }
  console.error('These generated documents no longer match the code they describe:\n');
  for (const file of differing) console.error(`  - docs/${file}`);
  console.error('\nRun: node scripts/generate-docs.mjs');
  process.exit(1);
}

console.log(`Generated ${written.length} documents:`);
for (const file of written) console.log(`  docs/${file}`);
console.log('\nRelease gates referenced by these documents:');
for (const gate of RELEASE_GATES) console.log(`  ${gate.key}`);
