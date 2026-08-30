#!/usr/bin/env node
/**
 * Static checks for the GoBeyond Advisory site.
 *
 * These encode the defects that have actually bitten this site: Netlify forms
 * that silently discarded submissions, dead Cloudflare email-obfuscation links
 * left behind by saved HTML, cross-page anchors pointing at section ids that do
 * not exist, published briefs missing from the article index, and pages
 * shipping with no <title>.
 *
 * Zero dependencies, so `node scripts/check-site.mjs` works on a clean clone.
 */
import { readFileSync, existsSync } from 'node:fs';
import { SITE_ORIGIN, listHtml, listPages, canonicalUrl, read, stripTags } from './_pages.mjs';

const failures = [];
const warnings = [];
// Hard failure: the site is broken, misleading, or unreachable.
const fail = (file, msg) => failures.push(`${file}: ${msg}`);
// Advisory: worth knowing, but fixing it is an editorial call, not an engineering one.
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);
const STRICT = process.argv.includes('--strict');

const pages = listPages();
const allHtml = listHtml();
const docs = new Map(allHtml.map((f) => [f, read(f)]));
const idsByFile = new Map(
  [...docs].map(([f, s]) => [f, new Set([...s.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))])
);

/** Resolve an internal href to the file that serves it (extensionless URLs included). */
function resolveTarget(href, from) {
  const [path] = href.split('#');
  if (path === '') return from;
  const clean = path.split('?')[0].replace(/^\//, '');
  if (clean === '') return 'index.html';
  if (docs.has(clean)) return clean;
  if (docs.has(`${clean}.html`)) return `${clean}.html`;
  return null;
}

// ── 1. Head metadata ────────────────────────────────────────────────────────
for (const f of pages) {
  const s = docs.get(f);
  if (!/^<!DOCTYPE html>/i.test(s.trim())) fail(f, 'missing <!DOCTYPE html>');
  if (!/<html[^>]+lang=/i.test(s)) fail(f, 'missing lang attribute on <html>');
  if (!/<meta[^>]+charset=/i.test(s)) fail(f, 'missing charset');
  if (!/<meta[^>]+name="viewport"/i.test(s)) fail(f, 'missing viewport meta');

  const title = s.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (!title) fail(f, 'missing or empty <title>');
  else if (title.length > 70) warn(f, `<title> is ${title.length} chars; search results truncate near 70`);

  const desc = s.match(/<meta[^>]+name="description"[^>]*content="([^"]*)"/i)?.[1]?.trim();
  if (!desc) fail(f, 'missing meta description');
  else if (desc.length > 200) warn(f, `meta description is ${desc.length} chars; search results truncate near 160`);

  const canonical = s.match(/rel="canonical"[^>]*href="([^"]+)"/i)?.[1];
  if (!canonical) fail(f, 'missing rel="canonical"');
  else if (canonical !== canonicalUrl(f)) fail(f, `canonical is ${canonical}, expected ${canonicalUrl(f)}`);

  const h1 = (s.match(/<h1[\s>]/gi) ?? []).length;
  if (h1 !== 1) fail(f, `expected exactly one <h1>, found ${h1}`);
}

// ── 2. Links ────────────────────────────────────────────────────────────────
for (const [f, s] of docs) {
  for (const href of new Set([...s.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))) {
    if (href.includes('/cdn-cgi/')) {
      fail(f, `dead Cloudflare email-obfuscation link: ${href}`);
      continue;
    }
    if (/^(mailto:|tel:)/i.test(href)) continue;

    if (/^https?:/i.test(href)) {
      if (href.startsWith('http://')) fail(f, `insecure http:// link: ${href}`);
      if (!href.startsWith(SITE_ORIGIN)) continue; // off-site: checked separately by lychee
    }

    const local = href.startsWith(SITE_ORIGIN) ? href.slice(SITE_ORIGIN.length) || '/' : href;
    if (/^https?:/i.test(local)) continue;

    const target = resolveTarget(local, f);
    if (!target) {
      fail(f, `broken internal link: ${href}`);
      continue;
    }
    const frag = local.split('#')[1];
    if (frag && !idsByFile.get(target).has(frag)) {
      fail(f, `anchor #${frag} does not exist in ${target} (via ${href})`);
    }
  }

  for (const a of s.match(/<a\b[^>]*>/g) ?? []) {
    if (a.includes('target="_blank"') && !a.includes('noopener')) {
      fail(f, `target="_blank" without rel="noopener": ${a.slice(0, 90)}`);
    }
  }
}

// ── 3. Netlify forms ────────────────────────────────────────────────────────
// A form whose controls have no name attribute submits nothing at all.
for (const [f, s] of docs) {
  for (const form of s.match(/<form\b[\s\S]*?<\/form>/gi) ?? []) {
    const open = form.match(/<form\b[^>]*>/i)[0];
    const name = open.match(/\bname="([^"]+)"/)?.[1];
    if (!name) {
      fail(f, 'form has no name attribute');
      continue;
    }
    if (!/data-netlify="true"/.test(open)) fail(f, `form "${name}" is missing data-netlify="true"`);
    if (!/data-netlify-honeypot="bot-field"/.test(open)) fail(f, `form "${name}" has no honeypot`);

    const hidden = form.match(/<input[^>]+name="form-name"[^>]+value="([^"]+)"/)?.[1];
    if (hidden !== name) {
      fail(f, `form "${name}" needs <input type="hidden" name="form-name" value="${name}">`);
    }
    if (!/<input[^>]+name="bot-field"/.test(form)) fail(f, `form "${name}" declares a honeypot but has no bot-field input`);

    for (const ctrl of form.match(/<(input|select|textarea)\b[^>]*>/gi) ?? []) {
      if (/type="(hidden|submit|button)"/i.test(ctrl)) continue;
      if (!/\bname="/.test(ctrl)) fail(f, `form "${name}" control has no name attribute: ${ctrl.slice(0, 80)}`);
      const id = ctrl.match(/\bid="([^"]+)"/)?.[1];
      const isHoneypot = /name="bot-field"/.test(ctrl);
      if (!id && !isHoneypot) fail(f, `form "${name}" control has no id to label: ${ctrl.slice(0, 80)}`);
      if (id && !new RegExp(`<label[^>]+for="${id}"`).test(form)) {
        fail(f, `form "${name}" control #${id} has no associated <label for>`);
      }
    }
  }
}

// ── 4. Article index ────────────────────────────────────────────────────────
const articles = JSON.parse(readFileSync('articles.json', 'utf8'));
const seen = new Set();
for (const [i, a] of articles.entries()) {
  const where = `articles.json[${i}]`;
  for (const key of ['id', 'category', 'title', 'excerpt', 'date', 'published', 'url']) {
    if (typeof a[key] !== 'string' || !a[key].trim()) fail(where, `"${key}" must be a non-empty string`);
  }
  if (typeof a.featured !== 'boolean') fail(where, '"featured" must be a boolean');
  if (seen.has(a.id)) fail(where, `duplicate id "${a.id}"`);
  seen.add(a.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.published ?? '') || Number.isNaN(Date.parse(a.published))) {
    fail(where, `"published" must be an ISO date, got ${JSON.stringify(a.published)}`);
  }
  if (a.url !== `/${a.id}`) fail(where, `"url" should be "/${a.id}", got ${JSON.stringify(a.url)}`);
  if (!existsSync(`${a.id}.html`)) fail(where, `no page on disk for id "${a.id}"`);
  for (const key of Object.keys(a)) {
    if (!['id', 'featured', 'category', 'title', 'excerpt', 'date', 'published', 'url'].includes(key)) {
      fail(where, `unknown field "${key}"`);
    }
  }
}
const featured = articles.filter((a) => a.featured).length;
if (featured !== 1) fail('articles.json', `expected exactly one featured brief, found ${featured}`);

// Every article page on disk must appear in the index, or briefs go unpublished.
const NON_ARTICLE = new Set(['index.html', 'founders.html', 'briefs.html', 'success.html', '404.html']);
for (const f of pages) {
  if (NON_ARTICLE.has(f)) continue;
  if (!seen.has(f.replace(/\.html$/, ''))) fail(f, 'article page is not listed in articles.json');
}

// ── 5. Robots and sitemap ───────────────────────────────────────────────────
const sitemap = read('sitemap.xml');
for (const loc of [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])) {
  if (!loc.startsWith(`${SITE_ORIGIN}/`)) fail('sitemap.xml', `<loc> is not an absolute site URL: ${loc}`);
  const path = loc.slice(SITE_ORIGIN.length);
  if (path !== '/' && !resolveTarget(path, 'index.html')) fail('sitemap.xml', `<loc> does not resolve: ${loc}`);
}
if (/success/.test(sitemap)) fail('sitemap.xml', 'the form confirmation page must not be listed');
if (!read('robots.txt').includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)) {
  fail('robots.txt', 'missing or incorrect Sitemap: line');
}

// ── 6. Nothing sensitive in the tree ────────────────────────────────────────
const SECRETS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/\b(sk|pk)_live_[0-9a-zA-Z]{16,}/, 'live API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
];
for (const f of [...allHtml, 'article-loader.js', 'articles.json', 'netlify.toml']) {
  const s = read(f);
  for (const [rx, label] of SECRETS) if (rx.test(s)) fail(f, `possible ${label} committed`);
}

// ── Report ──────────────────────────────────────────────────────────────────
if (warnings.length) {
  console.warn(`\n⚠ ${warnings.length} advisory warning(s):\n`);
  for (const w of warnings) console.warn(`  ${w}`);
  console.warn('');
}
if (failures.length) {
  console.error(`✖ ${failures.length} problem(s) found:\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}
if (STRICT && warnings.length) {
  console.error('✖ --strict: warnings are treated as failures.\n');
  process.exit(1);
}
console.log(`✔ site checks passed — ${pages.length} pages, ${articles.length} briefs, 0 problems.`);
