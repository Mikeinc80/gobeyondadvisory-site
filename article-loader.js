/**
 * GoBeyond Advisory — intelligence brief card loader.
 *
 * Progressive enhancement: #gba-articles-grid ships with a static fallback link
 * in index.html. If this script runs and /articles.json loads, the fallback is
 * replaced with the full card grid. If either fails, the fallback stays put, so
 * the section is never empty.
 */
(function () {
  'use strict';

  var CONTAINER_ID = 'gba-articles-grid';
  var JSON_PATH = '/articles.json';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Newest first. Entries without a parseable date sort last, preserving order.
  function byPublishedDesc(a, b) {
    var x = Date.parse(a.published), y = Date.parse(b.published);
    if (isNaN(x) && isNaN(y)) return 0;
    if (isNaN(x)) return 1;
    if (isNaN(y)) return -1;
    return y - x;
  }

  function card(article, isFeatured) {
    var tag = (isFeatured ? '⭐ Featured · ' : '') + esc(article.category);
    return '<a href="' + esc(article.url) + '" class="insight-card' + (isFeatured ? ' featured' : '') + '">' +
      (isFeatured ? '<div>' : '') +
        '<div class="insight-tag">' + tag + '</div>' +
        '<div class="insight-title">' + esc(article.title) + '</div>' +
        '<div class="insight-body">' + esc(article.excerpt) + '</div>' +
        '<div class="insight-date">' + esc(article.date) + (isFeatured ? ' · gobeyondadvisory.com' : '') + '</div>' +
      (isFeatured ? '</div><div class="insight-cta-btn">Read Brief →</div>'
                  : '<div class="insight-cta">Read Brief →</div>') +
    '</a>';
  }

  function injectStyles() {
    if (document.getElementById('gba-loader-styles')) return;
    var s = document.createElement('style');
    s.id = 'gba-loader-styles';
    s.textContent = [
      '#gba-articles-grid{width:100%;display:block;}',
      '#gba-articles-grid .insight-card{text-decoration:none;display:block;}',
      '.insights-grid{display:block;width:100%;max-width:100%;padding:0;}',
      '.gba-grid-row{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid rgba(255,255,255,0.1);}',
      '.insight-cta-btn{display:inline-block;margin-top:20px;padding:10px 22px;background:#B8964A;color:#0C0A07;',
      'font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;font-family:monospace;}',
      '.insight-cta{margin-top:16px;font-size:12px;font-weight:600;letter-spacing:0.08em;color:#B8964A;}',
      '@media (max-width:860px){.gba-grid-row{grid-template-columns:repeat(2,1fr);}}',
      '@media (max-width:560px){.gba-grid-row{grid-template-columns:1fr;}}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function render(container, articles) {
    var seen = Object.create(null);
    var unique = articles.filter(function (a) {
      if (!a || !a.id || !a.url || seen[a.id]) return false;
      seen[a.id] = true;
      return true;
    });
    if (!unique.length) return;

    unique.sort(byPublishedDesc);

    var featuredIndex = unique.findIndex(function (a) { return a.featured; });
    var featured = featuredIndex === -1 ? null : unique.splice(featuredIndex, 1)[0];

    injectStyles();
    container.innerHTML =
      (featured ? card(featured, true) : '') +
      (unique.length ? '<div class="gba-grid-row">' + unique.map(function (a) { return card(a, false); }).join('') + '</div>' : '');
  }

  function init() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    fetch(JSON_PATH, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (Array.isArray(data) && data.length) render(container, data);
      })
      .catch(function () {
        // Leave the static fallback in place.
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
