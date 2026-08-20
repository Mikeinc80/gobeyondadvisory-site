/* Client-side search for EkoInfrastructure.com.
   The index (search-index.json) is generated at build time by build.py and is
   fetched only when the search page is used, so it costs nothing elsewhere. */
(function () {
  'use strict';

  var form = document.querySelector('[data-search-form]');
  var input = document.getElementById('q');
  var status = document.getElementById('search-status');
  var results = document.getElementById('search-results');
  if (!form || !input || !results) return;

  var index = null;
  var pending = null;

  function load() {
    if (index) return Promise.resolve(index);
    if (pending) return pending;
    pending = fetch('/search-index.json', { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('index unavailable');
        return r.json();
      })
      .then(function (data) { index = data; return index; });
    return pending;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function terms(q) {
    return q.toLowerCase().split(/[^a-z0-9]+/).filter(function (t) { return t.length > 1; });
  }

  function score(doc, ts) {
    var t = doc.t.toLowerCase(), d = doc.d.toLowerCase(), b = doc.b.toLowerCase(), k = doc.k.toLowerCase();
    var s = 0;
    ts.forEach(function (term) {
      if (t.indexOf(term) !== -1) s += 12;
      if (k.indexOf(term) !== -1) s += 6;
      if (d.indexOf(term) !== -1) s += 5;
      var n = b.split(term).length - 1;
      s += Math.min(n, 8);
    });
    // Require every term to appear somewhere, so results stay precise.
    var all = ts.every(function (term) {
      return t.indexOf(term) !== -1 || d.indexOf(term) !== -1 || b.indexOf(term) !== -1 || k.indexOf(term) !== -1;
    });
    return all ? s : 0;
  }

  function snippet(doc, ts) {
    var b = doc.b, lower = b.toLowerCase(), pos = -1;
    for (var i = 0; i < ts.length && pos === -1; i++) pos = lower.indexOf(ts[i]);
    if (pos === -1) return escapeHtml(doc.d);
    var start = Math.max(0, pos - 90);
    var text = (start > 0 ? '…' : '') + b.slice(start, start + 240) + '…';
    var out = escapeHtml(text);
    ts.forEach(function (term) {
      out = out.replace(new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
    });
    return out;
  }

  function render(q) {
    var ts = terms(q);
    if (!ts.length) {
      results.innerHTML = '';
      status.textContent = 'Enter a term to search.';
      return;
    }
    status.textContent = 'Searching…';
    load().then(function (docs) {
      var hits = docs
        .map(function (d) { return { d: d, s: score(d, ts) }; })
        .filter(function (h) { return h.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 25);

      if (!hits.length) {
        results.innerHTML = '';
        status.innerHTML = 'No results for &ldquo;' + escapeHtml(q) + '&rdquo;. Try a broader term, or browse the <a href="/glossary">glossary</a>.';
        if (window.ekoTrack) window.ekoTrack('search_no_results', { query: q });
        return;
      }
      status.textContent = hits.length + (hits.length === 1 ? ' result' : ' results') + ' for “' + q + '”.';
      results.innerHTML = hits.map(function (h) {
        return '<article class="search-hit"><p class="article-meta"><span class="topic">' +
          escapeHtml(h.d.k) + '</span></p><h3><a href="' + h.d.u + '">' + escapeHtml(h.d.t) +
          '</a></h3><p>' + snippet(h.d, ts) + '</p></article>';
      }).join('');
      if (window.ekoTrack) window.ekoTrack('search', { query: q, results: hits.length });
    }).catch(function () {
      status.textContent = 'Search is unavailable right now. Please use the navigation above.';
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    history.replaceState(null, '', q ? '/search?q=' + encodeURIComponent(q) : '/search');
    render(q);
  });

  var timer;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { render(input.value.trim()); }, 250);
  });

  var initial = new URLSearchParams(location.search).get('q');
  if (initial) {
    input.value = initial;
    render(initial);
  }
})();
