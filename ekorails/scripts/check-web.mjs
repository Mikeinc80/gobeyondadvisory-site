#!/usr/bin/env node
/**
 * Link check for the web client.
 *
 * The console has no build step, which buys a strict Content-Security-Policy and no
 * supply chain (founder decision FD-010) at the cost of the one thing a bundler gives you
 * for free: it tells you when a module imports a name that does not exist. Without that,
 * a renamed export fails at runtime, on one screen, for whichever role happens to open it
 * — which is exactly the kind of defect that survives a demonstration and appears during
 * a pilot.
 *
 * So this script does statically what a bundler would do:
 *
 *   1. Every named import resolves to a real export in the target module.
 *   2. Every view named in the router's ROUTES table exists in the module it comes from.
 *   3. Every path in the navigation has a matching route, and vice versa where a route is
 *      reachable from the menu.
 *   4. No module reaches for `innerHTML`, `eval` or `new Function` — the client's whole
 *      defence against server data becoming markup rests on that not happening.
 *
 * It parses rather than imports, because importing app.js would execute a browser
 * bootstrap in Node.
 *
 * Exit code 1 on any finding. Wired into scripts/test.sh so it runs in CI.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'apps/web/public/assets');

const problems = [];
const report = (file, message) => problems.push(`${file}: ${message}`);

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const files = readdirSync(ASSETS).filter((f) => f.endsWith('.js')).sort();
const sources = new Map(files.map((f) => [f, readFileSync(join(ASSETS, f), 'utf8')]));

/** Names a module exports. Covers the two forms this client actually uses. */
function exportsOf(source) {
  const names = new Set();
  for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/^export\s+(?:const|let|class)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(match[1]);
  }
  return names;
}

const exportsByFile = new Map([...sources].map(([file, source]) => [file, exportsOf(source)]));

// ---------------------------------------------------------------------------
// 1. Named imports resolve
// ---------------------------------------------------------------------------

for (const [file, source] of sources) {
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([A-Za-z0-9_.-]+)'/g)) {
    const target = match[2];
    const targetExports = exportsByFile.get(target);

    if (!targetExports) {
      report(file, `imports from './${target}', which does not exist`);
      continue;
    }

    const imported = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);

    for (const name of imported) {
      if (!targetExports.has(name)) {
        report(file, `imports { ${name} } from './${target}', which does not export it`);
      }
    }
  }

  // Namespace imports: `import * as x from './y.js'` — check the module exists.
  for (const match of source.matchAll(/import\s*\*\s*as\s+([A-Za-z0-9_$]+)\s*from\s*'\.\/([A-Za-z0-9_.-]+)'/g)) {
    if (!exportsByFile.has(match[2])) {
      report(file, `imports * as ${match[1]} from './${match[2]}', which does not exist`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Every route's view exists
// ---------------------------------------------------------------------------

const app = sources.get('app.js');
if (!app) {
  report('app.js', 'is missing; the console has no entry point');
} else {
  // Map the namespace alias each view module was imported under.
  const namespaces = new Map();
  for (const match of app.matchAll(/import\s*\*\s*as\s+([A-Za-z0-9_$]+)\s*from\s*'\.\/([A-Za-z0-9_.-]+)'/g)) {
    namespaces.set(match[1], match[2]);
  }

  const routePaths = new Set();
  for (const match of app.matchAll(/\{\s*path:\s*'([^']+)',\s*view:\s*([A-Za-z0-9_$]+)(?:\.([A-Za-z0-9_$]+))?/g)) {
    const [, path, first, second] = match;
    routePaths.add(path);

    if (second === undefined) {
      // A local function in app.js itself.
      if (!new RegExp(`function\\s+${first}\\b`).test(app)) {
        report('app.js', `route ${path} names view ${first}, which app.js does not define`);
      }
      continue;
    }

    const module = namespaces.get(first);
    if (!module) {
      report('app.js', `route ${path} uses namespace "${first}", which is not imported`);
      continue;
    }
    if (!exportsByFile.get(module)?.has(second)) {
      report('app.js', `route ${path} names ${first}.${second}, but ./${module} does not export ${second}`);
    }
  }

  // 3. Navigation targets must be routable.
  const navSection = app.slice(app.indexOf('const NAVIGATION'), app.indexOf('// Session state'));
  for (const match of navSection.matchAll(/path:\s*'([^']+)'/g)) {
    if (!routePaths.has(match[1])) {
      report('app.js', `navigation offers ${match[1]}, which has no route`);
    }
  }

  // Every ctx.navigate target with a literal path should be routable too. Dynamic
  // segments are skipped: a template literal cannot be checked without running it.
  for (const [file, source] of sources) {
    for (const match of source.matchAll(/navigate\('(\/[A-Za-z0-9/_-]*)'/g)) {
      const path = match[1].split('?')[0];
      if (path && !routePaths.has(path)) {
        report(file, `navigates to ${path}, which has no route`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. The rules the client's safety rests on
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  {
    pattern: /\.innerHTML\s*=/,
    why:
      'assigns innerHTML. The client\'s entire defence against server data becoming markup is that ' +
      'it never does this — h() sets text through textContent instead.',
  },
  {
    pattern: /\.outerHTML\s*=/,
    why: 'assigns outerHTML, which has the same effect as innerHTML.',
  },
  {
    pattern: /\beval\s*\(/,
    why: 'calls eval. The Content-Security-Policy forbids it, so this would fail at runtime anyway.',
  },
  {
    pattern: /new\s+Function\s*\(/,
    why: 'constructs a function from a string, which the Content-Security-Policy forbids.',
  },
  {
    pattern: /insertAdjacentHTML\s*\(/,
    why: 'inserts markup from a string.',
  },
  {
    // Number(x) on a money field silently rounds large naira amounts.
    pattern: /(?:Number|parseFloat)\s*\(\s*[A-Za-z0-9_$.]*(?:amount|balance|Amount|Balance)/,
    why:
      'converts a monetary value to a JavaScript number. Amounts are strings from the API to the ' +
      'screen precisely so that IEEE-754 never touches money.',
  },
];

for (const [file, source] of sources) {
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    // The rule in core.js that REFUSES innerHTML mentions it by name; so do the comments
    // explaining why these rules exist. Skip comment lines and string literals naming them.
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(line)) {
        report(`${file}:${index + 1}`, rule.why);
      }
    }
  });
}

// ---------------------------------------------------------------------------

if (problems.length === 0) {
  console.log(`Web client check: ${files.length} modules, no problems found.`);
  process.exit(0);
}

console.error(`Web client check found ${problems.length} problem(s):\n`);
for (const problem of problems) console.error(`  - ${problem}`);
process.exit(1);
