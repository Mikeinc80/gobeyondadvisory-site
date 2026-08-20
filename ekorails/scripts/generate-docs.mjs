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
const { FOUNDER_DECISIONS, RISK_REGISTER, BUILD_JOURNAL } = await import(join(DIST, 'seed/learning.js'));

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
generateRiskRegister();
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
