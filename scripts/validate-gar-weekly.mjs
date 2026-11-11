// Run from any directory. With --write, refresh the static episode list from the editorial catalog.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'articles.json'), 'utf8'));
const byId = new Map(catalog.map(row => [row.id, row]));
const episodes = catalog.filter(row => row.type === 'gar-weekly');
const numbers = new Set();
const escape = value => value.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function checkedText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing ' + name);
  return escape(value.trim());
}
function paragraphs(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('A transcript needs at least one paragraph');
  return lines.map(line => '<p>' + checkedText(line, 'transcript paragraph') + '</p>').join('\n');
}
function sourceLink(source) {
  const url = new URL(source.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use a public HTTPS citation');
  return '<li><a href="' + escape(url.href) + '">' + checkedText(source.title, 'citation title') + '</a></li>';
}
function relatedLink(id) {
  const row = byId.get(id);
  if (!row || row.type === 'gar-weekly' || !/^\/(?!\/)[\w/-]+(?:\.html)?$/.test(row.url)) {
    throw new Error('Related brief must reference an existing local brief: ' + id);
  }
  return '<li><a href="' + escape(row.url) + '">' + checkedText(row.title, 'brief title') + '</a></li>';
}
function episode(row) {
  const n = row.episode;
  if (!Number.isSafeInteger(n) || n <= 0 || numbers.has(n)) throw new Error('Invalid or duplicate episode ' + n);
  numbers.add(n);
  const fragment = 'episode-' + String(n).padStart(3, '0');
  if (row.id !== 'gar-' + fragment || catalog.filter(item => item.id === row.id).length !== 1 ||
      row.url !== '/ai-reliability/weekly#' + fragment) throw new Error('Invalid episode id or permalink for ' + n);
  if (row.category !== 'GAR Weekly' || !row.date) throw new Error('Missing GAR Weekly catalog metadata');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.published) ||
      new Date(row.published).toISOString().slice(0,10) !== row.published ||
      row.published > new Date().toISOString().slice(0,10)) throw new Error('Invalid release date');
  if (!/^[\w-]{11}$/.test(row.youtubeId || '')) throw new Error('Invalid YouTube ID');
  if (!Array.isArray(row.sources) || !row.sources.length) throw new Error('Add the research citations');
  if (!Array.isArray(row.relatedIds) || !row.relatedIds.length) throw new Error('Link a related Intelligence Brief');
  const title = checkedText(row.title, 'title');
  const published = new Intl.DateTimeFormat('en', {dateStyle:'long', timeZone:'UTC'}).format(new Date(row.published));
  return `<article class="weekly-episode" id="${fragment}">
        <span class="eyebrow">Episode ${String(n).padStart(3, '0')} · <time datetime="${row.published}">${published}</time></span>
        <h3>${title}</h3>
        <p>${checkedText(row.excerpt, 'description')}</p>
        <p>Loading the player connects your browser to YouTube.</p>
        <button type="button" data-video="${row.youtubeId}" data-title="${title}">Load YouTube player</button>
        <a href="https://www.youtube.com/watch?v=${row.youtubeId}">Watch on YouTube</a>
        <details><summary>Transcript</summary>${paragraphs(row.transcript)}</details>
        <h4>Research citations</h4><ul>${row.sources.map(sourceLink).join('')}</ul>
        <h4>Related Intelligence Briefs</h4><ul>${row.relatedIds.map(relatedLink).join('')}</ul>
      </article>`;
}
const entries = episodes.sort((a,b) => b.published.localeCompare(a.published) || b.episode-a.episode).map(episode);
const file = path.join(root, 'ai-reliability/weekly/index.html');
const html = fs.readFileSync(file, 'utf8');
const block = /<!-- GAR:START -->[\s\S]*?<!-- GAR:END -->/;
if (!block.test(html)) throw new Error('Weekly page is missing its catalog markers');
const content = entries.join('\n      ') || '<div class="weekly-empty"><p>No episodes have been published yet.</p></div>';
const rendered = html.replace(block, () => '<!-- GAR:START -->\n      ' + content + '\n      <!-- GAR:END -->');
if (process.argv.includes('--write')) fs.writeFileSync(file, rendered);
else if (html !== rendered) throw new Error('Weekly page is stale. Run with --write and commit the rendered page.');
console.log('GAR Weekly catalog and static hub verified. Published episodes: ' + episodes.length);
