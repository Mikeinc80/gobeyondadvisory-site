#!/usr/bin/env node
/**
 * Catches a number written in prose that the code has since moved past.
 *
 * The documents that describe mechanism are generated, so they cannot drift. Prose can, and
 * the way it drifts is a count: "22 rules" written when there were 22, still there when
 * there are 26. Nobody notices, because the sentence still reads correctly.
 *
 * This is not a general fact-checker, and it is deliberately narrow.
 *
 * A first version matched any number before "rules", "roles" or "decisions" and produced
 * eighteen findings, sixteen of them nonsense: "three database roles" is not a claim about
 * the nine user roles, and "Three rules" heading a section about design principles is not a
 * claim about the compliance rule count. A check that cries wolf gets switched off, and
 * then the two real findings it did have — a nine that should have been a ten, twice — go
 * unnoticed along with everything else.
 *
 * So each pattern below requires the FULL unambiguous phrase. It catches less. What it
 * catches is real.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'services/api/dist/src');

const { RULES } = await import(join(DIST, 'modules/compliance/rules.js'));
const { RELEASE_GATES } = await import(join(DIST, 'core/env.js'));
const { TRANSITIONS } = await import(join(DIST, 'modules/settlement/machine.js'));
const { MODULES, FOUNDER_DECISIONS } = await import(join(DIST, 'seed/learning.js'));

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty',
];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

/** Renders a number the way a person writes it, so the pattern can look for both forms. */
function spellings(n) {
  const forms = [String(n)];
  if (n <= 20) forms.push(WORDS[n]);
  else {
    for (const [word, value] of Object.entries(TENS)) {
      if (n > value && n < value + 10) forms.push(`${word}-${WORDS[n - value]}`);
      if (n === value) forms.push(word);
    }
  }
  return forms.filter(Boolean);
}

const COUNTS = [
  {
    subject: 'compliance rules',
    actual: RULES.length,
    // "26 compliance rules" and "twenty-six compliance rules". NOT bare "rules", which
    // heads sections about design principles far more often than it counts the catalogue.
    noun: 'compliance rules',
  },
  {
    subject: 'founder decisions',
    actual: FOUNDER_DECISIONS.length,
    // NOT bare "decisions" — compliance decisions are a different and far commoner thing.
    noun: 'founder decisions',
  },
  {
    subject: 'release gates',
    actual: RELEASE_GATES.length,
    noun: 'release gates',
  },
  {
    subject: 'declared state transitions',
    actual: TRANSITIONS.length,
    noun: 'declared transitions',
  },
  {
    subject: 'learning modules',
    actual: MODULES.length,
    // The brief specifies sixteen modules and the seed carries sixteen. "16 modules" is a
    // sentence people write; "modules" alone is not a count of anything in particular.
    noun: 'modules',
    requirePrefix: true,
  },
];

const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage']);
const EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.md', '.html']);

// Generated documents are regenerated from the same values, so a mismatch there is
// impossible by construction and checking them would just be noise.
const GENERATED = /^<!--\s*\n\s*GENERATED FILE/;

function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    if (SKIP.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (EXTENSIONS.has(extname(path))) files.push(path);
  }
  return files;
}

const problems = [];

for (const file of walk(ROOT)) {
  const source = readFileSync(file, 'utf8');
  if (GENERATED.test(source)) continue;
  const relative = file.replace(`${ROOT}/`, '');
  const lines = source.split('\n');

  for (const count of COUNTS) {
    // The number must sit immediately before the full phrase. Anything looser produced
    // sixteen false positives for two real findings.
    const pattern = new RegExp(`\\b([0-9]{1,3}|[a-z]+(?:-[a-z]+)?)[ -]${count.noun}\\b`, 'gi');
    const valid = new Set(spellings(count.actual).map((f) => f.toLowerCase()));

    lines.forEach((line, index) => {
      for (const match of line.matchAll(pattern)) {
        const written = match[1].toLowerCase();
        // Only judge things that are actually numbers. "the rules", "risk rules" are not.
        const isNumeric = /^[0-9]+$/.test(written);
        const isWord = WORDS.includes(written) || Object.keys(TENS).includes(written)
          || /^(twenty|thirty|forty|fifty)-[a-z]+$/.test(written);
        if (!isNumeric && !isWord) continue;
        if (valid.has(written)) continue;

        problems.push(
          `${relative}:${index + 1}  says "${match[0].trim()}" — there are ${count.actual} ${count.subject}`,
        );
      }
    });
  }
}

if (problems.length === 0) {
  console.log(`Counts written in prose match the code (${COUNTS.length} figures checked).`);
  process.exit(0);
}

console.error('A number written in prose no longer matches the code:\n');
for (const problem of problems) console.error(`  - ${problem}`);
console.error('\nEither the sentence is stale, or the change was not intended.');
process.exit(1);
