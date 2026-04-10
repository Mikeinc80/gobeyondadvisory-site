/**
 * GoBeyond Advisory — Dynamic Article Card Loader
 * Drop this file in repo root as: article-loader.js
 * Add <script src="/article-loader.js"></script> before </body> in index.html
 * Add <div id="gba-articles-grid"></div> inside your #insights section
 *
 * To publish a new article:
 *   1. Add article HTML file to repo root
 *   2. Add one entry to articles.json
 *   3. Push to GitHub → Netlify auto-deploys → card appears instantly
 */

(function () {
  const CONTAINER_ID = 'gba-articles-grid';
  const JSON_PATH = '/articles.json';

  /* ── Card HTML builder ── */
  function buildCard(article, index) {
    const featuredBadge = article.featured
      ? `<span class="ab-badge">⭐ Featured</span>`
      : '';
    const newBadge = article.new
      ? `<span class="ab-badge ab-badge--new">New</span>`
      : '';

    return `
      <a class="ab-card${article.featured ? ' ab-card--featured' : ''}" href="${article.url}" style="animation-delay:${index * 80}ms">
        <div class="ab-card__header">
          <div class="ab-badges">${featuredBadge}${newBadge}</div>
          <span class="ab-category">${article.category}</span>
        </div>
        <h3 class="ab-title">${article.title}</h3>
        <p class="ab-excerpt">${article.excerpt}</p>
        <div class="ab-footer">
          <span class="ab-date">${article.date}</span>
          <span class="ab-cta">Read Brief →</span>
        </div>
      </a>
    `;
  }

  /* ── Inject styles ── */
  function injectStyles() {
    if (document.getElementById('ab-styles')) return;
    const style = document.createElement('style');
    style.id = 'ab-styles';
    style.textContent = `
      #gba-articles-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 2px;
        background: rgba(184,150,74,0.12);
      }
      .ab-card {
        display: flex;
        flex-direction: column;
        background: #111009;
        padding: 36px 32px;
        text-decoration: none;
        color: inherit;
        opacity: 0;
        transform: translateY(16px);
        animation: abFadeIn 0.55s ease forwards;
        transition: background 0.2s;
        border-bottom: 2px solid transparent;
      }
      .ab-card:hover {
        background: #1A1710;
        border-bottom-color: #B8964A;
      }
      .ab-card--featured {
        grid-column: 1 / -1;
        background: #161310;
      }
      @media (min-width: 900px) {
        .ab-card--featured { grid-column: span 2; }
      }
      .ab-card__header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .ab-badges { display: flex; gap: 6px; }
      .ab-badge {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
        padding: 4px 10px;
        background: rgba(184,150,74,0.12);
        color: #B8964A;
        border: 1px solid rgba(184,150,74,0.25);
      }
      .ab-badge--new {
        background: rgba(184,150,74,0.2);
        color: #D4B06A;
      }
      .ab-category {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: #7A7060;
      }
      .ab-title {
        font-family: 'Syne', sans-serif;
        font-size: 18px;
        font-weight: 700;
        color: #F8F5F0;
        line-height: 1.3;
        margin: 0 0 12px;
        letter-spacing: -0.01em;
      }
      .ab-card--featured .ab-title { font-size: 22px; }
      .ab-excerpt {
        font-family: 'Cormorant Garamond', serif;
        font-size: 16px;
        color: #9A9080;
        line-height: 1.7;
        flex: 1;
        margin: 0 0 20px;
      }
      .ab-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: auto;
      }
      .ab-date {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        letter-spacing: 0.1em;
        color: #5A5248;
        text-transform: uppercase;
      }
      .ab-cta {
        font-family: 'Syne', sans-serif;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.1em;
        color: #B8964A;
        transition: letter-spacing 0.2s;
      }
      .ab-card:hover .ab-cta { letter-spacing: 0.18em; }

      /* Loading skeleton */
      .ab-skeleton {
        background: #111009;
        padding: 36px 32px;
        min-height: 180px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ab-skeleton::after {
        content: '';
        width: 32px;
        height: 32px;
        border: 2px solid rgba(184,150,74,0.15);
        border-top-color: #B8964A;
        border-radius: 50%;
        animation: abSpin 0.8s linear infinite;
      }

      @keyframes abFadeIn {
        to { opacity: 1; transform: none; }
      }
      @keyframes abSpin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  /* ── Render error state ── */
  function renderError(container) {
    container.innerHTML = `
      <div class="ab-skeleton" style="color:#7A7060;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;">
        BRIEFS LOADING — CHECK BACK SHORTLY
      </div>`;
  }

  /* ── Main init ── */
  function init() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    injectStyles();

    // Show loading state
    container.innerHTML = `<div class="ab-skeleton"></div><div class="ab-skeleton"></div><div class="ab-skeleton"></div>`;

    fetch(JSON_PATH)
      .then(function (res) {
        if (!res.ok) throw new Error('fetch failed');
        return res.json();
      })
      .then(function (articles) {
        if (!Array.isArray(articles) || articles.length === 0) {
          renderError(container);
          return;
        }
        container.innerHTML = articles.map(buildCard).join('');
      })
      .catch(function () {
        renderError(container);
      });
  }

  /* Run after DOM ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
