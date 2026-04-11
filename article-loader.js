/**
 * GoBeyond Advisory — Dynamic Article Card Loader v2
 * Matches "Where We Operate" 3-column horizontal grid layout
 */

(function () {
  var CONTAINER_ID = 'gba-articles-grid';
  var JSON_PATH = '/articles.json';

  function buildCard(article, index) {
    var newBadge = article.new ? '<span class="ab-new">New</span>' : '';
    var featuredClass = article.featured ? ' ab-card--featured' : '';

    return '<a class="ab-card' + featuredClass + '" href="' + article.url + '" style="animation-delay:' + (index * 80) + 'ms">' +
      '<div class="ab-card-top">' +
        (article.new || article.featured ? '<div class="ab-badges">' + (article.featured ? '<span class="ab-feat">⭐ Featured</span>' : '') + newBadge + '</div>' : '') +
        '<span class="ab-cat">' + article.category + '</span>' +
      '</div>' +
      '<h3 class="ab-title">' + article.title + '</h3>' +
      '<p class="ab-body">' + article.excerpt + '</p>' +
      '<div class="ab-foot">' +
        '<span class="ab-date">' + article.date + '</span>' +
        '<span class="ab-cta">Read Brief →</span>' +
      '</div>' +
    '</a>';
  }

  function injectStyles() {
    if (document.getElementById('ab-styles')) return;
    var s = document.createElement('style');
    s.id = 'ab-styles';
    s.textContent = [
      /* Force full width breakout matching site's section width */
      '#gba-articles-grid {',
      '  display: grid;',
      '  grid-template-columns: repeat(3, 1fr);',
      '  gap: 0;',
      '  width: 100%;',
      '  border: 1px solid rgba(255,255,255,0.08);',
      '}',

      /* Featured card spans all 3 columns */
      '.ab-card--featured {',
      '  grid-column: 1 / -1;',
      '  border-bottom: 1px solid rgba(255,255,255,0.08);',
      '}',

      /* Base card */
      '.ab-card {',
      '  display: flex;',
      '  flex-direction: column;',
      '  padding: 32px 28px;',
      '  text-decoration: none;',
      '  color: inherit;',
      '  background: #111;',
      '  border-right: 1px solid rgba(255,255,255,0.08);',
      '  border-bottom: 1px solid rgba(255,255,255,0.08);',
      '  opacity: 0;',
      '  transform: translateY(12px);',
      '  animation: abIn 0.5s ease forwards;',
      '  transition: background 0.2s;',
      '  min-height: 220px;',
      '}',
      '.ab-card:last-child { border-right: none; }',
      '.ab-card:hover { background: #1a1a1a; }',
      '.ab-card--featured { background: #0e0e0e; padding: 40px 36px; min-height: auto; }',
      '.ab-card--featured:hover { background: #141414; }',

      /* Top meta */
      '.ab-card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }',
      '.ab-badges { display: flex; gap: 6px; }',
      '.ab-feat, .ab-new {',
      '  font-size: 10px;',
      '  font-weight: 600;',
      '  letter-spacing: 0.1em;',
      '  padding: 3px 9px;',
      '  border: 1px solid rgba(184,150,74,0.3);',
      '  color: #B8964A;',
      '  background: rgba(184,150,74,0.08);',
      '  font-family: monospace;',
      '}',
      '.ab-new { color: #D4B06A; background: rgba(184,150,74,0.14); }',
      '.ab-cat {',
      '  font-size: 10px;',
      '  letter-spacing: 0.15em;',
      '  text-transform: uppercase;',
      '  color: #888;',
      '  font-family: monospace;',
      '}',

      /* Title */
      '.ab-title {',
      '  font-size: 17px;',
      '  font-weight: 700;',
      '  line-height: 1.3;',
      '  color: #f0ece6;',
      '  margin: 0 0 12px;',
      '  letter-spacing: -0.01em;',
      '}',
      '.ab-card--featured .ab-title { font-size: 22px; max-width: 680px; }',

      /* Body */
      '.ab-body {',
      '  font-size: 14px;',
      '  color: #888;',
      '  line-height: 1.7;',
      '  flex: 1;',
      '  margin: 0 0 20px;',
      '}',
      '.ab-card--featured .ab-body { font-size: 15px; max-width: 600px; color: #999; }',

      /* Footer */
      '.ab-foot { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }',
      '.ab-date { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #555; font-family: monospace; }',
      '.ab-cta { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; color: #B8964A; transition: letter-spacing 0.2s; }',
      '.ab-card:hover .ab-cta { letter-spacing: 0.16em; }',

      /* Loading */
      '.ab-skeleton { background: #111; min-height: 180px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.06); }',
      '.ab-skeleton::after { content: ""; width: 24px; height: 24px; border: 2px solid rgba(184,150,74,0.15); border-top-color: #B8964A; border-radius: 50%; animation: abSpin 0.8s linear infinite; }',

      /* Responsive */
      '@media (max-width: 900px) {',
      '  #gba-articles-grid { grid-template-columns: repeat(2, 1fr); }',
      '  .ab-card--featured { grid-column: 1 / -1; }',
      '}',
      '@media (max-width: 600px) {',
      '  #gba-articles-grid { grid-template-columns: 1fr; }',
      '}',

      '@keyframes abIn { to { opacity: 1; transform: none; } }',
      '@keyframes abSpin { to { transform: rotate(360deg); } }'
    ].join('\n');
    document.head.appendChild(s);
  }

  function init() {
    var container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    injectStyles();

    /* Force container to break out of any width constraints */
    container.style.cssText = 'width:100%;display:block;';

    /* Also force parent insights-grid to full width */
    var parent = container.parentElement;
    if (parent) {
      parent.style.cssText = 'width:100%;max-width:100%;padding:0;display:block;';
    }

    container.innerHTML =
      '<div class="ab-skeleton" style="grid-column:1/-1"></div>' +
      '<div class="ab-skeleton"></div>' +
      '<div class="ab-skeleton"></div>';

    fetch(JSON_PATH)
      .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function(articles) {
        if (!Array.isArray(articles) || !articles.length) {
          container.innerHTML = '<div class="ab-skeleton" style="grid-column:1/-1;color:#555;font-family:monospace;font-size:11px;letter-spacing:.1em;">BRIEFS LOADING</div>';
          return;
        }
        container.innerHTML = articles.map(buildCard).join('');
      })
      .catch(function() {
        container.innerHTML = '<div class="ab-skeleton" style="grid-column:1/-1;"></div>';
      });
  }

  /* Bulletproof reveal fallback */
  (function revealAll() {
    var fallback = setTimeout(function() {
      document.querySelectorAll('.ab-card').forEach(function(el) {
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
    }, 2000);
    window._abFallback = fallback;
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
