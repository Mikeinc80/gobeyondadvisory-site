import { readdirSync, readFileSync } from 'node:fs';

export const SITE_ORIGIN = 'https://gobeyondadvisory.com';

/** Files that live in the publish root but are not indexable pages. */
export const NON_PAGE_HTML = new Set(['404.html']);

export const listHtml = (dir = '.') =>
  readdirSync(dir).filter((f) => f.endsWith('.html')).sort();

/** Public pages, excluding utility pages that must stay out of the sitemap. */
export const listPages = (dir = '.') =>
  listHtml(dir).filter((f) => !NON_PAGE_HTML.has(f));

/** Canonical public URL for a page file. The site serves extensionless URLs. */
export const canonicalUrl = (file) =>
  file === 'index.html' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}/${file.replace(/\.html$/, '')}`;

export const read = (f) => readFileSync(f, 'utf8');

export const stripTags = (s) =>
  s
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
