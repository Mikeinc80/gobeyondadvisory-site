#!/usr/bin/env node
/**
 * Mutation tests for scripts/check-site.mjs.
 *
 * A validator that never fails is worthless. Each case below copies the site to
 * a temporary directory, reintroduces a defect this repository has actually had,
 * and asserts the checker rejects it with the expected message.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CASES = [
  {
    name: 'form control without a name attribute is rejected',
    expect: 'control has no name attribute',
    mutate: (d) => edit(d, 'index.html', (s) => s.replace(' name="email" type="email"', ' type="email"')),
  },
  {
    name: 'missing hidden form-name input is rejected',
    expect: 'needs <input type="hidden" name="form-name"',
    mutate: (d) => edit(d, 'index.html', (s) => s.replace('<input type="hidden" name="form-name" value="contact"/>', '')),
  },
  {
    name: 'missing honeypot is rejected',
    expect: 'has no honeypot',
    mutate: (d) => edit(d, 'index.html', (s) => s.replace(' data-netlify-honeypot="bot-field"', '')),
  },
  {
    name: 'dead Cloudflare email-obfuscation link is rejected',
    expect: 'dead Cloudflare email-obfuscation link',
    mutate: (d) => edit(d, 'briefs.html', (s) => s.replace('href="index.html"', 'href="/cdn-cgi/l/email-protection#83f3"')),
  },
  {
    name: 'anchor pointing at a non-existent section id is rejected',
    expect: 'anchor #focus does not exist',
    mutate: (d) => edit(d, 'briefs.html', (s) => s.replace('index.html#advisory', 'index.html#focus')),
  },
  {
    name: 'broken internal link is rejected',
    expect: 'broken internal link',
    mutate: (d) => edit(d, 'briefs.html', (s) => s.replace('href="founders.html"', 'href="/leadership-team"')),
  },
  {
    name: 'page without a title is rejected',
    expect: 'missing or empty <title>',
    mutate: (d) => edit(d, 'success.html', (s) => s.replace(/<title>[\s\S]*?<\/title>/, '')),
  },
  {
    name: 'wrong canonical URL is rejected',
    expect: 'canonical is',
    mutate: (d) => edit(d, 'briefs.html', (s) => s.replace('https://www.gobeyondadvisory.com/briefs', 'https://example.com/briefs')),
  },
  {
    name: 'article page missing from articles.json is rejected',
    expect: 'not listed in articles.json',
    mutate: (d) => editJson(d, (a) => a.filter((x) => x.id !== 'article-pentagon-brief')),
  },
  {
    name: 'duplicate article id is rejected',
    expect: 'duplicate id',
    mutate: (d) => editJson(d, (a) => [...a, { ...a[0] }]),
  },
  {
    name: 'more than one featured brief is rejected',
    expect: 'expected exactly one featured brief',
    mutate: (d) => editJson(d, (a) => a.map((x, i) => (i < 2 ? { ...x, featured: true } : x))),
  },
  {
    name: 'non-ISO published date is rejected',
    expect: '"published" must be an ISO date',
    mutate: (d) => editJson(d, (a) => a.map((x, i) => (i ? x : { ...x, published: 'March 2026' }))),
  },
  {
    name: 'target="_blank" without rel="noopener" is rejected',
    expect: 'without rel="noopener"',
    mutate: (d) => edit(d, 'index.html', (s) => s.replace(' target="_blank" rel="noopener"', ' target="_blank"')),
  },
  {
    name: 'committed AWS key is rejected',
    expect: 'possible AWS access key id',
    mutate: (d) => edit(d, 'articles.json', (s) => s.replace('"id"', '"AKIAIOSFODNN7EXAMPLE": 1, "id"')),
  },
  {
    name: 'confirmation page listed in the sitemap is rejected',
    expect: 'confirmation page must not be listed',
    mutate: (d) =>
      edit(d, 'sitemap.xml', (s) =>
        s.replace('</urlset>', '  <url><loc>https://www.gobeyondadvisory.com/success</loc></url>\n</urlset>')
      ),
  },
];

function edit(dir, file, fn) {
  const p = join(dir, file);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`mutation for ${file} changed nothing — the test is stale`);
  writeFileSync(p, after);
}

function editJson(dir, fn) {
  const p = join(dir, 'articles.json');
  writeFileSync(p, JSON.stringify(fn(JSON.parse(readFileSync(p, 'utf8'))), null, 2) + '\n');
}

const run = (cwd) => spawnSync(process.execPath, ['scripts/check-site.mjs'], { cwd, encoding: 'utf8' });

let passed = 0;
const failed = [];

// The unmutated site must pass, or every case below proves nothing.
const baseline = run(process.cwd());
if (baseline.status !== 0) {
  console.error('✖ baseline: check-site.mjs fails on the unmodified site\n' + baseline.stderr);
  process.exit(1);
}
console.log('✔ baseline: unmodified site passes');

for (const c of CASES) {
  const dir = mkdtempSync(join(tmpdir(), 'gba-'));
  try {
    for (const f of readdirSync('.').filter((f) => f.endsWith('.html'))) cpSync(f, join(dir, f));
    for (const f of ['scripts', 'articles.json', 'sitemap.xml', 'robots.txt', 'article-loader.js', 'netlify.toml']) {
      cpSync(f, join(dir, f), { recursive: true });
    }

    c.mutate(dir);
    const r = run(dir);
    const output = r.stdout + r.stderr;
    if (r.status === 0) failed.push(`${c.name} — checker passed but should have failed`);
    else if (!output.includes(c.expect)) failed.push(`${c.name} — expected "${c.expect}", got:\n${output}`);
    else {
      passed++;
      console.log(`✔ ${c.name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('');
if (failed.length) {
  console.error(`✖ ${failed.length} mutation test(s) failed:\n`);
  for (const f of failed) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log(`✔ ${passed}/${CASES.length} mutation tests passed.`);
