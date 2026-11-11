/**
 * GoBeyond Advisory — intelligence brief card loader.
 *
 * Progressive enhancement: #gba-articles-grid ships with a static fallback link
 * in index.html. If this script runs and /articles.json loads, the fallback is
 * replaced with the current featured brief. If either fails, the fallback stays put, so
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
    var action = article.type === 'gar-weekly' ? 'Watch episode →' : 'Read Brief →';
    return '<a href="' + esc(article.url) + '" class="insight-card' + (isFeatured ? ' featured' : '') + '">' +
      (isFeatured ? '<div>' : '') +
        '<div class="insight-tag">' + tag + '</div>' +
        '<div class="insight-title">' + esc(article.title) + '</div>' +
        '<div class="insight-body">' + esc(article.excerpt) + '</div>' +
        '<div class="insight-date">' + esc(article.date) + (isFeatured ? ' · gobeyondadvisory.com' : '') + '</div>' +
      (isFeatured ? '</div><div class="insight-cta-btn">' + action + '</div>'
                  : '<div class="insight-cta">' + action + '</div>') +
    '</a>';
  }

  function render(container, articles) {
    const entries = articles.filter(article => article && article.id && article.url).sort(byPublishedDesc);
    const briefs = entries.filter(article => article.type !== 'gar-weekly');
    if (briefs.length) {
      container.innerHTML = card(briefs[0], true);
      document.getElementById('recent-briefs').innerHTML = briefs.slice(1, 4).map(article =>
        '<a class="recent-item" href="' + esc(article.url) + '"><small>' + esc(article.category) +
        '</small><strong>' + esc(article.title) + '</strong><time datetime="' + esc(article.published) +
        '">' + esc(article.date) + '</time></a>'
      ).join('');
    }
    const episode = entries.find(article => article.type === 'gar-weekly');
    if (episode) {
      document.getElementById('series-description').textContent = 'Episode ' + episode.episode + ' · ' + episode.title;
      const link = document.getElementById('series-link');
      link.href = episode.url;
      link.textContent = 'Watch episode →';
    }
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
