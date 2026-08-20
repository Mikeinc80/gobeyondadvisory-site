/* EKORails LTD — site behaviour.
   No dependencies. Progressive enhancement only: every page works without JS.
   Privacy: no third-party trackers are loaded here. Analytics events are pushed
   to a queue that a consent-gated loader may later drain (see docs/14). */
(function () {
  'use strict';

  /* ------------------------------------------------ analytics event queue */
  var q = (window.ekoLayer = window.ekoLayer || []);
  function track(name, props) {
    q.push(Object.assign({ event: name, ts: new Date().toISOString(), path: location.pathname }, props || {}));
    if (window.__ekoAnalyticsReady && typeof window.__ekoAnalyticsSend === 'function') {
      window.__ekoAnalyticsSend(q[q.length - 1]);
    }
  }
  window.ekoTrack = track;

  /* ------------------------------------------------ mobile navigation */
  var toggle = document.querySelector('[data-nav-toggle]');
  var panel = document.querySelector('[data-mobile-nav]');
  if (toggle && panel) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
      toggle.querySelector('.sr-only').textContent = open ? 'Open menu' : 'Close menu';
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        toggle.click();
        toggle.focus();
      }
    });
  }

  /* ------------------------------------------------ outbound + CTA tracking */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    var cta = a.getAttribute('data-cta');
    if (cta) track('cta_click', { cta: cta, href: a.getAttribute('href') });
    if (a.hostname && a.hostname !== location.hostname) {
      track('outbound_click', { href: a.href, host: a.hostname });
    }
    if (/^mailto:/i.test(a.getAttribute('href') || '')) {
      track('email_click', { address: a.getAttribute('href').replace(/^mailto:/i, '') });
    }
  });

  /* ------------------------------------------------ tabs (ARIA) */
  document.querySelectorAll('[data-tabs]').forEach(function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        var p = document.getElementById(t.getAttribute('aria-controls'));
        if (p) p.hidden = !on;
      });
      track('tab_view', { tab: tab.textContent.trim() });
    }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab); });
      tab.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var next = tabs[(i + d + tabs.length) % tabs.length];
        next.focus();
        select(next);
      });
    });
  });

  /* ------------------------------------------------ forms */
  document.querySelectorAll('form[data-form]').forEach(function (form) {
    var started = false;
    form.addEventListener('input', function () {
      if (started) return;
      started = true;
      track('form_start', { form: form.getAttribute('data-form') });
    });
    form.addEventListener('submit', function (e) {
      /* Native constraint validation carries the UI; we only add reporting
         and a timing-based bot check alongside the hidden honeypot field. */
      if (!form.checkValidity()) {
        e.preventDefault();
        form.reportValidity();
        var bad = form.querySelector(':invalid');
        if (bad) bad.focus();
        track('form_error', { form: form.getAttribute('data-form'), field: bad ? bad.name : null });
        return;
      }
      var t0 = form.querySelector('input[name="form_render_ts"]');
      if (t0 && Date.now() - Number(t0.value) < 2500) {
        e.preventDefault();
        track('form_blocked', { form: form.getAttribute('data-form'), reason: 'submit_too_fast' });
        return;
      }
      track('form_submit', {
        form: form.getAttribute('data-form'),
        org_type: (form.querySelector('[name="organization_type"]') || {}).value || null
      });
    });
    var stamp = form.querySelector('input[name="form_render_ts"]');
    if (stamp) stamp.value = String(Date.now());
  });

  /* ------------------------------------------------ section visibility */
  if ('IntersectionObserver' in window) {
    var seen = new WeakSet();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !seen.has(en.target)) {
          seen.add(en.target);
          track('section_view', { section: en.target.getAttribute('data-section') });
        }
      });
    }, { threshold: 0.4 });
    document.querySelectorAll('[data-section]').forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------ cookie / consent notice */
  var KEY = 'eko.consent.v1';
  var banner = document.querySelector('[data-consent]');
  if (banner) {
    var stored = null;
    try { stored = localStorage.getItem(KEY); } catch (err) { stored = null; }
    if (!stored) {
      banner.hidden = false;
    } else if (stored === 'granted') {
      document.dispatchEvent(new CustomEvent('eko:consent', { detail: 'granted' }));
    }
    banner.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-consent-choice]');
      if (!btn) return;
      var choice = btn.getAttribute('data-consent-choice');
      try { localStorage.setItem(KEY, choice); } catch (err) { /* storage blocked */ }
      banner.hidden = true;
      track('consent_choice', { choice: choice });
      document.dispatchEvent(new CustomEvent('eko:consent', { detail: choice }));
    });
  }

  track('page_view', { title: document.title });
})();
