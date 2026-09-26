(function () {
  "use strict";

  function load(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {  }
  }

  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    var setOpen = function (open) {
      toggle.setAttribute("aria-expanded", String(open));
      nav.classList.toggle("is-open", open);
    };
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  var card = document.getElementById("timer-card");
  var pill = document.querySelector("[data-timer-pill]");
  var pillText = document.querySelector("[data-pill-text]");

  if (!card && pillText) {
    var st = load("qd-timer-settings", null);
    var m = st && st.mins ? parseInt(st.mins.focus, 10) : 25;
    if (m > 0 && m <= 120) pillText.textContent = "Ready · " + (m < 10 ? "0" : "") + m + ":00";
  }

  if (card) {
    var CIRC = 628.32;
    var LABELS = { focus: "Focus", short: "Short break", long: "Long break" };
    var PILL = { focus: "Focus", short: "Break", long: "Break" };

    var els = {
      time: card.querySelector("[data-time]"),
      phase: card.querySelector("[data-phase-label]"),
      ring: card.querySelector(".dial-progress"),
      toggle: card.querySelector('[data-action="toggle"]'),
      reset: card.querySelector('[data-action="reset"]'),
      skip: card.querySelector('[data-action="skip"]'),
      full: card.querySelector('[data-action="fullscreen"]'),
      dots: card.querySelectorAll("[data-cycle] i"),
      cycleText: card.querySelector("[data-cycle-text]"),
      total: card.querySelector("[data-total]"),
      announce: card.querySelector("[data-announce]"),
      tabs: card.querySelectorAll(".phase-tab"),
      presets: document.querySelectorAll("[data-preset]"),
      inFocus: document.getElementById("len-focus"),
      inShort: document.getElementById("len-short"),
      inLong: document.getElementById("len-long"),
      auto: document.getElementById("opt-auto"),
      chime: document.getElementById("opt-chime")
    };

    var saved = load("qd-timer-settings", null);
    var state = {
      phase: "focus",
      mins: { focus: 25, short: 5, long: 15 },
      remaining: 25 * 60 * 1000,
      endAt: 0,
      running: false,
      cycle: 0,
      total: 0
    };
    if (saved && saved.mins) {
      state.mins = {
        focus: clampInt(saved.mins.focus, 1, 120, 25),
        short: clampInt(saved.mins.short, 1, 30, 5),
        long: clampInt(saved.mins.long, 1, 60, 15)
      };
      els.auto.checked = !!saved.auto;
      els.chime.checked = saved.chime !== false;
    }
    els.inFocus.value = state.mins.focus;
    els.inShort.value = state.mins.short;
    els.inLong.value = state.mins.long;
    state.remaining = state.mins.focus * 60000;

    var baseTitle = document.title;
    var ticker = null;
    var audioCtx = null;

    function clampInt(v, min, max, fallback) {
      var n = parseInt(v, 10);
      if (isNaN(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    }

    function persist() {
      save("qd-timer-settings", { mins: state.mins, auto: els.auto.checked, chime: els.chime.checked });
    }

    function fmt(ms) {
      var s = Math.max(0, Math.ceil(ms / 1000));
      var m = Math.floor(s / 60);
      var r = s % 60;
      return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
    }

    function duration() { return state.mins[state.phase] * 60000; }

    function announce(msg) {
      els.announce.textContent = "";
      window.setTimeout(function () { els.announce.textContent = msg; }, 50);
    }

    function render() {
      var t = fmt(state.remaining);
      els.time.textContent = t;
      els.phase.textContent = LABELS[state.phase] + (state.running ? "" : (state.remaining < duration() ? " · paused" : ""));
      var frac = Math.min(1, Math.max(0, 1 - state.remaining / duration()));
      els.ring.style.strokeDashoffset = String(CIRC * frac);
      els.toggle.textContent = state.running ? "Pause" : (state.remaining < duration() ? "Resume" : "Start");
      card.setAttribute("data-phase", state.phase);

      for (var i = 0; i < els.dots.length; i++) {
        els.dots[i].classList.toggle("is-done", i < state.cycle);
      }
      els.cycleText.textContent = state.cycle + " of 4";
      els.total.textContent = state.total + (state.total === 1 ? " focus session" : " focus sessions") + " completed this visit";

      for (var j = 0; j < els.tabs.length; j++) {
        els.tabs[j].setAttribute("aria-pressed", String(els.tabs[j].getAttribute("data-phase") === state.phase));
      }

      var paused = !state.running && state.remaining < duration();
      if (pill && pillText) {
        pill.classList.toggle("is-running", state.running);
        pill.classList.toggle("is-paused", paused);
        pillText.textContent = state.running ? PILL[state.phase] + " · " + t
          : paused ? "Paused · " + t
          : (state.phase === "focus" ? "Ready · " : "Break ready · ") + t;
      }
      document.title = state.running ? t + " · " + LABELS[state.phase] + " — QuietDesk" : baseTitle;
    }

    function tick() {
      if (!state.running) return;
      state.remaining = state.endAt - Date.now();
      if (state.remaining <= 0) {
        finish(true);
        return;
      }
      render();
    }

    function start() {
      if (state.running) return;
      unlockAudio();
      state.running = true;
      state.endAt = Date.now() + state.remaining;
      window.clearInterval(ticker);
      ticker = window.setInterval(tick, 250);
      announce(LABELS[state.phase] + " started, " + fmt(state.remaining) + " remaining.");
      render();
    }

    function pause() {
      if (!state.running) return;
      state.remaining = Math.max(0, state.endAt - Date.now());
      state.running = false;
      window.clearInterval(ticker);
      announce("Paused with " + fmt(state.remaining) + " remaining.");
      render();
    }

    function setPhase(phase) {
      state.running = false;
      window.clearInterval(ticker);
      state.phase = phase;
      state.remaining = duration();
      render();
    }

    function finish(natural) {
      var was = state.phase;
      var next;
      state.running = false;
      window.clearInterval(ticker);
      if (was === "focus") {
        if (natural) {
          state.total += 1;
          state.cycle += 1;
        }
        next = state.cycle >= 4 ? "long" : "short";
      } else {
        if (was === "long") state.cycle = 0;
        next = "focus";
      }
      if (natural && els.chime.checked) playChime();
      state.phase = next;
      state.remaining = duration();
      if (natural) {
        announce(LABELS[was] + " finished. Next: " + LABELS[next].toLowerCase() + ", " + state.mins[next] + " minutes.");
      } else {
        announce("Skipped to " + LABELS[next].toLowerCase() + ".");
      }
      render();
      if (natural && els.auto.checked) start();
    }

    function applyLengths() {
      state.mins.focus = clampInt(els.inFocus.value, 1, 120, 25);
      state.mins.short = clampInt(els.inShort.value, 1, 30, 5);
      state.mins.long = clampInt(els.inLong.value, 1, 60, 15);
      var key = state.mins.focus + "," + state.mins.short + "," + state.mins.long;
      for (var i = 0; i < els.presets.length; i++) {
        els.presets[i].setAttribute("aria-pressed", String(els.presets[i].getAttribute("data-preset") === key));
      }
      persist();
      if (!state.running) {
        state.remaining = duration();
        render();
      }
    }

    function unlockAudio() {
      if (audioCtx) return;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try { audioCtx = new Ctx(); } catch (e) { audioCtx = null; }
    }
    function playChime() {
      if (!audioCtx) return;
      try {
        if (audioCtx.state === "suspended") audioCtx.resume();
        var now = audioCtx.currentTime;
        [[659.25, 0], [880, 0.35]].forEach(function (n) {
          var osc = audioCtx.createOscillator();
          var gain = audioCtx.createGain();
          osc.type = "sine";
          osc.frequency.value = n[0];
          gain.gain.setValueAtTime(0.0001, now + n[1]);
          gain.gain.exponentialRampToValueAtTime(0.18, now + n[1] + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + n[1] + 1.6);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(now + n[1]);
          osc.stop(now + n[1] + 1.7);
        });
      } catch (e) {  }
    }

    els.toggle.addEventListener("click", function () { state.running ? pause() : start(); });
    els.reset.addEventListener("click", function () {
      state.running = false;
      window.clearInterval(ticker);
      state.remaining = duration();
      announce(LABELS[state.phase] + " reset to " + fmt(state.remaining) + ".");
      render();
    });
    els.skip.addEventListener("click", function () { finish(false); });

    Array.prototype.forEach.call(els.tabs, function (tab) {
      tab.addEventListener("click", function () {
        setPhase(tab.getAttribute("data-phase"));
        announce(LABELS[state.phase] + " selected, " + fmt(state.remaining) + ".");
      });
    });

    Array.prototype.forEach.call(els.presets, function (btn) {
      btn.addEventListener("click", function () {
        var p = btn.getAttribute("data-preset").split(",");
        els.inFocus.value = p[0];
        els.inShort.value = p[1];
        els.inLong.value = p[2];
        applyLengths();
      });
    });

    [els.inFocus, els.inShort, els.inLong].forEach(function (input) {
      input.addEventListener("change", function () {
        applyLengths();
        input.value = state.mins[input.id === "len-focus" ? "focus" : input.id === "len-short" ? "short" : "long"];
      });
    });
    els.auto.addEventListener("change", persist);
    els.chime.addEventListener("change", persist);

    if (els.full) {
      if (!card.requestFullscreen) {
        els.full.hidden = true;
      } else {
        els.full.addEventListener("click", function () {
          if (document.fullscreenElement) document.exitFullscreen();
          else card.requestFullscreen().catch(function () {});
        });
        document.addEventListener("fullscreenchange", function () {
          els.full.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
        });
      }
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) tick();
    });

    applyLengths();
    render();
  }

  var cells = document.querySelectorAll(".cell[data-cell]");
  if (cells.length) {
    var plan = load("qd-planner", {});
    Array.prototype.forEach.call(cells, function (cell) {
      var key = cell.getAttribute("data-cell");
      if (plan[key]) cell.textContent = plan[key];

      cell.addEventListener("input", function () {
        var text = cell.innerText.replace(/\n+$/, "");
        if (!text.trim()) {
          cell.innerHTML = "";
          delete plan[key];
        } else {
          plan[key] = text;
        }
        save("qd-planner", plan);
      });
      cell.addEventListener("paste", function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData("text");
        document.execCommand("insertText", false, text);
      });
    });

    var clearPlanner = document.querySelector('[data-clear="planner"]');
    if (clearPlanner) {
      clearPlanner.addEventListener("click", function () {
        if (!window.confirm("Clear everything you've written in the planner?")) return;
        Array.prototype.forEach.call(cells, function (c) { c.innerHTML = ""; });
        plan = {};
        save("qd-planner", plan);
      });
    }
  }

  var checklist = document.getElementById("exam-checklist");
  if (checklist) {
    var boxes = checklist.querySelectorAll('input[type="checkbox"]');
    var ticks = load("qd-checklist", {});
    var doneEl = document.querySelector("[data-done]");
    var totalEl = document.querySelector("[data-total-items]");
    var bar = document.querySelector("[data-bar]");

    var updateProgress = function () {
      var done = 0;
      Array.prototype.forEach.call(boxes, function (b) { if (b.checked) done++; });
      doneEl.textContent = done;
      totalEl.textContent = boxes.length;
      bar.style.transform = "scaleX(" + (boxes.length ? done / boxes.length : 0) + ")";
    };

    Array.prototype.forEach.call(boxes, function (b) {
      b.checked = !!ticks[b.getAttribute("data-key")];
      b.addEventListener("change", function () {
        ticks[b.getAttribute("data-key")] = b.checked;
        save("qd-checklist", ticks);
        updateProgress();
      });
    });
    updateProgress();
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-print]"), function (btn) {
    btn.addEventListener("click", function () {
      var root = document.documentElement;
      root.setAttribute("data-print", btn.getAttribute("data-print"));
      var cleanup = function () {
        root.removeAttribute("data-print");
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      window.print();
      window.setTimeout(cleanup, 1000);
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-clear]"), function (btn) {
    btn.addEventListener("click", function () {
      var which = btn.getAttribute("data-clear");
      if (which === "checklist") {
        Array.prototype.forEach.call(document.querySelectorAll("#exam-checklist input"), function (b) {
          if (b.checked) { b.checked = false; b.dispatchEvent(new Event("change")); }
        });
      }
    });
  });
})();
