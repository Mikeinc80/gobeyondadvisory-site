#!/usr/bin/env node
/**
 * Keeps .env.example honest.
 *
 * Two failures, both quiet and both expensive:
 *
 *   1. The code reads a variable that .env.example does not mention. Somebody deploys
 *      without it, the default applies, and nobody finds out until the default is wrong.
 *   2. .env.example documents a variable nothing reads. Somebody sets it, believes it took
 *      effect, and operates on a false belief about the system's configuration. For a knob
 *      like a release gate, that belief is dangerous.
 *
 * The second is the one worth having a check for. A setting that does nothing is worse
 * than a missing setting, because a missing setting eventually announces itself.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCAN = [join(ROOT, 'services/api/src'), join(ROOT, 'scripts')];
const SKIP = new Set(['node_modules', 'dist', '.git']);

/** Variables the runtime injects or that only a test harness sets. */
const EXEMPT = new Set([
  'NODE_ENV',
  'EKORAILS_SEED_PASSPHRASE',   // read only by the browser smoke test
  'EKORAILS_SMOKE_PORT',        // read only by the browser smoke test
  'PLAYWRIGHT_BROWSERS_PATH',   // set by the environment, not by this project
]);

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (['.ts', '.mjs', '.js', '.sh'].includes(extname(path))) files.push(path);
  }
  return files;
}

const used = new Map();

// The release gates are read as process.env[gate.key], so no pattern over the source can
// see them. Take the names from the code's own list — which is the right source anyway,
// since that list is what the environment check actually consults.
try {
  const { RELEASE_GATES } = await import(join(ROOT, 'services/api/dist/src/core/env.js'));
  for (const gate of RELEASE_GATES) {
    used.set(gate.key, new Set(['services/api/src/core/env.ts (RELEASE_GATES)']));
  }
} catch {
  console.error('The API is not built, so the release gates cannot be resolved.');
  console.error('Run: npx tsc -p services/api/tsconfig.json');
  process.exit(2);
}

for (const directory of SCAN) {
  for (const file of walk(directory)) {
    const source = readFileSync(file, 'utf8');
    const patterns = [
      /process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
      /process\.env\.([A-Z][A-Z0-9_]*)/g,
      /\$\{?(EKORAILS_[A-Z0-9_]*)/g,
    ];
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        if (EXEMPT.has(match[1])) continue;
        if (!used.has(match[1])) used.set(match[1], new Set());
        used.get(match[1]).add(file.replace(`${ROOT}/`, ''));
      }
    }
  }
}

const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
const documented = new Set(
  [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
);

const undocumented = [...used.keys()].filter((name) => !documented.has(name)).sort();
const unused = [...documented].filter((name) => !used.has(name)).sort();

if (undocumented.length === 0 && unused.length === 0) {
  console.log(`.env.example: ${documented.size} variables, all of them read by the code.`);
  process.exit(0);
}

if (undocumented.length > 0) {
  console.error('Read by the code and NOT documented in .env.example:\n');
  for (const name of undocumented) {
    console.error(`  - ${name}   (${[...used.get(name)].join(', ')})`);
  }
  console.error('');
}
if (unused.length > 0) {
  console.error('Documented in .env.example and read by NOTHING:\n');
  for (const name of unused) console.error(`  - ${name}`);
  console.error('\nA setting that does nothing is worse than a missing one: somebody will set it');
  console.error('and believe it took effect.\n');
}
process.exit(1);
