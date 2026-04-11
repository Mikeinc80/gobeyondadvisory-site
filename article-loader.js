/**
 * GoBeyond Advisory — Dynamic Article Card Loader v3
 * Matches original insight-card layout precisely
 */
(function () {
  var CONTAINER_ID = 'gba-articles-grid';
  var JSON_PATH = '/articles.json';

  function buildFeatured(article) {
    return '<a href="' + article.url + '" class="insight-card featured" style="text-decoration:none;display:block;">' +
      '<div>' +
        '<div class="insight-tag">' +
          (article.featured ? '⭐ Featured · ' : '') + article.category +
        '</div>' +
        '<div class="insight-title">' + article.title + '</div>' +
        '<div class="insight-body">' + article.excerpt + '</div>' +
        '<div class="insight-date">' + article.date + ' · gobeyondadvisory.com</div>' +
      '</div>' +
      '<div class="insight-cta-btn">Read Brief →</div>' +
    '</a>';
  }

  function buildCard(article) {
    return '<a href="' + article.url + '" class="insight-card" style="text-decoration:none;display:block;">' +
      '<div class="insight-tag">' + article.category + '</div>' +
      '<div class="insight-title">' + article.title + '</div>' +
      '<div class="insight-body">' + article.excerpt + '</div>' +
      '<div class="insight-date">' + article.date + '</div>' +
      '<div class="insight-cta">Read Brief →</div>' +
    '</a>';
  }

  function injectStyles() {
    if (document.getElementById('ab-styles-v3')) return;
    var s = document.createElement('style');
    s.id = 'ab-styles-v3';
    s.textContent = [
      /* Grid wrapper — full width, matches site's insights-grid */
      '#gba-articles-grid {',
      '  width: 100% !important;',
      '  display: block !important;',
      '}',

      /* Force parent container full width */
      '.insights-grid {',
      '  display: block !important;',
      '  width: 100% !important;',
      '  max-width: 100% !important;',
      '  padding: 0 !important;',
      '}',

      /* Row wrapper for 3-col grid */
      '.ab-grid-row {',
      '  display: grid;',
      '  grid-template-columns: repeat(3, 1fr);',
      '  border-top: 1px solid rgba(255,255,255,0.1);',
      '}',

      /* CTA button on featured card — gold bar */
      '.insight-cta-btn {',
      '  display: inline-block;',
      '  margin-top: 20px;',
      '  padding: 10px 22px;',
      '  background: #B8964A;',
      '  color: #0C0A07;',
      '  font-size: 11px;',
      '  font-weight: 700;',
      '  letter-spacing: 0.15em;',
      '  text-transform: uppercase;',
      '  font-family: monospace;',
      '}',

      /* Inline CTA on regular cards */
      '.insight-cta {',
      '  margin-top: 16px;',
      '  font-size: 12px;',
      '  font-weight: 600;',
      '  letter-spacing: 0.08em;',
      '  color: #B8964A;',
      '}',

      /* Loading skeleton */
      '.ab-skel {',
      '  background: #111;',
      '  min-height: 160px;',
      '  border: 1px solid rgba(255,255,255,0.06);',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '}',
      '.ab-skel::after {',
      '  content: "";',
      '  width: 22px; height: 22px;',
      '  border: 2px solid rgba(184,150,74,0.15);',
      '  border-top-color: #B8964A;',
      '  border-radius: 50%;',
      '  animation: abSpin 0.8s linear infinite;',
      '}',

      '@media (max-width: 860px) {',
      '  .ab-grid-row { grid-template-columns: repeat(2,1fr); }',
      '}',
      '@media (max-width: 560px) {',
      '  .ab-grid-row { grid-template-columns: 1fr; }',
      '}',
      '@keyframes abSpin { to { transform: rotate(360deg); } }'
    ].join('\n');
    document.head.appendChild(s);
  }

  function render(articles) {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    // Separate featured from regular — deduplicate by id
    var seen = {};
    var featured = null;
    var regular = [];

    articles.forEach(function(a) {
      if (seen[a.id]) return;
      seen[a.id] = true;
      if (a.featured && !featured) {
        featured = a;
      } else {
        regular.push(a);
      }
    });

    var html = '';

    // Featured card full width
    if (featured) {
      html += buildFeatured(featured);
    }

    // Regular cards in rows of 3
    if (regular.length) {
      html += '<div class="ab-grid-row">';
      regular.forEach(function(a) {
        html += buildCard(a);
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  function init() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    injectStyles();

    // Show skeleton
    container.innerHTML = '<div class="ab-skel" style="min-height:200px;"></div>';

    fetch(JSON_PATH)
      .then(function(r) {
        if (!r.ok) throw new Error('failed');
        return r.json();
      })
      .then(function(data) {
        if (!Array.isArray(data) || !data.length) {
          container.innerHTML = '';
          return;
        }
        render(data);
      })
      .catch(function() {
        container.innerHTML = '';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
