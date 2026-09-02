#!/usr/bin/env node
/**
 * Regenerates sitemap.xml from the pages on disk and articles.json.
 *
 *   node scripts/build-sitemap.mjs           write sitemap.xml
 *   node scripts/build-sitemap.mjs --check   exit 1 if the committed file is stale
 *
 * lastmod for an article comes from its `published` date in articles.json.
 * Where a brief states only a month, that date is the first of the month —
 * lastmod is a crawl hint, not a claim about the content.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { SITE_ORIGIN, canonicalUrl, listPages, read } from './_pages.mjs';

// Pages that exist but must never be advertised to crawlers.
const NOINDEX = new Set(['success.html']);

const articles = JSON.parse(readFileSync('articles.json', 'utf8'));
const publishedById = new Map(articles.map((a) => [a.id, a.published]));

const priorityFor = (file) => (file === 'index.html' ? '1.0' : file === 'briefs.html' ? '0.9' : '0.8');

const rows = listPages()
  .filter((f) => !NOINDEX.has(f) && !/noindex/i.test(read(f)))
  .map((file) => ({
    loc: canonicalUrl(file),
    lastmod: publishedById.get(file.replace(/\.html$/, '')) ?? null,
    priority: priorityFor(file),
  }))
  .sort((a, b) => Number(b.priority) - Number(a.priority) || a.loc.localeCompare(b.loc));

// Home page tracks the newest brief, since the index renders the brief grid.
const newest = articles.map((a) => a.published).filter(Boolean).sort().at(-1);
for (const r of rows) if (r.loc === `${SITE_ORIGIN}/`) r.lastmod = newest;

const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  rows
    .map(
      (r) =>
        '  <url>\n' +
        `    <loc>${r.loc}</loc>\n` +
        (r.lastmod ? `    <lastmod>${r.lastmod}</lastmod>\n` : '') +
        '    <changefreq>monthly</changefreq>\n' +
        `    <priority>${r.priority}</priority>\n` +
        '  </url>\n'
    )
    .join('') +
  '</urlset>\n';

if (process.argv.includes('--check')) {
  const current = readFileSync('sitemap.xml', 'utf8');
  if (current !== xml) {
    console.error('sitemap.xml is stale. Run: node scripts/build-sitemap.mjs');
    process.exit(1);
  }
  console.log(`sitemap.xml is up to date (${rows.length} URLs).`);
} else {
  writeFileSync('sitemap.xml', xml);
  console.log(`Wrote sitemap.xml (${rows.length} URLs).`);
}
