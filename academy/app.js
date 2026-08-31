/* ─────────────────────────────────────────────────────────────────────────
   AI Cloud Infrastructure Program — application.

   A hash-routed, offline-capable single page app over curriculum.js. There is
   no backend: all progress lives in localStorage on this device, which is why
   Settings offers an export. Everything the programme requires that is stateful
   — the skills matrix, the error log, spaced repetition, gate sign-off, quiz
   attempts — is held in one versioned state object.

   Two rules from the programme are enforced here rather than left to good
   intentions:
     1. Quiz and challenge answers are never rendered until an attempt is
        submitted. The correct index is not written into the DOM before then.
     2. A wrong answer schedules itself for spaced repetition automatically.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  var C = window.CURRICULUM;
  var KEY = "aicip.v1";
  var view = document.getElementById("view");

  /* ── State ─────────────────────────────────────────────────────────── */
  var DEFAULT = {
    v: 1, startDate: null, currentWeek: 1, theme: null,
    lessons: {}, tasks: {}, skills: {}, quiz: {}, review: {},
    errors: [], gates: {}, projects: {}, applications: []
  };

  var S = load();

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULT);
      var parsed = JSON.parse(raw);
      var out = clone(DEFAULT);
      Object.keys(DEFAULT).forEach(function (k) {
        if (parsed[k] !== undefined && parsed[k] !== null) out[k] = parsed[k];
      });
      return out;
    } catch (e) {
      return clone(DEFAULT);
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { /* private mode or quota: the app still works for this session */ }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ── Small helpers ─────────────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function el(sel, root) { return (root || document).querySelector(sel); }
  function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekOf(n) { return C.weeks.find(function (w) { return w.n === n; }); }
  function phaseOf(n) { return C.phases.find(function (p) { return n >= p.from && n <= p.to; }); }
  function lessonsForWeek(n) { return C.lessons.filter(function (l) { return l.week === n; }); }
  function list(arr, cls) {
    if (!arr || !arr.length) return "";
    return "<ul" + (cls ? ' class="' + cls + '"' : "") + ">" +
      arr.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>";
  }

  /* ── Progress ──────────────────────────────────────────────────────── */
  function weekComplete(n) {
    var w = weekOf(n);
    if (!w) return false;
    var q = S.quiz["week:" + n];
    var ls = lessonsForWeek(n);
    var lessonsDone = ls.length ? ls.every(function (l) { return S.lessons[l.id]; }) : true;
    // "week:N:pas:0" is the single pass-standard checkbox rendered by views.week.
    return Boolean(q && q.submitted && q.correct >= 4 && lessonsDone && S.tasks["week:" + n + ":pas:0"]);
  }
  function overallPct() {
    var done = 0;
    for (var i = 1; i <= C.meta.weeks; i++) if (weekComplete(i)) done++;
    return Math.round((done / C.meta.weeks) * 100);
  }
  function dueReviews() {
    var t = todayISO();
    return Object.keys(S.review).filter(function (k) { return S.review[k].due <= t; });
  }

  /* ── Spaced repetition ─────────────────────────────────────────────── */
  var INTERVALS = [1, 3, 7, 16, 35];
  function scheduleReview(key, payload) {
    // A wrong answer always restarts the ladder, whether or not the item was
    // already queued — that is the whole point of spaced repetition.
    S.review[key] = {
      due: addDays(todayISO(), INTERVALS[0]),
      reps: 0,
      q: payload.q, options: payload.options, answer: payload.answer,
      explain: payload.explain, source: payload.source
    };
  }
  function advanceReview(key, correct) {
    var r = S.review[key];
    if (!r) return;
    if (!correct) { r.reps = 0; r.due = addDays(todayISO(), INTERVALS[0]); return; }
    r.reps = Math.min(r.reps + 1, INTERVALS.length - 1);
    if (r.reps >= INTERVALS.length - 1) { delete S.review[key]; return; }
    r.due = addDays(todayISO(), INTERVALS[r.reps]);
  }

  /* ── Quiz rendering ────────────────────────────────────────────────
     The correct index is never placed in the DOM before submission. It is
     held in a closure and only consulted when the learner submits. ──── */
  function renderQuiz(container, quizId, questions, sourceLabel, onSubmit) {
    var state = S.quiz[quizId];
    var submitted = Boolean(state && state.submitted);

    container.innerHTML =
      questions.map(function (q, i) {
        var chosen = submitted && state.answers ? state.answers[i] : null;
        var opts = q.options.map(function (o, j) {
          var id = quizId + "-" + i + "-" + j;
          var checked = chosen === j ? " checked" : "";
          var dis = submitted ? " disabled" : "";
          return '<div class="opt">' +
            '<input type="radio" id="' + esc(id) + '" name="' + esc(quizId + "-" + i) + '" value="' + j + '"' + checked + dis + '/>' +
            '<label for="' + esc(id) + '">' + esc(o) + "</label></div>";
        }).join("");
        var verdict = "";
        if (submitted) {
          var ok = chosen === q.answer;
          verdict = '<div class="verdict ' + (ok ? "ok" : "bad") + '">' +
            "<b>" + (ok ? "Correct" : "Not correct") + "</b>" +
            (ok ? "" : "<p>The answer is: <strong>" + esc(q.options[q.answer]) + "</strong></p>") +
            "<p>" + esc(q.explain) + "</p></div>";
        }
        return '<div class="q"><p>' + (i + 1) + ". " + esc(q.q) + "</p>" + opts + verdict + "</div>";
      }).join("") +
      (submitted
        ? '<div class="btnrow"><span class="chip ' + (state.correct >= 4 ? "ok" : "bad") + '">Score ' + state.correct + " / " + questions.length + '</span>' +
          '<button class="ghost" data-quiz-retry="' + esc(quizId) + '" type="button">Try again</button></div>'
        : '<div class="btnrow"><button class="primary" data-quiz-submit="' + esc(quizId) + '" type="button">Submit answers</button>' +
          '<span class="tiny">Answers stay hidden until you submit.</span></div>');

    var submitBtn = el('[data-quiz-submit]', container);
    if (submitBtn) {
      submitBtn.addEventListener("click", function () {
        var answers = questions.map(function (q, i) {
          var picked = el('input[name="' + quizId + "-" + i + '"]:checked', container);
          return picked ? Number(picked.value) : null;
        });
        if (answers.some(function (a) { return a === null; })) {
          if (!window.confirm("Some questions are unanswered. Submit anyway?")) return;
        }
        var correct = 0;
        questions.forEach(function (q, i) {
          if (answers[i] === q.answer) {
            correct++;
            advanceReview(quizId + "#" + i, true);
          } else {
            scheduleReview(quizId + "#" + i, {
              q: q.q, options: q.options, answer: q.answer, explain: q.explain,
              source: sourceLabel
            });
          }
        });
        S.quiz[quizId] = { submitted: true, answers: answers, correct: correct, at: new Date().toISOString() };
        save();
        if (onSubmit) onSubmit(answers);
        renderQuiz(container, quizId, questions, sourceLabel, onSubmit);
        paintChrome();
      });
    }
    var retry = el("[data-quiz-retry]", container);
    if (retry) {
      retry.addEventListener("click", function () {
        delete S.quiz[quizId];
        save();
        renderQuiz(container, quizId, questions, sourceLabel, onSubmit);
        paintChrome();
      });
    }
  }

  /* ── Checkbox lists bound to state ─────────────────────────────────── */
  function checklist(items, keyPrefix) {
    return '<div data-checklist="' + esc(keyPrefix) + '">' + items.map(function (item, i) {
      var k = keyPrefix + ":" + i;
      var done = Boolean(S.tasks[k]);
      var id = "chk-" + keyPrefix.replace(/[^a-z0-9]/gi, "-") + "-" + i;
      return '<div class="check' + (done ? " done" : "") + '">' +
        '<input type="checkbox" id="' + esc(id) + '" data-task="' + esc(k) + '"' + (done ? " checked" : "") + "/>" +
        '<label for="' + esc(id) + '">' + esc(item) + "</label></div>";
    }).join("") + "</div>";
  }
  function bindChecklists(root) {
    els("[data-task]", root).forEach(function (input) {
      input.addEventListener("change", function () {
        var k = input.getAttribute("data-task");
        if (input.checked) S.tasks[k] = true; else delete S.tasks[k];
        input.closest(".check").classList.toggle("done", input.checked);
        save();
        paintChrome();
      });
    });
  }

  function reveal(summary, body) {
    return '<details class="reveal"><summary>' + esc(summary) + "</summary>" +
      '<div class="body">' + body + "</div></details>";
  }

  /* ── Derived day plan for weeks without written lessons ────────────── */
  var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  function derivePlan(w) {
    var per = Math.ceil(w.concepts.length / 5);
    return DAYS.map(function (d, i) {
      return {
        day: d,
        concepts: w.concepts.slice(i * per, (i + 1) * per),
        lab: w.labs[i] || null
      };
    }).filter(function (p) { return p.concepts.length || p.lab; });
  }

  /* ── Views ─────────────────────────────────────────────────────────── */
  var views = {};

  views.dashboard = function () {
    var pct = overallPct();
    var w = weekOf(S.currentWeek);
    var p = phaseOf(S.currentWeek);
    var due = dueReviews().length;
    var next = C.lessons.find(function (l) { return !S.lessons[l.id]; });
    var openErrors = S.errors.filter(function (e) { return !e.demonstrated; }).length;
    var skillsReady = Object.keys(S.skills).filter(function (k) { return S.skills[k] >= 4; }).length;
    var projectsDone = C.projects.filter(function (pr) {
      return C.qualityChecklist.every(function (_, i) { return S.tasks["project:" + pr.n + ":" + i]; });
    }).length;

    return '<span class="eyebrow">' + esc(C.meta.schedule) + "</span>" +
      "<h1>" + esc(C.meta.title) + "</h1>" +
      '<p class="lede">' + esc(C.meta.subtitle) + "</p>" +
      (S.startDate ? "" :
        '<div class="note"><strong>Start here</strong><p>Set your start date and answer the five opening questions in ' +
        '<a href="#/settings">Settings</a>, then begin Week 1, Lesson 1 below.</p></div>') +
      '<div class="stats">' +
        '<div class="stat"><b>' + pct + '%</b><span>Programme complete</span></div>' +
        '<div class="stat"><b>' + S.currentWeek + "</b><span>Current week</span></div>" +
        '<div class="stat"><b>' + due + "</b><span>Reviews due</span></div>" +
        '<div class="stat"><b>' + skillsReady + "</b><span>Interview ready</span></div>" +
        '<div class="stat"><b>' + projectsDone + " / 6</b><span>Projects complete</span></div>" +
        '<div class="stat"><b>' + openErrors + "</b><span>Open error-log items</span></div>" +
      "</div>" +
      (next
        ? '<div class="card"><span class="eyebrow">Next lesson</span>' +
          "<h2>Week " + next.week + ", Day " + next.day + " — " + esc(next.title) + "</h2>" +
          "<p>" + esc(next.objective) + "</p>" +
          '<div class="btnrow"><a class="primary" href="#/lesson/' + esc(next.id) + '">Start lesson · ' + next.minutes + " min</a></div></div>"
        : '<div class="card"><span class="eyebrow">Next</span><h2>Week ' + S.currentWeek + " — " + esc(w.title) + "</h2>" +
          "<p>" + esc(w.objective) + '</p><div class="btnrow"><a class="primary" href="#/week/' + S.currentWeek + '">Open the week</a></div></div>') +
      (due ? '<div class="note"><strong>Spaced repetition</strong><p>' + due +
        ' question(s) you previously got wrong are due today. <a href="#/review">Review them now</a> — this is where the programme actually works.</p></div>' : "") +
      '<div class="card"><span class="eyebrow">Current phase</span><h2>Phase ' + p.n + " — " + esc(p.title) + "</h2>" +
        "<p>" + esc(p.summary) + "</p><p><strong>Weeks " + p.from + "–" + p.to + "</strong></p></div>" +
      '<div class="note warn"><strong>Honesty standard</strong><p>' + esc(C.meta.honesty) + "</p></div>" +
      "<h2>Non-negotiable rules</h2>" + list(C.rules);
  };

  views.curriculum = function () {
    return '<span class="eyebrow">24 weeks · 6 phases</span><h1>Curriculum</h1>' +
      '<p class="lede">Six phases, twenty-four weeks. Nothing here is optional: each phase assumes the one before it.</p>' +
      C.phases.map(function (p) {
        return '<div class="phase-head"><h2>Phase ' + p.n + " — " + esc(p.title) + "</h2>" +
          '<span class="chip gold">Weeks ' + p.from + "–" + p.to + "</span></div>" +
          "<p>" + esc(p.summary) + "</p>" +
          C.weeks.filter(function (w) { return w.phase === p.n; }).map(function (w) {
            var done = weekComplete(w.n);
            return '<a class="weekrow' + (done ? " done" : "") + '" href="#/week/' + w.n + '">' +
              '<span class="num">W' + w.n + "</span>" +
              '<span class="t"><strong>' + esc(w.title) + "</strong><span>" + esc(w.objective) + "</span></span>" +
              (done ? '<span class="chip ok">Passed</span>' : "") + "</a>";
          }).join("");
      }).join("");
  };

  views.week = function (n) {
    var w = weekOf(n);
    if (!w) return '<div class="empty">No such week.</div>';
    var p = phaseOf(n);
    var ls = lessonsForWeek(n);
    var plan = ls.length ? null : derivePlan(w);

    var html =
      '<span class="eyebrow">Phase ' + p.n + " · Week " + w.n + " of 24</span><h1>" + esc(w.title) + "</h1>" +
      '<p class="lede">' + esc(w.objective) + "</p>" +
      '<div class="chiprow">' + w.skills.map(function (id) {
        var sk = C.skills.find(function (s) { return s.id === id; });
        return sk ? '<span class="chip">' + esc(sk.group) + "</span>" : "";
      }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join("") + "</div>" +

      "<h2>1 · Prerequisite review</h2>" + list(w.prereq) +
      "<h2>2 · Concepts this week</h2>" + list(w.concepts) +

      "<h2>3 · Required reading (official sources)</h2><ul>" +
        w.reading.map(function (r) {
          return '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.label) + "</a></li>";
        }).join("") + "</ul>" +

      "<h2>4 · Daily plan</h2>" +
      (ls.length
        ? ls.map(function (l) {
            var done = S.lessons[l.id];
            return '<a class="weekrow' + (done ? " done" : "") + '" href="#/lesson/' + esc(l.id) + '">' +
              '<span class="num">D' + l.day + "</span>" +
              '<span class="t"><strong>' + esc(l.title) + "</strong><span>" + esc(l.objective) + "</span></span>" +
              (done ? '<span class="chip ok">Done</span>' : '<span class="chip">' + l.minutes + " min</span>") + "</a>";
          }).join("")
        : '<div class="note"><strong>Derived plan</strong><p>Full daily lessons are written out for Week 1. For this week the plan below is derived from the concepts and laboratories. Work one block per weekday, 90 minutes each.</p></div>' +
          plan.map(function (d, i) {
            return '<div class="card"><div class="card-head"><h3>' + esc(d.day) + '</h3><span class="chip">90 min</span></div>' +
              list(d.concepts) +
              (d.lab ? "<p><strong>" + esc(d.lab.title) + "</strong></p>" + list(d.lab.steps) : "") + "</div>";
          }).join("")) +

      "<h2>5 · Guided laboratories</h2>" +
      w.labs.map(function (lab, i) {
        return '<div class="card"><h3>' + esc(lab.title) + "</h3>" +
          checklist(lab.steps, "week:" + n + ":lab" + i) + "</div>";
      }).join("") +

      "<h2>6 · Independent exercises</h2>" + checklist(w.exercises, "week:" + n + ":ex") +

      "<h2>7 · Commands and code you must write</h2><pre><code>" +
        w.commands.map(esc).join("\n") + "</code></pre>" +

      "<h2>8 · Common mistakes</h2>" + list(w.mistakes) +

      "<h2>9 · Troubleshooting exercises</h2>" +
      w.troubleshooting.map(function (t, i) {
        return '<div class="card"><p>' + esc(t.scenario) + "</p>" +
          reveal("Show the hint (attempt it first)", "<p>" + esc(t.hint) + "</p>") + "</div>";
      }).join("") +

      "<h2>10 · Security considerations</h2>" + list(w.security) +
      '<div class="note money"><strong>Cost considerations</strong>' + list(w.cost) + "</div>" +

      "<h2>11 · GitHub deliverable</h2>" +
      "<p>Repository: <code>" + esc(w.deliverable.repo) + "</code></p>" +
      checklist(w.deliverable.items, "week:" + n + ":del") +

      "<h2>12 · Interview questions</h2>" +
      w.interview.map(function (q, i) {
        return '<div class="card"><p><strong>' + esc(q.q) + "</strong></p>" +
          "<p>Answer it out loud, in full, before revealing the model answer.</p>" +
          reveal("Reveal model answer", "<p>" + esc(q.a) + "</p>") + "</div>";
      }).join("") +

      "<h2>13 · Friday assessment</h2>" +
      '<div class="card"><p>' + esc(w.friday) + "</p>" +
      checklist(["Friday assessment completed closed-book, and the result recorded"], "week:" + n + ":fri") + "</div>" +

      "<h2>14 · Sunday cumulative review</h2>" + checklist(w.sunday, "week:" + n + ":sun") +

      "<h2>15 · Recall quiz</h2>" +
      '<div id="weekQuiz"></div>' +

      "<h2>16 · Pass standard</h2>" +
      '<div class="card">' + list(w.pass) +
      checklist(["I meet every pass standard above, without assistance"], "week:" + n + ":pas") + "</div>" +

      '<div class="btnrow">' +
        (n > 1 ? '<a class="btn" href="#/week/' + (n - 1) + '">← Week ' + (n - 1) + "</a>" : "") +
        '<button class="primary" id="setCurrent" type="button">Make this my current week</button>' +
        (n < 24 ? '<a class="btn" href="#/week/' + (n + 1) + '">Week ' + (n + 1) + " →</a>" : "") +
      "</div>";

    return { html: html, after: function (root) {
      renderQuiz(el("#weekQuiz", root), "week:" + n, w.quiz, "Week " + n);
      var btn = el("#setCurrent", root);
      if (btn) btn.addEventListener("click", function () {
        S.currentWeek = n; save(); paintChrome();
        btn.textContent = "Current week set";
      });
    } };
  };

  views.lesson = function (id) {
    var l = C.lessons.find(function (x) { return x.id === id; });
    if (!l) return '<div class="empty">No such lesson.</div>';
    var done = Boolean(S.lessons[l.id]);

    var html =
      '<span class="eyebrow">Week ' + l.week + " · Day " + l.day + " · " + l.minutes + " minutes</span>" +
      "<h1>" + esc(l.title) + "</h1>" +
      '<div class="note"><strong>1 · Today’s objective</strong><p>' + esc(l.objective) + "</p></div>" +

      "<h2>2 · Plain-language explanation</h2><p>" + esc(l.plain) + "</p>" +

      "<h2>3 · Vocabulary</h2>" +
      '<table class="matrix"><thead><tr><th>Term</th><th>Meaning</th></tr></thead><tbody>' +
      l.vocab.map(function (v) {
        return "<tr><td><strong>" + esc(v.term) + "</strong></td><td>" + esc(v.def) + "</td></tr>";
      }).join("") + "</tbody></table>" +

      "<h2>4 · Technical explanation</h2><p>" + esc(l.technical) + "</p>" +
      (l.diagram ? "<h2>5 · Diagram</h2><pre><code>" + esc(l.diagram) + "</code></pre>" : "") +

      "<h2>6 · Guided exercise</h2>" + checklist(l.guided, "lesson:" + l.id + ":g") +

      "<h2>7 · Independent challenge</h2>" +
      '<div class="card"><p>' + esc(l.challenge) + "</p>" +
      checklist(["Challenge attempted and written up before looking at anything else"], "lesson:" + l.id + ":c") + "</div>" +

      "<h2>8 · Recall quiz</h2><div id=\"lessonQuiz\"></div>" +

      "<h2>9 · Troubleshooting problem</h2>" +
      '<div class="card"><p>' + esc(l.troubleshoot.scenario) + "</p>" +
      reveal("Reveal the hint (attempt it first)", "<p>" + esc(l.troubleshoot.hint) + "</p>") + "</div>" +

      "<h2>10 · Interview question</h2>" +
      '<div class="card"><p><strong>' + esc(l.interview.q) + "</strong></p>" +
      "<p>Answer out loud, in full sentences, before revealing anything.</p>" +
      reveal("Reveal model answer", "<p>" + esc(l.interview.a) + "</p>") + "</div>" +

      "<h2>11 · Homework</h2><p>" + esc(l.homework) + "</p>" +

      "<h2>12 · Definition of completion</h2>" + list(l.done) +

      '<div class="btnrow">' +
        '<button class="' + (done ? "ghost" : "primary") + '" id="markDone" type="button">' +
        (done ? "Mark not complete" : "Mark lesson complete") + "</button>" +
        '<a class="btn" href="#/week/' + l.week + '">Back to Week ' + l.week + "</a>" +
      "</div>";

    return { html: html, after: function (root) {
      renderQuiz(el("#lessonQuiz", root), "lesson:" + l.id, l.quiz, "Week " + l.week + " Day " + l.day);
      el("#markDone", root).addEventListener("click", function () {
        if (S.lessons[l.id]) delete S.lessons[l.id];
        else {
          S.lessons[l.id] = todayISO();
          if (l.week > S.currentWeek) S.currentWeek = l.week;
        }
        save(); render();
      });
    } };
  };

  views.skills = function () {
    var groups = {};
    C.skills.forEach(function (s) { (groups[s.group] = groups[s.group] || []).push(s); });
    var counts = [0, 0, 0, 0, 0];
    C.skills.forEach(function (s) { counts[S.skills[s.id] || 0]++; });

    var html = '<span class="eyebrow">Assessment</span><h1>Skills matrix</h1>' +
      '<p class="lede">Mark honestly. <strong>Demonstrated</strong> means you did it with no step-by-step help. ' +
      '<strong>Interview Ready</strong> means you can build it, break it, fix it and explain it.</p>' +
      '<div class="stats">' + C.LEVELS.map(function (lv, i) {
        return '<div class="stat"><b>' + counts[i] + "</b><span>" + esc(lv) + "</span></div>";
      }).join("") + "</div>" +
      Object.keys(groups).map(function (g) {
        return "<h2>" + esc(g) + "</h2>" +
          '<table class="matrix"><thead><tr><th>Skill</th><th class="hide-sm">Phase</th><th>Level</th></tr></thead><tbody>' +
          groups[g].map(function (s) {
            var lvl = S.skills[s.id] || 0;
            return "<tr><td>" + esc(s.name) + '</td><td class="hide-sm">' + s.phase + "</td>" +
              '<td><select data-skill="' + esc(s.id) + '" class="lvl-' + lvl + '">' +
              C.LEVELS.map(function (lv, i) {
                return '<option value="' + i + '"' + (i === lvl ? " selected" : "") + ">" + esc(lv) + "</option>";
              }).join("") + "</select></td></tr>";
          }).join("") + "</tbody></table>";
      }).join("");

    return { html: html, after: function (root) {
      els("[data-skill]", root).forEach(function (sel) {
        sel.addEventListener("change", function () {
          var v = Number(sel.value);
          if (v === 0) delete S.skills[sel.getAttribute("data-skill")];
          else S.skills[sel.getAttribute("data-skill")] = v;
          sel.className = "lvl-" + v;
          save(); paintChrome();
        });
      });
    } };
  };

  views.log = function () {
    var html = '<span class="eyebrow">Assessment</span><h1>Error log</h1>' +
      '<p class="lede">Every misunderstanding, written down and revisited. This is the highest-value habit in the programme: ' +
      'the things you got wrong and then corrected are what you will remember under interview pressure.</p>' +
      '<div class="card"><h3>Add an entry</h3>' +
      '<div class="field"><label for="eWhat">What I misunderstood</label><input type="text" id="eWhat"/></div>' +
      '<div class="field"><label for="eWhy">Why it was incorrect</label><textarea id="eWhy"></textarea></div>' +
      '<div class="field"><label for="eFix">The corrected explanation, in my own words</label><textarea id="eFix"></textarea></div>' +
      '<div class="btnrow"><button class="primary" id="eAdd" type="button">Add to error log</button></div></div>' +
      (S.errors.length
        ? S.errors.slice().reverse().map(function (e) {
            return '<div class="card"><div class="card-head"><h3>' + esc(e.what) + "</h3>" +
              '<span class="chip' + (e.demonstrated ? " ok" : "") + '">' + esc(e.date) + "</span></div>" +
              "<p><strong>Why it was wrong:</strong> " + esc(e.why) + "</p>" +
              "<p><strong>Correct explanation:</strong> " + esc(e.correct) + "</p>" +
              '<div class="check' + (e.demonstrated ? " done" : "") + '">' +
              '<input type="checkbox" id="dem-' + esc(e.id) + '" data-demo="' + esc(e.id) + '"' + (e.demonstrated ? " checked" : "") + "/>" +
              '<label for="dem-' + esc(e.id) + '">I have since demonstrated this skill independently</label></div>' +
              '<div class="btnrow"><button class="ghost" data-del="' + esc(e.id) + '" type="button">Delete</button></div></div>';
          }).join("")
        : '<div class="empty">No entries yet. Add the first thing you got wrong — that is the point.</div>');

    return { html: html, after: function (root) {
      el("#eAdd", root).addEventListener("click", function () {
        var what = el("#eWhat", root).value.trim();
        if (!what) { el("#eWhat", root).focus(); return; }
        S.errors.push({
          id: "e" + Date.now(), date: todayISO(), what: what,
          why: el("#eWhy", root).value.trim(),
          correct: el("#eFix", root).value.trim(),
          demonstrated: false
        });
        save(); render();
      });
      els("[data-demo]", root).forEach(function (cb) {
        cb.addEventListener("change", function () {
          var e = S.errors.find(function (x) { return x.id === cb.getAttribute("data-demo"); });
          if (e) { e.demonstrated = cb.checked; save(); render(); }
        });
      });
      els("[data-del]", root).forEach(function (b) {
        b.addEventListener("click", function () {
          if (!window.confirm("Delete this error-log entry?")) return;
          S.errors = S.errors.filter(function (x) { return x.id !== b.getAttribute("data-del"); });
          save(); render();
        });
      });
    } };
  };

  views.review = function () {
    // Review rounds are throwaway: drop previous rounds' quiz records so the
    // state object does not grow one entry per review session.
    Object.keys(S.quiz).forEach(function (k) { if (k.indexOf("review:") === 0) delete S.quiz[k]; });
    var due = dueReviews();
    var all = Object.keys(S.review);
    if (!all.length) {
      return '<span class="eyebrow">Spaced repetition</span><h1>Review queue</h1>' +
        '<div class="empty">Nothing queued. Questions you answer incorrectly are added here automatically and resurface after 1, 3, 7, 16 and 35 days.</div>';
    }
    if (!due.length) {
      var soonest = all.map(function (k) { return S.review[k].due; }).sort()[0];
      return '<span class="eyebrow">Spaced repetition</span><h1>Review queue</h1>' +
        '<div class="empty">Nothing due today. ' + all.length + " item(s) queued; the next is due " + esc(soonest) + ".</div>";
    }

    var qs = due.map(function (k) { return S.review[k]; });
    var html = '<span class="eyebrow">Spaced repetition</span><h1>Review queue</h1>' +
      '<p class="lede">' + due.length + " question(s) you previously got wrong. Answer them again — correctly answered items move further out; wrong ones come back tomorrow.</p>" +
      '<div class="chiprow">' + qs.map(function (q) { return '<span class="chip">' + esc(q.source) + "</span>"; })
        .filter(function (v, i, a) { return a.indexOf(v) === i; }).join("") + "</div>" +
      '<div id="reviewQuiz"></div>';

    return { html: html, after: function (root) {
      var quizId = "review:" + todayISO() + ":" + Date.now();
      // A review answer reschedules the ITEM, not the throwaway quiz record:
      // correct pushes it further out, wrong resets it to tomorrow.
      renderQuiz(el("#reviewQuiz", root), quizId, qs, "Review", function (answers) {
        due.forEach(function (k, i) {
          var item = S.review[k];
          if (!item) return;
          advanceReview(k, answers[i] === item.answer);
        });
        save();
      });
    } };
  };

  views.projects = function () {
    return '<span class="eyebrow">Portfolio</span><h1>Six portfolio projects</h1>' +
      '<p class="lede">Production-style projects with measured results. A repository you cannot explain is a liability, not an asset.</p>' +
      C.projects.map(function (p) {
        var done = C.qualityChecklist.filter(function (_, i) { return S.tasks["project:" + p.n + ":" + i]; }).length;
        return '<a class="weekrow" href="#/project/' + p.n + '">' +
          '<span class="num">P' + p.n + "</span>" +
          '<span class="t"><strong>' + esc(p.title) + "</strong><span>Week " + p.week + " · " + esc(p.repo) + "</span></span>" +
          '<span class="chip' + (done === C.qualityChecklist.length ? " ok" : "") + '">' + done + " / " + C.qualityChecklist.length + "</span></a>";
      }).join("");
  };

  views.project = function (n) {
    var p = C.projects.find(function (x) { return x.n === Number(n); });
    if (!p) return '<div class="empty">No such project.</div>';
    var html = '<span class="eyebrow">Project ' + p.n + " · Week " + p.week + "</span><h1>" + esc(p.title) + "</h1>" +
      '<p class="lede">' + esc(p.problem) + "</p>" +
      "<p>Repository: <code>" + esc(p.repo) + "</code></p>" +
      '<div class="note money"><strong>Cost</strong><p>' + esc(p.cost) + "</p></div>" +
      "<h2>What you build</h2>" + checklist(p.build, "project:" + p.n + ":build") +
      "<h2>Evidence required</h2>" + list(p.evidence) +
      "<h2>Portfolio quality checklist</h2>" +
      '<p class="tiny">Every one of these must be present in the repository README or docs before the project counts as complete.</p>' +
      checklist(C.qualityChecklist, "project:" + p.n);
    return html;
  };

  views.gates = function () {
    return '<span class="eyebrow">Employment readiness</span><h1>The eight gates</h1>' +
      '<p class="lede">Gates are not dates. You pass one when you can do the things listed, unaided. ' +
      'Start applying for roles at Gate 5 — the market is itself a diagnostic.</p>' +
      C.gates.map(function (g) {
        var done = g.criteria.filter(function (_, i) { return S.tasks["gate:" + g.n + ":" + i]; }).length;
        return '<div class="card"><div class="card-head"><h2>Gate ' + g.n + " — " + esc(g.name) + "</h2>" +
          '<span class="chip' + (done === g.criteria.length ? " ok" : " gold") + '">' + done + " / " + g.criteria.length + "</span></div>" +
          '<p class="tiny">Target: end of Week ' + g.week + "</p>" +
          checklist(g.criteria, "gate:" + g.n) + "</div>";
      }).join("");
  };

  views.career = function () {
    var html = '<span class="eyebrow">Career</span><h1>Certifications, measurement and applications</h1>' +
      "<h2>Certification sequence</h2>" +
      '<p class="lede">Certificates get you past a filter. Projects get you through the interview. Take one foundational certification, not three that prove the same thing.</p>' +
      C.certifications.map(function (c) {
        return '<div class="card"><div class="card-head"><h3>' + c.step + ". " + esc(c.name) + '</h3><span class="chip gold">' + esc(c.when) + "</span></div>" +
          "<p><strong>Cost:</strong> " + esc(c.cost) + "</p><p>" + esc(c.note) + "</p></div>";
      }).join("") +

      "<h2>Measurement standards</h2>" +
      '<p>Do not accept &ldquo;it works&rdquo; without evidence. Where applicable, measure:</p>' +
      C.metrics.map(function (m) {
        return "<h3>" + esc(m.group) + "</h3>" + list(m.items);
      }).join("") +

      "<h2>Application tracker</h2>" +
      '<div class="card">' +
      '<div class="field"><label for="aRole">Role and employer</label><input type="text" id="aRole" placeholder="Junior Cloud Engineer — Example Ltd"/></div>' +
      '<div class="btnrow"><button class="primary" id="aAdd" type="button">Log application</button></div></div>' +
      (S.applications.length
        ? '<table class="matrix"><thead><tr><th>Date</th><th>Role / employer</th><th>Status</th><th></th></tr></thead><tbody>' +
          S.applications.slice().reverse().map(function (a) {
            return "<tr><td>" + esc(a.date) + "</td><td>" + esc(a.role) + "</td>" +
              '<td><select data-app="' + esc(a.id) + '">' +
              ["Applied", "Screening", "Interview", "Offer", "Rejected", "No response"].map(function (s) {
                return '<option value="' + esc(s) + '"' + (a.status === s ? " selected" : "") + ">" + esc(s) + "</option>";
              }).join("") + "</select></td>" +
              '<td><button class="ghost" data-appdel="' + esc(a.id) + '" type="button">Remove</button></td></tr>';
          }).join("") + "</tbody></table>"
        : '<div class="empty">No applications logged. From Gate 5 onward, aim for one tailored application per weekday.</div>');

    return { html: html, after: function (root) {
      el("#aAdd", root).addEventListener("click", function () {
        var role = el("#aRole", root).value.trim();
        if (!role) { el("#aRole", root).focus(); return; }
        S.applications.push({ id: "a" + Date.now(), date: todayISO(), role: role, status: "Applied" });
        save(); render();
      });
      els("[data-app]", root).forEach(function (sel) {
        sel.addEventListener("change", function () {
          var a = S.applications.find(function (x) { return x.id === sel.getAttribute("data-app"); });
          if (a) { a.status = sel.value; save(); }
        });
      });
      els("[data-appdel]", root).forEach(function (b) {
        b.addEventListener("click", function () {
          S.applications = S.applications.filter(function (x) { return x.id !== b.getAttribute("data-appdel"); });
          save(); render();
        });
      });
    } };
  };

  views.settings = function () {
    var html = '<span class="eyebrow">Settings</span><h1>Your programme</h1>' +
      '<div class="card"><h3>Opening questions</h3>' +
      '<p class="tiny">These five answers set the teaching level. They are stored on this device only.</p>' +
      ["Education level or age (only if it affects the teaching level)",
       "Computer and operating system available to you",
       "Weekly study availability, honestly",
       "Location and target employment market",
       "Do you have a payment method for limited, capped cloud laboratories?"].map(function (q, i) {
        var v = S.tasks["intake:" + i + ":text"] || "";
        return '<div class="field"><label for="q' + i + '">' + esc(q) + '</label>' +
          '<input type="text" id="q' + i + '" data-intake="' + i + '" value="' + esc(v) + '"/></div>';
      }).join("") +
      '<div class="field"><label for="startDate">Programme start date</label>' +
      '<input type="date" id="startDate" value="' + esc(S.startDate || todayISO()) + '"/></div>' +
      '<div class="btnrow"><button class="primary" id="saveIntake" type="button">Save</button></div></div>' +

      '<div class="card"><h3>Backup</h3>' +
      '<p>Progress is stored in this browser only. Clearing site data, switching device or using a private window loses it. Export regularly.</p>' +
      '<div class="btnrow"><button class="ghost" id="exportBtn" type="button">Copy backup to clipboard</button></div>' +
      '<div class="field"><label for="importBox">Paste a backup here to restore</label><textarea id="importBox" placeholder="Paste exported JSON"></textarea></div>' +
      '<div class="btnrow"><button class="ghost" id="importBtn" type="button">Restore from backup</button></div></div>' +

      '<div class="card"><h3>Appearance</h3>' +
      '<div class="btnrow">' +
      '<button class="ghost" data-theme-set="light" type="button">Light</button>' +
      '<button class="ghost" data-theme-set="dark" type="button">Dark</button>' +
      '<button class="ghost" data-theme-set="" type="button">Match system</button></div></div>' +

      '<div class="card"><h3>Reset</h3><p>Deletes all progress on this device. There is no undo — export first.</p>' +
      '<div class="btnrow"><button class="ghost" id="resetBtn" type="button">Erase all progress</button></div></div>' +

      '<div class="card"><h3>About</h3><p>Version ' + esc(C.meta.version) + " · " + C.meta.weeks + " weeks · " +
      C.skills.length + " tracked skills · " + C.projects.length + " projects.</p>" +
      '<p class="tiny">Reading links point at official primary documentation. Verify pricing and free-tier terms yourself before creating anything that bills.</p></div>';

    return { html: html, after: function (root) {
      el("#saveIntake", root).addEventListener("click", function () {
        els("[data-intake]", root).forEach(function (inp) {
          S.tasks["intake:" + inp.getAttribute("data-intake") + ":text"] = inp.value.trim();
        });
        S.startDate = el("#startDate", root).value || todayISO();
        save(); render();
      });
      el("#exportBtn", root).addEventListener("click", function () {
        var text = JSON.stringify(S);
        var btn = el("#exportBtn", root);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            function () { btn.textContent = "Copied"; },
            function () { el("#importBox", root).value = text; btn.textContent = "Copy failed — shown below"; }
          );
        } else {
          el("#importBox", root).value = text;
          btn.textContent = "Shown below — copy it";
        }
      });
      el("#importBtn", root).addEventListener("click", function () {
        var raw = el("#importBox", root).value.trim();
        if (!raw) return;
        try {
          var parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object") throw new Error("not an object");
          localStorage.setItem(KEY, JSON.stringify(parsed));
          S = load(); save(); render(); paintChrome();
          window.alert("Backup restored.");
        } catch (e) {
          window.alert("That does not look like a valid backup.");
        }
      });
      els("[data-theme-set]", root).forEach(function (b) {
        b.addEventListener("click", function () {
          var v = b.getAttribute("data-theme-set");
          S.theme = v || null; save(); applyTheme();
        });
      });
      el("#resetBtn", root).addEventListener("click", function () {
        if (!window.confirm("Erase all progress on this device? This cannot be undone.")) return;
        if (!window.confirm("Really erase everything? Export a backup first if you have not.")) return;
        localStorage.removeItem(KEY);
        S = load(); render(); paintChrome();
      });
    } };
  };

  /* ── Navigation and chrome ─────────────────────────────────────────── */
  var NAV = [
    { href: "#/", label: "Dashboard" },
    { href: "#/curriculum", label: "Curriculum" },
    { href: "#/today", label: "Today’s lesson" },
    { href: "#/review", label: "Review queue", badge: function () { return dueReviews().length; } },
    { href: "#/skills", label: "Skills matrix" },
    { href: "#/log", label: "Error log" },
    { href: "#/projects", label: "Projects" },
    { href: "#/gates", label: "Gates" },
    { href: "#/career", label: "Career" },
    { href: "#/settings", label: "Settings" }
  ];

  function paintChrome() {
    var pct = overallPct();
    var ring = el("#progressRing");
    ring.style.setProperty("--pct", pct);
    el("#progressPct").textContent = pct + "%";
    el("#progressWeek").textContent = "Week " + S.currentWeek + " of " + C.meta.weeks;
    var p = phaseOf(S.currentWeek);
    el("#progressPhase").textContent = "Phase " + p.n + " of " + C.phases.length;
    el("#progressPhase").title = p.title;

    var hash = location.hash || "#/";
    el("#navList").innerHTML = NAV.map(function (n) {
      var active = hash === n.href || (n.href !== "#/" && hash.indexOf(n.href) === 0);
      var b = n.badge ? n.badge() : 0;
      return '<li><a href="' + n.href + '"' + (active ? ' aria-current="page"' : "") + ">" +
        esc(n.label) + (b ? '<span class="badge">' + b + "</span>" : "") + "</a></li>";
    }).join("");
  }

  function applyTheme() {
    if (S.theme === "dark" || S.theme === "light") document.documentElement.setAttribute("data-theme", S.theme);
    else document.documentElement.removeAttribute("data-theme");
  }

  /* ── Router ────────────────────────────────────────────────────────── */
  function route() {
    var h = (location.hash || "#/").slice(1);
    var parts = h.split("/").filter(Boolean);
    if (!parts.length) return views.dashboard();
    switch (parts[0]) {
      case "curriculum": return views.curriculum();
      case "week": return views.week(Number(parts[1]));
      case "lesson": return views.lesson(parts[1]);
      case "today": {
        var next = C.lessons.find(function (l) { return !S.lessons[l.id]; });
        if (next) return views.lesson(next.id);
        return views.week(S.currentWeek);
      }
      case "skills": return views.skills();
      case "log": return views.log();
      case "review": return views.review();
      case "projects": return views.projects();
      case "project": return views.project(parts[1]);
      case "gates": return views.gates();
      case "career": return views.career();
      case "settings": return views.settings();
      default: return '<div class="empty">Page not found. <a href="#/">Back to the dashboard</a>.</div>';
    }
  }

  function render() {
    var out = route();
    var html = typeof out === "string" ? out : out.html;
    view.innerHTML = html;
    bindChecklists(view);
    if (typeof out === "object" && out.after) out.after(view);
    paintChrome();
    closeNav();
    document.getElementById("main").scrollIntoView({ block: "start" });
    window.scrollTo(0, 0);
  }

  /* ── Mobile navigation ─────────────────────────────────────────────── */
  var sidebar = el("#sidebar"), scrim = el("#scrim"), toggle = el("#menuToggle");
  function openNav() { sidebar.classList.add("open"); scrim.hidden = false; toggle.setAttribute("aria-expanded", "true"); }
  function closeNav() { sidebar.classList.remove("open"); scrim.hidden = true; toggle.setAttribute("aria-expanded", "false"); }
  toggle.addEventListener("click", function () {
    if (sidebar.classList.contains("open")) closeNav(); else openNav();
  });
  scrim.addEventListener("click", closeNav);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeNav(); });

  el("#themeToggle").addEventListener("click", function () {
    var isDark = document.documentElement.getAttribute("data-theme") === "dark" ||
      (!document.documentElement.getAttribute("data-theme") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    S.theme = isDark ? "light" : "dark";
    save(); applyTheme();
  });

  /* ── Network status ────────────────────────────────────────────────── */
  function netState() {
    var n = el("#netState");
    var online = navigator.onLine;
    n.dataset.state = online ? "online" : "offline";
    n.textContent = online ? "ONLINE" : "OFFLINE";
    n.title = online ? "Connected" : "Offline — the whole programme still works, only the reading links need a connection";
  }
  window.addEventListener("online", netState);
  window.addEventListener("offline", netState);

  /* ── Install prompt ────────────────────────────────────────────────── */
  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    var b = el("#installBtn");
    b.hidden = false;
    b.addEventListener("click", function () {
      b.hidden = true;
      deferredPrompt.prompt();
      deferredPrompt = null;
    }, { once: true });
  });

  /* ── Service worker ────────────────────────────────────────────────── */
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {
        /* Offline support is an enhancement; the app works without it. */
      });
    });
  }

  /* ── Boot ──────────────────────────────────────────────────────────── */
  applyTheme();
  netState();
  window.addEventListener("hashchange", render);
  render();
})();
