#!/usr/bin/env node
/**
 * Claims lint.
 *
 * Scans user-facing text for language EKORails is not entitled to use, and fails the
 * build when it finds any. This exists because the regulatory boundary is easiest to
 * breach by accident: a phrase like "your EKORails balance" or "guaranteed rate" appears
 * in a screen, then in a deck, then in a conversation with a bank, and by then it is a
 * claim the company has made.
 *
 * Two categories:
 *
 *   PROHIBITED  Language that asserts something untrue about EKORails' status or about
 *               what a rate or a settlement guarantees. Always a failure.
 *
 *   SUSPECT     Language that is fine in context but is frequently wrong. Requires an
 *               adjacent qualifier on the same line or in the preceding comment; otherwise
 *               it is a failure.
 *
 * The lint deliberately scans this repository's own strings. It cannot police a slide
 * deck, and the risk register says so (R-15).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SCAN_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.html', '.css', '.sql', '.md', '.json']);

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'coverage']);

/** Files whose whole purpose is to name the prohibited language. */
const SELF_REFERENTIAL = new Set([
  'scripts/lint-claims.mjs',
  'docs/B-claims-lint.md',
]);

const PROHIBITED = [
  {
    pattern: /\bguaranteed\s+(rate|fx|exchange\s+rate|price)\b/i,
    why: 'No rate is guaranteed. A rate is indicative until accepted, and locked only where a partner has contractually locked it.',
  },
  {
    pattern: /\b(no|zero)\s+spread\b/i,
    why: 'There is a spread, and it is stored as an explicit field. Claiming otherwise is untrue.',
  },
  {
    pattern: /\bzero\s+(loss|fees?)\b/i,
    why: 'Fees exist and are itemised. "Zero fees" usually means the fee is hidden in the rate.',
  },
  {
    pattern: /\bbest\s+(market\s+)?rate\b/i,
    why: 'An unprovable superlative. Show the reference rate and the spread instead.',
  },
  {
    pattern: /\bcbn[- ]?(approved|licensed|authorised|authorized|regulated)\b/i,
    why: 'Sandbox admission is not confirmed (founder decision FD-009). Nothing may imply it.',
  },
  {
    pattern: /\bsandbox\s+participant\b/i,
    why: 'EKORails does not claim to be an admitted sandbox participant.',
  },
  {
    pattern: /\b(we|ekorails)\s+(hold|holds|custody\s+of|safeguard|safeguards)\s+(your\s+)?(customer\s+)?funds?\b/i,
    why: 'EKORails is not authorised to hold customer funds. Funds are held by licensed partners.',
  },
  {
    pattern: /\byour\s+ekorails\s+(balance|wallet|account\s+balance)\b/i,
    why: 'There is no customer stored-value balance. Implying one implies custody.',
  },
  {
    pattern: /\bekorails\s+(is\s+)?(a\s+)?(licensed|regulated|authorised|authorized)\b/i,
    why: 'EKORails holds no licence that has been verified to this build.',
  },
  {
    pattern: /\binstant\s+settlement\b/i,
    why: 'Settlement timing depends on partners and corridors and cannot be promised.',
  },
  {
    pattern: /\bfully\s+compliant\b/i,
    why: 'Compliance is assessed by a supervisor, not asserted by a vendor.',
  },
  {
    pattern: /\bbank[- ]grade\s+(security|encryption)\b/i,
    why: 'A marketing phrase with no definition. State the actual control instead.',
  },
  {
    pattern: /\bmilitary[- ]grade\s+encryption\b/i,
    why: 'Meaningless. Name the algorithm and the key length.',
  },
  {
    pattern: /\bafrican\s+data\s+residency\b/i,
    why: 'Residency follows the deployment region and a completed assessment (FD-008), not ownership.',
  },
  {
    pattern: /\b100%\s+(secure|safe|accurate|uptime)\b/i,
    why: 'Nothing is 100% secure or accurate, and uptime is not measured in this build.',
  },
];

const SUSPECT = [
  {
    pattern: /\bsettlement\s+finality\b/i,
    qualifier: /(not|cannot|no simulator|out of scope|conferred by|legal property|does not)/i,
    why: 'Settlement finality is a legal property this system cannot confer. Mentioning it requires an adjacent disclaimer.',
  },
  {
    pattern: /\blocked\s+(rate|until)\b/i,
    qualifier: /(contractual|partner has|lock_evidence|cannot lock|only where|simulated)/i,
    why: 'A rate may be described as locked only where a partner has contractually locked it.',
  },
  {
    pattern: /\breal[- ]time\b/i,
    qualifier: /(not|simulated|would be|in a live|aspiration)/i,
    why: 'Nothing in this build is real-time; partner interactions are simulated.',
  },
  {
    pattern: /\bAI\s+(verif|validat|confirm|check)/i,
    qualifier: /(not conclusive|proposal|advisory|human|never used|must confirm|proposed)/i,
    why: 'AI extraction is advisory. It must never be described as verifying or confirming anything.',
  },
];

/**
 * A prohibited phrase is excused when the surrounding text plainly DISCLAIMS it rather
 * than asserting it. Three ways that happens legitimately:
 *
 *   1. It is negated: "EKORails is NOT a licensed payment provider".
 *   2. It is quoted as an example of language the lint itself blocks.
 *   3. A reviewer has added an explicit allow marker with a stated reason.
 *
 * The negation window is the preceding line plus the text before the match on this line,
 * because prose wraps and a disclaimer often begins on the line above. The window is
 * bounded rather than whole-file: a "not" three paragraphs away must not excuse a claim.
 */
const NEGATORS =
  /\b(not|never|no|cannot|can'?t|must not|does not|do not|refus\w*|prohibit\w*|forbid\w*|disclaim\w*|reject\w*|blocked|unsupported|untrue|without)\b/i;

const LINT_SELF_REFERENCE =
  /(claims lint|lint fails|fails the build|prohibited|word list|marketing language|must never|is not entitled)/i;

const ALLOW_MARKER = /claims-lint-allow:\s*(.+)$/;

function isDisclaimed(lines, index, matchText) {
  const line = lines[index] ?? '';
  const previous = lines[index - 1] ?? '';

  if (ALLOW_MARKER.test(line) || ALLOW_MARKER.test(previous)) return true;
  if (LINT_SELF_REFERENCE.test(line) || LINT_SELF_REFERENCE.test(previous)) return true;

  const position = line.toLowerCase().indexOf(matchText.toLowerCase());
  const before = (previous + ' ' + (position >= 0 ? line.slice(0, position) : line)).slice(-160);
  return NEGATORS.test(before);
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, files);
    else if (SCAN_EXTENSIONS.has(extname(entry))) files.push(full);
  }
  return files;
}

const findings = [];
let filesScanned = 0;
let linesScanned = 0;

for (const file of walk(ROOT)) {
  const relativePath = relative(ROOT, file);
  if (SELF_REFERENTIAL.has(relativePath)) continue;

  filesScanned += 1;
  const lines = readFileSync(file, 'utf8').split('\n');
  linesScanned += lines.length;

  lines.forEach((line, index) => {
    for (const rule of PROHIBITED) {
      const match = line.match(rule.pattern);
      if (!match) continue;
      if (isDisclaimed(lines, index, match[0])) continue;
      findings.push({
        severity: 'PROHIBITED', file: relativePath, line: index + 1,
        text: line.trim().slice(0, 140), why: rule.why,
      });
    }
    for (const rule of SUSPECT) {
      if (!rule.pattern.test(line)) continue;
      // A qualifier may sit on the same line or in the two lines before it, which is where
      // an explanatory comment usually lives.
      const context = [lines[index - 2] ?? '', lines[index - 1] ?? '', line, lines[index + 1] ?? ''].join(' ');
      if (rule.qualifier.test(context)) continue;
      if (ALLOW_MARKER.test(line) || ALLOW_MARKER.test(lines[index - 1] ?? '')) continue;
      findings.push({
        severity: 'UNQUALIFIED', file: relativePath, line: index + 1,
        text: line.trim().slice(0, 140), why: rule.why,
      });
    }
  });
}

process.stdout.write(
  `\nClaims lint: scanned ${filesScanned} files, ${linesScanned.toLocaleString('en-GB')} lines.\n`,
);

if (findings.length === 0) {
  process.stdout.write(
    `No prohibited or unqualified claims found.\n\n` +
    `A phrase is excused only where the text negates it, quotes it as blocked language,\n` +
    `or carries an explicit "claims-lint-allow: <reason>" marker on the line or the line\n` +
    `above. Each of those is visible in review.\n\n` +
    `Note: this lint covers this repository only. It cannot police a slide deck, a\n` +
    `website or a conversation. Apply the same word list to external material by\n` +
    `review before publication (risk register entry R-15).\n\n`,
  );
  process.exit(0);
}

process.stdout.write(`\n${findings.length} finding(s):\n\n`);
for (const finding of findings) {
  process.stdout.write(
    `  [${finding.severity}] ${finding.file}:${finding.line}\n` +
    `      ${finding.text}\n` +
    `      Why: ${finding.why}\n\n`,
  );
}
process.stdout.write('Build failed: unsupported language must be corrected before merge.\n\n');
process.exit(1);
