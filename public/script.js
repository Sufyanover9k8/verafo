/* =========================================================
   SINGLE SOURCE OF TRUTH
   Update FOUNDING once and every counter on the site follows:
   the announcement bars, the pricing card and the mobile bar.
   ========================================================= */
var VERAFO_FOUNDING = {
  total: 100,
  claimed: 87
};

/* =========================================================
   VERAFO — site behaviour
   No framework, no build step. Open index.html directly.

   DEPLOY NOTE: the onboarding form has no backend yet.
   Set VERAFO_FORM_ENDPOINT below to a Google Apps Script,
   Formspree, or Formspark URL and submissions post there.
   Leave it empty and submissions are kept in the browser
   and shown to the applicant with a copy button.
   ========================================================= */

var VERAFO_FORM_ENDPOINT = '';

/* DEPLOY NOTE: this page authenticates nobody itself. Once the form
   validates, the merchant is handed to the app, which owns the session.
   Point VERAFO_AUTH_ENDPOINT at a real auth service and sign-in posts
   there instead, honouring the redirect field it returns.

   The apex (verafo.com) is this marketing site. www.verafo.com is the
   dashboard app, so that is where both of these point. */
var VERAFO_AUTH_ENDPOINT = '';
var VERAFO_APP_URL = 'https://www.verafo.com/';

(function () {
  'use strict';

  // Probe globals. These exist so diagnostic.html can tell whether this file
  // parsed and ran to completion, which is otherwise invisible from outside.
  window.__verafoProbe = function () { return true; };
  window.__verafoBuild = 'v21';

  /* Browser APIs are aliased and made safe up front.

     `requestAnimationFrame` in particular used to be called unguarded, and a
     single ReferenceError there killed the rest of this file: the scan card
     froze and every later block never ran. Reading a feature off `window`
     cannot throw, so that is how every access is done from here on. */
  var requestAnimationFrameSafe = window.requestAnimationFrame
    ? window.requestAnimationFrame.bind(window)
    : function (fn) { return window.setTimeout(fn, 16); };
  var cancelAnimationFrameSafe = window.cancelAnimationFrame
    ? window.cancelAnimationFrame.bind(window)
    : function (id) { window.clearTimeout(id); };

  var reduce = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* Scrolling an element into view is not implemented everywhere, and a throw
     here would abort whatever was being shown at the time. Read the method
     off the element, which cannot throw, and fall back to the window. */
  function scrollToEl(el, block) {
    if (!el) return;
    try {
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: block || 'center' });
        return;
      }
      var top = el.getBoundingClientRect().top + window.scrollY - 90;
      window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
    } catch (err) { /* scrolling is cosmetic; never let it break the page */ }
  }

  function $(sel, root) { return (root || document).querySelector(sel); }

  /* Always return a real array. Array.prototype.slice.call works on a
     NodeList in modern browsers, but Array.from is unambiguous and does
     not depend on the object being array-like in the right way. */
  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  /* Resolve a list of anchor hrefs to elements, dropping any that do not
     exist. Returns an array, always. */
  function resolveTargets(anchorList) {
    var out = [];
    for (var i = 0; i < anchorList.length; i++) {
      var href = anchorList[i].getAttribute('href');
      if (!href || href.charAt(0) !== '#') continue;
      var el = document.getElementById(href.slice(1));
      if (el) out.push(el);
    }
    return out;
  }

  function group(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pkr(n) { return 'PKR ' + group(n); }

  /* ---------- subtle sound ----------
     Short synthesised tones, generated with the Web Audio API rather than
     loaded as files, so there is nothing to download and no extra requests.

     Two decisions worth stating plainly:

     1. Sound is OFF until the visitor turns it on. Audio a visitor did not ask
        for is one of the most intrusive things a page can do, and a marketing
        site has no business making noise at someone who is reading it at their
        desk. Flipping SOUND_DEFAULT to true would reverse this.
     2. Every sound is user-initiated. Nothing plays on load, on scroll, or on
        hover, so a visitor who never clicks never hears anything.

     Volumes sit between 0.03 and 0.06 of full scale, which is roughly the
     level of a keyboard key heard from arm's length. */
  var SOUND_DEFAULT = false;
  var SOUND_KEY = 'verafo-sound';

  /* One slot for a listener that wants to know when the scan card renders.
     The sound block is defined before the card, so it registers here and the
     card calls back into it. */
  var scanHook = null;

  var Sound = (function () {
    var ctx = null;
    var on = false;
    var supported = !!(window.AudioContext || window.webkitAudioContext);

    function readPref() {
      try {
        var v = window.localStorage.getItem(SOUND_KEY);
        if (v === 'on') return true;
        if (v === 'off') return false;
      } catch (e) { /* private mode: fall through to the default */ }
      return SOUND_DEFAULT;
    }

    function savePref(want) {
      try { window.localStorage.setItem(SOUND_KEY, want ? 'on' : 'off'); } catch (e) {}
    }

    /* The context is created on the first user gesture, because browsers
       refuse to start audio before one and would otherwise log a warning. */
    function ensure() {
      if (!supported) return null;
      if (!ctx) {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        try { ctx = new Ctor(); } catch (e) { supported = false; return null; }
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }

    /* One tone. A triangle wave with a short exponential decay reads as soft
       and glassy; a sine is duller and a square is harsh at this size. The
       gain ramp avoids the click that a hard start or stop would produce. */
    function tone(freq, dur, vol, type, delay) {
      if (!on) return;
      var c = ensure();
      if (!c) return;
      try {
        var t = c.currentTime + (delay || 0);
        var osc = c.createOscillator();
        var g = c.createGain();
        osc.type = type || 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g);
        g.connect(c.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      } catch (e) { /* audio is a nicety; never let it break a page */ }
    }

    return {
      isOn: function () { return on; },
      supported: supported,
      init: function () { on = readPref(); },
      set: function (want) {
        on = !!want;
        savePref(on);
        if (on) tone(660, 0.12, 0.045, 'triangle', 0);
      },
      /* A soft click for anything pressable. */
      tap: function () { tone(540, 0.075, 0.035, 'triangle', 0); },
      /* A short rising pair when a step completes. */
      step: function () {
        tone(600, 0.09, 0.035, 'triangle', 0);
        tone(840, 0.11, 0.028, 'triangle', 0.07);
      },
      /* A settled two-note chord on success, the only sound that lingers. */
      done: function () {
        tone(600, 0.3, 0.04, 'triangle', 0);
        tone(900, 0.34, 0.03, 'triangle', 0.06);
      },
      /* A low, quiet thud when a reading lands. */
      tick: function () { tone(300, 0.06, 0.022, 'sine', 0); },
      suspend: function () { if (ctx && ctx.state === 'running' && ctx.suspend) ctx.suspend(); },
      resume: function () { if (on && ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume(); }
    };
  })();

  Sound.init();

  /* The toggle is injected rather than written into nine pages, so it cannot
     drift out of step between them. It sits with the theme control, which is
     the other preference the visitor owns. */
  (function buildSoundToggle() {
    if (!Sound.supported) return;
    var speakerOn = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z"/><path d="M15.8 9.2a4 4 0 010 5.6"/><path d="M18.2 6.6a7.6 7.6 0 010 10.8"/></svg>';
    var speakerOff = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z"/><path d="M16.4 9.6l4.2 4.8M20.6 9.6l-4.2 4.8"/></svg>';

    function make(cls) {
      var wrap = document.createElement('div');
      wrap.className = 'sound-toggle ' + cls;
      wrap.setAttribute('role', 'group');
      wrap.setAttribute('aria-label', 'Sound effects');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-sound-toggle', '');
      wrap.appendChild(btn);
      return wrap;
    }

    function paint() {
      var live = Sound.isOn();
      $$('[data-sound-toggle]').forEach(function (b) {
        b.innerHTML = live ? speakerOn : speakerOff;
        b.setAttribute('aria-pressed', live ? 'true' : 'false');
        b.title = live ? 'Sound on — click to mute' : 'Sound off — click to enable';
        b.setAttribute('aria-label', b.title);
      });
    }

    var desktop = $('.site-head__cta .theme-toggle--inline');
    if (desktop) desktop.parentNode.insertBefore(make('sound-toggle--inline'), desktop.nextSibling);
    var mobile = $('.mobile-nav .theme-toggle--mobile');
    if (mobile) mobile.parentNode.insertBefore(make('sound-toggle--mobile'), mobile.nextSibling);

    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-sound-toggle]') : null;
      if (!b) return;
      e.preventDefault();
      Sound.set(!Sound.isOn());
      paint();
    });

    paint();
  })();

  /* Never make a sound in a tab nobody is looking at. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) Sound.suspend();
    else Sound.resume();
  });

  /* Every listener below is on a real interaction, and every one of them is
     guarded, so a page with none of these elements behaves exactly as before. */
  (function wireSound() {
    /* Buttons and button-styled links. */
    document.addEventListener('click', function (e) {
      if (!Sound.isOn()) return;
      var el = e.target.closest ? e.target.closest('.btn, .tier__cta, .demo__tab, .tc__pick') : null;
      if (!el) return;
      if (el.getAttribute('data-sound-toggle') !== null) return; /* set() already played */
      Sound.tap();
    }, true);

    /* The onboarding form: a note when a step completes, a chord when it lands. */
    var form = $('[data-apply-form]');
    if (form) {
      form.addEventListener('click', function (e) {
        var el = e.target.closest ? e.target.closest('[data-form-next], [data-form-back]') : null;
        if (el) Sound.step();
      });
      form.addEventListener('submit', function () { Sound.done(); });
    }

    /* The scan card: a low tick as each new reading lands. This subscribes to
       the card rather than running its own timer, so the sound cannot drift
       out of step with what is on screen. */
    if ($('[data-holo]')) {
      scanHook = function () { Sound.tick(); };
    }
  })();

  /* ---------- reading progress bar ---------- */
  var readbar = $('[data-readbar]');
  if (readbar) {
    var paintRead = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var pct = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      readbar.style.width = (pct * 100).toFixed(2) + '%';
    };
    paintRead();
    window.addEventListener('scroll', paintRead, { passive: true });
    window.addEventListener('resize', paintRead);
  }

  /* ---------- back to top with progress ring ---------- */
  var totop = $('[data-totop]');
  if (totop) {
    var ring = $('[data-totop-ring]', totop);
    var RING = 2 * Math.PI * 21;
    ring.style.strokeDasharray = String(RING);
    var paintTop = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var pct = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      ring.style.strokeDashoffset = String(RING * (1 - pct));
      totop.classList.toggle('is-on', window.scrollY > window.innerHeight * 0.7);
    };
    paintTop();
    window.addEventListener('scroll', paintTop, { passive: true });
    window.addEventListener('resize', paintTop);
    totop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  /* ---------- sticky section nav on the homepage ---------- */
  var subnav = $('[data-subnav]');
  if (subnav) {
    var links = $$('[data-subnav-link]', subnav);
    var live = resolveTargets(links);

    var syncNav = function () {
      var y = window.scrollY + 140;
      var active = -1;
      for (var i = 0; i < live.length; i++) {
        if (live[i].offsetTop <= y) active = i;
      }
      var pastHero = window.scrollY > 260;
      subnav.hidden = !pastHero;
      for (var j = 0; j < links.length; j++) {
        links[j].classList.toggle('is-active', j === active);
      }
    };
    syncNav();
    window.addEventListener('scroll', syncNav, { passive: true });
    window.addEventListener('resize', syncNav);
  }

  /* ---------- legal page table of contents ---------- */
  var toc = $('.toc');
  if (toc) {
    var tocLinks = $$('a', toc);
    var liveToc = resolveTargets(tocLinks);
    if (liveToc.length) {
      var syncToc = function () {
        var y = window.scrollY + 150;
        var active = 0;
        for (var i = 0; i < liveToc.length; i++) {
          if (liveToc[i].offsetTop <= y) active = i;
        }
        for (var j = 0; j < tocLinks.length; j++) {
          tocLinks[j].classList.toggle('is-active', j === active);
        }
      };
      syncToc();
      window.addEventListener('scroll', syncToc, { passive: true });
    }
  }

  /* ---------- theme toggle ---------- */
  var themeBtns = $$('[data-theme-set]');
  if (themeBtns.length) {
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    var syncTheme = function (mode) {
      document.documentElement.setAttribute('data-theme', mode);
      themeBtns.forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-set') === mode));
      });
      if (metaTheme) metaTheme.setAttribute('content', mode === 'dark' ? '#0A0F10' : '#FFFFFF');
    };
    syncTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

    themeBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-theme-set');
        syncTheme(mode);
        try { localStorage.setItem('verafo-theme', mode); } catch (e) { /* private mode */ }
      });
    });

    // Follow the system setting only while the visitor has not chosen one.
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onSystem = function (e) {
        var stored = null;
        try { stored = localStorage.getItem('verafo-theme'); } catch (err) { /* ignore */ }
        if (!stored) syncTheme(e.matches ? 'dark' : 'light');
      };
      if (mq.addEventListener) mq.addEventListener('change', onSystem);
      else if (mq.addListener) mq.addListener(onSystem);
    }
  }


/* ---------- buyer scan card ----------
     Cycles through four risk readings. Each entry carries its own level,
     which drives the accent colour for the verdict, all three bars and the
     checkout line, so the card is always one consistent colour. */
  var holo = $('[data-holo]');
  if (holo) {
    var holoStage = $('[data-holo-stage]', holo);
    var holoCard = $('[data-holo-card]', holo);
    var elVerdict = $('[data-holo-verdict]', holo);
    var elMeta = $('[data-holo-meta]', holo);
    var elId = $('[data-holo-id]', holo);
    var elAction = $('[data-holo-action]', holo);
    var elCursor = $('.holo__cursor', holo);
    var bars = $$('[data-holo-bar]', holo);
    var pcts = $$('[data-holo-pct]', holo);

    /* Four readings, cycled in order. Each carries its own level, which
       drives the accent colour for the verdict, the bars and the checkout
       line, plus the verdict word and the action that belongs with it.

       The action is what makes the level legible:
         SAFE         no restriction at all
         MEDIUM RISK  COD still offered, but nudged toward prepaid
         RISKY        cash on delivery withdrawn
         NEUTRAL      not enough history to be sure, so flagged to watch */
    var SCANS = [
      { verdict: 'SAFE', level: 'safe',
        meta: '18 orders \u00b7 0 refusals \u00b7 94% confidence',
        bars: [8, 92, 88], action: 'COD shown normally', tail: '8207' },
      { verdict: 'MEDIUM RISK', level: 'medium',
        meta: '1 refusal \u00b7 2 stores \u00b7 67% confidence',
        bars: [44, 51, 62], action: 'Prepaid nudge', tail: '2288' },
      { verdict: 'RISKY', level: 'high',
        meta: '6 refusals \u00b7 3 stores \u00b7 81% confidence',
        bars: [72, 34, 58], action: 'COD hidden', tail: '1190' },
      { verdict: 'NEUTRAL', level: 'neutral',
        meta: 'No history yet \u00b7 scored from metadata',
        bars: [26, 14, 70], action: 'Ship with care', tail: '7714' }
    ];

    var scanIdx = 0;

    /* Whether the card is on screen at all. The reading keeps cycling either
       way, but the tick stays quiet when the card is scrolled past, so a
       visitor reading the footer never hears it. */
    var holoVisible = true;
    if (window.IntersectionObserver) {
      new window.IntersectionObserver(function (entries) {
        entries.forEach(function (en) { holoVisible = en.isIntersecting; });
      }, { threshold: 0.25 }).observe(holo);
    }

    /* Writes one reading to the card.

       Elements are re-queried on every call rather than held in variables
       from startup. A cached node reference is the one thing that can go
       stale silently, and a stale reference here means the card freezes
       while the rest of it keeps changing — which is exactly what happened.
       Re-querying costs nothing at four calls a minute. */
    function writeText(sel, value) {
      var el = holo.querySelector(sel);
      if (el) el.textContent = value;
    }

    function applyScan(scan) {
      writeText('[data-holo-verdict]', scan.verdict);
      writeText('[data-holo-meta]', scan.meta);
      writeText('[data-holo-id]', '\u2022\u2022\u2022\u2022 ' + scan.tail);
      writeText('[data-holo-action]', scan.action);
      holo.setAttribute('data-level', scan.level);

      var bs = holo.querySelectorAll('[data-holo-bar]');
      for (var i = 0; i < bs.length; i++) {
        if (scan.bars[i] == null) continue;
        bs[i].style.width = scan.bars[i] + '%';
      }

      var ps = holo.querySelectorAll('[data-holo-pct]');
      for (var j = 0; j < ps.length; j++) {
        if (scan.bars[j] == null) continue;
        ps[j].textContent = scan.bars[j] + '%';
      }

      /* Tell any listener that a new reading has actually landed. The sound
         layer subscribes here rather than running its own timer, so the tick
         cannot drift out of step with the card, and it fires only when the
         card is genuinely rendering and actually on screen. */
      if (scanHook && holoVisible) scanHook();
    }

    function nextScan() {
      scanIdx = scanIdx + 1;
      if (scanIdx >= SCANS.length) scanIdx = 0;
      applyScan(SCANS[scanIdx]);
    }

    window.__verafoNextScan = nextScan;

    setInterval(function () {
      if (document.hidden) return;
      nextScan();
    }, 4200);

    /* ---------- 3D levitation ----------
       The stage takes the tilt because it is the only element with
       transform-style: preserve-3d, so its children can be pushed apart in
       Z and the card gains real depth. Written through CSS custom
       properties so the stylesheet keeps control of the transform order,
       and rAF-throttled so a busy pointer cannot flood the main thread. */
    var canHover = window.matchMedia &&
                   window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    if (canHover && holoStage && !reduce) {
      var tx = 0, ty = 0, cx = 0, cy = 0, tiltRaf = null, live = false;

      var tiltLoop = function () {
        cx += (tx - cx) * 0.14;
        cy += (ty - cy) * 0.14;
        holoStage.style.setProperty('--ry', cx.toFixed(2) + 'deg');
        holoStage.style.setProperty('--rx', (-cy).toFixed(2) + 'deg');

        if (Math.abs(tx - cx) > 0.04 || Math.abs(ty - cy) > 0.04) {
          tiltRaf = requestAnimationFrameSafe(tiltLoop);
        } else {
          tiltRaf = null;
        }
      };

      var kick = function () { if (!tiltRaf) tiltRaf = requestAnimationFrameSafe(tiltLoop); };

      holo.addEventListener('pointermove', function (e) {
        var r = holo.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;

        // Tilt range. Larger values read as a bigger lift.
        tx = (px - 0.5) * 26;
        ty = (py - 0.5) * 18;

        if (elCursor) {
          elCursor.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
          elCursor.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        }

        if (!live) { live = true; holoStage.classList.add('is-live'); }
        kick();
      });

      holo.addEventListener('pointerleave', function () {
        tx = 0; ty = 0;
        live = false;
        holoStage.classList.remove('is-live');
        kick();
      });

      // Stop the loop entirely once the card scrolls away.
      if (window.IntersectionObserver) {
        new window.IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) return;
            tx = 0; ty = 0; cx = 0; cy = 0;
            if (tiltRaf) { cancelAnimationFrameSafe(tiltRaf); tiltRaf = null; }
            holoStage.style.setProperty('--rx', '0deg');
            holoStage.style.setProperty('--ry', '0deg');
            live = false;
            holoStage.classList.remove('is-live');
          });
        }, { threshold: 0 }).observe(holo);
      }
    }
  }

  /* ---------- interactive split chart ---------- */
  var chart = $('[data-chart]');
  if (chart) {
    var SEG = {
      cod: { val: '80%', lab: 'of orders are cash on delivery', on: 'cod',
             line: 'Four out of every five orders you pack are paid for at the door, or not at all. <b>That is the whole problem in one number.</b>' },
      pre: { val: '20%', lab: 'of orders are paid upfront', on: 'pre',
             line: 'Only one in five buyers commits money at checkout. The rest are intentions until a stranger knocks on their door.' }
    };
    var segs = $$('.donut__seg', chart);
    var btns = $$('[data-chart-btn]', chart);
    var valEl = $('[data-donut-val]', chart);
    var labEl = $('[data-donut-lab]', chart);
    var lineEl = $('[data-chart-line]', chart);

    var select = function (key) {
      var d = SEG[key];
      if (!d) return;
      valEl.textContent = d.val;
      labEl.textContent = d.lab;
      lineEl.innerHTML = d.line;
      segs.forEach(function (s) {
        var mine = s.getAttribute('data-seg') === key;
        s.classList.toggle('is-on', mine);
        s.classList.toggle('is-dim', !mine);
      });
      btns.forEach(function (b) {
        var mine = b.getAttribute('data-chart-btn') === key;
        b.classList.toggle('is-on', mine);
        b.setAttribute('aria-pressed', String(mine));
      });
    };

    btns.forEach(function (b) {
      b.addEventListener('click', function () { select(b.getAttribute('data-chart-btn')); });
    });
    segs.forEach(function (s) {
      var go = function () { select(s.getAttribute('data-seg')); };
      s.addEventListener('click', go);
      s.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  /* ---------- sign-in portal ---------- */
  var login = $('[data-login-form]');
  if (login) {
    var lEmail = $('#l-email', login);
    var lPass = $('#l-pass', login);
    var lErr = $('[data-login-err]', login);
    var lSubmit = $('[data-login-submit]', login);

    // Show / hide password
    var toggle = $('[data-pass-toggle]', login);
    if (toggle && lPass) {
      toggle.addEventListener('click', function () {
        var shown = lPass.type === 'text';
        lPass.type = shown ? 'password' : 'text';
        toggle.setAttribute('aria-pressed', String(!shown));
        toggle.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
        lPass.focus({ preventScroll: true });
      });
    }

    var lMark = function (el, bad) {
      var f = el.closest('.field');
      if (f) f.classList.toggle('is-bad', bad);
    };

    [lEmail, lPass].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', function () {
        lMark(el, false);
        if (lErr) lErr.hidden = true;
      });
    });

    login.addEventListener('submit', function (e) {
      e.preventDefault();
      var problems = [];

      if (!lEmail.value.trim()) {
        lMark(lEmail, true); problems.push(lEmail);
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lEmail.value.trim())) {
        lMark(lEmail, true); problems.push(lEmail);
      }
      if (!lPass.value) {
        lMark(lPass, true); problems.push(lPass);
      }

      if (problems.length) {
        lErr.textContent = problems.length === 1 && problems[0] === lPass
          ? 'Enter your password to continue.'
          : 'Check the highlighted fields and try again.';
        lErr.hidden = false;
        problems[0].focus({ preventScroll: true });
        return;
      }

      lErr.hidden = true;

      if (!VERAFO_AUTH_ENDPOINT) {
        // No auth service on this side. Hand the merchant over to the app,
        // which owns the session. This page never claims to have signed
        // anyone in, and it keeps no copy of the password.
        lSubmit.disabled = true;
        lSubmit.textContent = 'Opening your dashboard…';
        location.href = VERAFO_APP_URL;
        return;
      }

      var label = lSubmit.innerHTML;
      lSubmit.disabled = true;
      lSubmit.textContent = 'Signing in…';

      fetch(VERAFO_AUTH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: lEmail.value.trim(),
          password: lPass.value,
          remember: !!login.querySelector('[name="remember"]').checked
        })
      }).then(function (r) {
        if (!r.ok) throw new Error('bad credentials');
        return r.json().catch(function () { return {}; });
      }).then(function (data) {
        if (data && data.redirect) { location.href = data.redirect; return; }
        location.href = VERAFO_APP_URL;
      }).catch(function () {
        lSubmit.disabled = false;
        lSubmit.innerHTML = label;
        lPass.value = '';
        lErr.textContent = 'That email and password did not match. Try again, or reset your password.';
        lErr.hidden = false;
        lPass.focus({ preventScroll: true });
      });
    });
  }

  /* ---------- founding spots, driven from VERAFO_FOUNDING ---------- */
  if (window.VERAFO_FOUNDING || typeof VERAFO_FOUNDING !== 'undefined') {
    var F = VERAFO_FOUNDING;
    var left = Math.max(0, F.total - F.claimed);

    /* Both hooks show the same number: the footer line and the Founder card's
       counter, which now reads "Only 13 Spots Left". */
    $$('[data-spots-inline],[data-spots-left]').forEach(function (el) {
      el.textContent = String(left);
    });

    /* The bar still shows the proportion claimed, so it keeps reading from both
       figures even though the card no longer prints them. */
    $$('[data-spots-bar]').forEach(function (el) {
      var w = Math.round((F.claimed / F.total) * 100) + '%';
      el.style.width = w;
      el.style.setProperty('--spots', w);
    });
  }

  /* ---------- mobile sticky CTA ---------- */
  var mcta = $('[data-mobile-cta]');
  if (mcta) {
    var applySec = $('#apply');
    var paintCta = function () {
      var y = window.scrollY;
      var past = y > 700;
      // Hide once the form itself is on screen; the bar has done its job.
      var atForm = applySec && (applySec.getBoundingClientRect().top < window.innerHeight * 0.85);
      var on = past && !atForm;
      mcta.classList.toggle('is-on', on);
      mcta.setAttribute('aria-hidden', String(!on));
      var link = mcta.querySelector('a');
      if (link) link.tabIndex = on ? 0 : -1;
    };
    paintCta();
    window.addEventListener('scroll', paintCta, { passive: true });
    window.addEventListener('resize', paintCta);
  }

  /* ---------- pricing band: stagger the cards, fill the scarcity bar ---------- */
  $$('.sec--pricing-dark').forEach(function (sec) {
    if (!window.IntersectionObserver) { sec.classList.add('is-in'); return; }
    var io = new window.IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        sec.classList.add('is-in');
        io.disconnect();
      });
    }, { threshold: 0.16 });
    io.observe(sec);
  });

  /* ---------- motion polish ----------
     Every effect here is opt-in on hover-capable, motion-tolerant devices,
     is driven by requestAnimationFrame rather than the raw pointer event,
     and only touches transform or opacity so nothing triggers layout. */
  var canHover = window.matchMedia &&
                 window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (canHover && !reduce) {
    /* Buttons lean toward the cursor. Small on purpose: a few pixels reads
       as responsiveness, more reads as a gimmick. */
    $$('[data-magnet]').forEach(function (el) {
      var raf = null, tx = 0, ty = 0, cx = 0, cy = 0;

      var loop = function () {
        cx += (tx - cx) * 0.18;
        cy += (ty - cy) * 0.18;
        el.style.transform = 'translate(' + cx.toFixed(2) + 'px,' + cy.toFixed(2) + 'px)';
        if (Math.abs(tx - cx) > 0.1 || Math.abs(ty - cy) > 0.1) {
          raf = requestAnimationFrameSafe(loop);
        } else {
          raf = null;
        }
      };
      var kick = function () { if (!raf) raf = requestAnimationFrameSafe(loop); };

      el.addEventListener('pointerenter', function () { el.classList.add('magnet'); });
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        tx = ((e.clientX - r.left) / r.width - 0.5) * 2 * 6;
        ty = ((e.clientY - r.top) / r.height - 0.5) * 2 * 5;
        kick();
      });
      el.addEventListener('pointerleave', function () {
        tx = 0; ty = 0;
        kick();
      });
    });

    /* The price cards carry a light that follows the cursor, written as
       custom properties so the gradient stays in the stylesheet. */
    $$('.tier').forEach(function (tier) {
      tier.addEventListener('pointermove', function (e) {
        var r = tier.getBoundingClientRect();
        tier.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        tier.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    });
  }

  /* ---------- calculator: pulse the figure when it changes ---------- */
  var calcOut = $('[data-calc-loss]');
  if (calcOut && !reduce) {
    var pulseObserver = new MutationObserver(function () {
      if (calcOut.classList.contains('is-hit')) return;
      calcOut.classList.add('is-hit');
      setTimeout(function () { calcOut.classList.remove('is-hit'); }, 440);
    });
    pulseObserver.observe(calcOut, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- year ---------- */
  $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ---------- sticky header ---------- */
  var head = $('#siteHead');
  if (head) {
    var onScroll = function () {
      head.classList.toggle('is-stuck', window.scrollY > 12);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- mobile nav ---------- */
  var burger = $('[data-burger]');
  var mnav = $('[data-mobile-nav]');
  if (burger && mnav) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      mnav.hidden = open;
    });
    $$('a', mnav).forEach(function (a) {
      a.addEventListener('click', function () {
        burger.setAttribute('aria-expanded', 'false');
        mnav.hidden = true;
      });
    });
  }

  /* ---------- scroll reveal ---------- */
  var reveals = $$('.reveal');
  if (!reduce && window.IntersectionObserver) {
    var ro = new window.IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var sibs = Array.prototype.slice.call(el.parentNode.children).filter(function (c) {
          return c.classList && c.classList.contains('reveal');
        });
        var i = Math.max(0, sibs.indexOf(el));
        el.style.transitionDelay = Math.min(i * 70, 420) + 'ms';
        el.classList.add('in');
        ro.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { ro.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* Safety net: if the observer never fires for an element (an unusual
     viewport, a very short page, a browser quirk), never leave content
     stranded at opacity 0. */
  if (!reduce) {
    setTimeout(function () {
      reveals.forEach(function (el) { el.classList.add('in'); });
    }, 2600);
  }

  /* ---------- the verdict drawer ---------- */
  /* Opens as the section arrives, retracts once it has been passed, and opens
     again on the way back up. That is the opposite contract to .reveal, which is
     one-shot and unobserves after firing — so this gets its own observer instead
     of being folded into the one above.

     Below 1000px the panels stack and the CSS does not use this class at all,
     but toggling it is harmless there. */
  var drawerStacks = $$('.vflow-stack');
  if (drawerStacks.length) {
    if (reduce || !window.IntersectionObserver) {
      drawerStacks.forEach(function (el) { el.classList.add('is-open'); });
    } else {
      var drawerIo = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          e.target.classList.toggle('is-open', e.isIntersecting);
        });
      }, { threshold: 0.3 });
      drawerStacks.forEach(function (el) { drawerIo.observe(el); });
    }
  }

  /* ---------- animated counters ---------- */
  function countUp(el) {
    var raw = el.getAttribute('data-count');
    if (raw === null) return;
    var target = parseFloat(raw);
    if (isNaN(target)) return;
    if (reduce) { el.textContent = group(target); return; }
    var dur = 1100, t0 = null;
    function tick(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = group(target * eased);
      if (p < 1) requestAnimationFrameSafe(tick);
      else el.textContent = group(target);
    }
    requestAnimationFrameSafe(tick);
  }
  var counters = $$('[data-count]');
  if (counters.length) {
    if (window.IntersectionObserver) {
      var co = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          countUp(e.target);
          co.unobserve(e.target);
        });
      }, { threshold: 0.5 });
      counters.forEach(function (el) { co.observe(el); });
    } else {
      counters.forEach(countUp);
    }
  }

  /* ---------- loss calculator ---------- */
  var calc = $('[data-calc]');
  if (calc) {
    var iOrders = $('[data-calc-orders]', calc);
    var iAov = $('[data-calc-aov]', calc);
    var iRate = $('[data-calc-rate]', calc);
    var oOrders = $('[data-calc-orders-out]', calc);
    var oAov = $('[data-calc-aov-out]', calc);
    var oRate = $('[data-calc-rate-out]', calc);
    var oLoss = $('[data-calc-loss]', calc);
    var oRefused = $('[data-calc-refused]', calc);
    var oYear = $('[data-calc-year]', calc);

    /* Composition of the same loss. The three shares are fixed proportions of
       a refused parcel's cost, so only the amounts change as the sliders move,
       not the shape of the bar. */
    var SHARE = { a: 0.22, b: 0.44, c: 0.34 };
    var compSeg = {
      a: $('[data-comp-seg="a"]', calc),
      b: $('[data-comp-seg="b"]', calc),
      c: $('[data-comp-seg="c"]', calc)
    };
    var compVal = {
      a: $('[data-comp-val="a"]', calc),
      b: $('[data-comp-val="b"]', calc),
      c: $('[data-comp-val="c"]', calc)
    };

    var render = function () {
      var orders = +iOrders.value;
      var aov = +iAov.value;
      var rate = +iRate.value;

      var refused = orders * rate / 100;
      var monthly = refused * aov;

      oOrders.textContent = group(orders);
      oAov.textContent = pkr(aov);
      oRate.textContent = rate + '%';
      oRefused.textContent = group(refused);
      oLoss.textContent = pkr(monthly);
      oYear.textContent = pkr(monthly * 12);

      ['a', 'b', 'c'].forEach(function (k) {
        if (compSeg[k]) compSeg[k].style.width = (SHARE[k] * 100).toFixed(0) + '%';
        if (compVal[k]) compVal[k].textContent = pkr(monthly * SHARE[k]);
      });
    };

    [iOrders, iAov, iRate].forEach(function (input) {
      input.addEventListener('input', render);
    });
    render();
  }

  /* ---------- buyer scoring demo ---------- */
  var BUYERS = {
    amina: {
      score: 0.12, verdict: 'LOW RISK', tone: 'low', color: '#0F766E',
      orders: 18, refused: 0, stores: 1, conf: '94%',
      action: 'Cash on delivery shown normally',
      signals: [
        ['down', 'Accepted every parcel across 18 orders'],
        ['down', 'Delivery address matches her registered area'],
        ['down', 'No failed attempts recorded on this number']
      ]
    },
    bilal: {
      score: 0.87, verdict: 'HIGH RISK', tone: 'high', color: '#BE123C',
      orders: 9, refused: 6, stores: 3, conf: '97%',
      action: 'COD hidden at checkout. Prepaid only.',
      signals: [
        ['up', 'Refused 6 of 9 cash on delivery orders'],
        ['up', 'Flagged at two other stores in the network'],
        ['up', 'Same refusal pattern repeats within 48 hours of ordering']
      ]
    },
    sana: {
      score: 0.38, verdict: 'MEDIUM RISK', tone: 'mid', color: '#B45309',
      orders: 4, refused: 1, stores: 2, conf: '81%',
      action: 'COD shown with a prepaid nudge. You decide.',
      signals: [
        ['up', 'One refusal recorded 22 days ago'],
        ['up', 'Two addresses used in the last 40 days'],
        ['down', 'Small order values, consistently accepted since']
      ]
    },
    usman: {
      score: 0.00, verdict: 'UNKNOWN', tone: 'unknown', color: '#6D28D9',
      orders: 0, refused: 0, stores: 0, conf: 'Cold start',
      action: 'Scored from metadata until 3 orders accumulate.',
      signals: [
        ['up', 'No purchase history anywhere in the network yet'],
        ['down', 'Address resolves to a low-refusal district'],
        ['down', 'Order placed inside normal business hours']
      ]
    }
  };

  var demo = $('[data-demo]');
  if (demo) {
    var tabs = $$('.demo__tab', demo);
    var elScore = $('[data-demo-score]', demo);
    var elVerdict = $('[data-demo-verdict]', demo);
    var elOrders = $('[data-demo-orders]', demo);
    var elRefused = $('[data-demo-refused]', demo);
    var elStores = $('[data-demo-stores]', demo);
    var elConf = $('[data-demo-conf]', demo);
    var elSignals = $('[data-demo-signals]', demo);
    var elAction = $('[data-demo-action]', demo);
    var gauge = $('[data-gauge]', demo);
    var CIRC = 2 * Math.PI * 82;

    var paint = function (key) {
      var b = BUYERS[key];
      if (!b) return;

      elScore.textContent = b.score.toFixed(2);
      elVerdict.textContent = b.verdict;
      elVerdict.className = 'demo__verdict risk-' + (b.tone === 'mid' ? 'mid' : b.tone);
      elVerdict.style.color = b.color;

      elOrders.textContent = b.orders;
      elRefused.textContent = b.refused;
      elStores.textContent = b.stores;
      elConf.textContent = b.conf;

      gauge.style.stroke = b.color;
      gauge.style.strokeDashoffset = String(CIRC * (1 - b.score));

      elSignals.innerHTML = '';
      b.signals.forEach(function (s, i) {
        var li = document.createElement('li');
        li.setAttribute('data-dir', s[0]);
        li.textContent = s[1];
        li.style.animationDelay = (i * 90 + 60) + 'ms';
        elSignals.appendChild(li);
      });

      elAction.querySelector('.demo__action-v').textContent = b.action;
    };

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          t.classList.remove('is-on');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('is-on');
        tab.setAttribute('aria-selected', 'true');
        paint(tab.getAttribute('data-buyer'));
      });
    });

    // Seed the gauge without a transition on first paint.
    gauge.style.transition = 'none';
    gauge.style.strokeDashoffset = String(CIRC);
    requestAnimationFrameSafe(function () {
      gauge.style.transition = '';
      paint('amina');
    });
  }

  /* ---------- onboarding form ---------- */
  var form = $('[data-apply-form]');
  if (form) {
    var sets = $$('[data-form-set]', form);
    var stepLabel = $('[data-form-step]', form);
    var errBox = $('[data-form-err]', form);
    var done = $('[data-form-done]', form);
    var storeBox = $('[data-form-store]', form);
    var JSON_LABEL = ['Your store', 'Your orders', 'Your details'];
    var current = 0;

    /* The skeleton is three dots now: the step you are on is is-now, the ones
       behind you are is-done. The live summary that used to sit beside each dot
       repeated what the fields above already showed, so it went, and this keeps
       only the state the dots need. */
    function paintSkeleton() {
      for (var s = 1; s <= 3; s++) {
        var col = form.querySelector('[data-fs-col="' + s + '"]');
        if (!col) continue;
        col.classList.toggle('is-done', s < current + 1);
        col.classList.toggle('is-now', s === current + 1);

        var sum = form.querySelector('[data-fs-sum="' + s + '"]');
        if (sum) sum.textContent = summarize(s);
      }

      // Echo the brand being applied for back on the final step, so the last
      // screen confirms what the first one captured.
      var reco = form.querySelector('[data-form-reco]');
      if (reco) {
        var storeEl = form.querySelector('[name="store"]');
        var store = storeEl ? String(storeEl.value).trim() : '';
        reco.hidden = !store;
        var strong = reco.querySelector('b');
        if (strong) strong.textContent = store;
      }
    }

    /* The panel slides up as it arrives going forward and down coming back, so
       the direction of travel is legible without reading the step label. The
       attribute is cleared on animationend so the next change re-triggers it
       rather than silently reusing the same keyframes. */
    function directionFor(next, prev) {
      if (next > prev) return 'fwd';
      if (next < prev) return 'back';
      return '';
    }

    function showStep(n, focus) {
      var prev = current;
      current = Math.max(0, Math.min(sets.length - 1, n));
      var dir = directionFor(current, prev);

      sets.forEach(function (s, i) {
        s.hidden = i !== current;
        if (i === current && dir) s.setAttribute('data-dir', dir);
        else s.removeAttribute('data-dir');
      });

      /* Just the step name. "Step 2 of 3 · Your orders" repeated the dots above
         and the legend below; the dots already show position. */
      stepLabel.textContent = JSON_LABEL[current];
      paintSkeleton();
      errBox.hidden = true;
      // Only steal focus when the visitor moved a step themselves. Focusing on
      // first paint would drag the page down to the form on load.
      if (focus) {
        var first = sets[current].querySelector('input, select, textarea');
        if (first) first.focus({ preventScroll: true });
      }
    }

    function markBad(el, bad) {
      var field = el.closest('.field') || el.closest('.check');
      if (field) field.classList.toggle('is-bad', bad);
    }

    /* ---------- inline hints under each field ---------- */
    var hintSeq = 0;
    function hintFor(el) {
      var field = el.closest('.field') || el.closest('.check');
      if (!field) return null;
      var hint = field.querySelector('.field__hint');
      if (!hint) {
        hint = document.createElement('span');
        hint.className = 'field__hint';
        if (!el.id) el.id = 'f-auto-' + (++hintSeq);
        hint.id = el.id + '-hint';
        // Announce the message to screen readers and tie it to the input.
        hint.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-describedby', hint.id);
        field.appendChild(hint);
      }
      return hint;
    }

    function messageFor(el) {
      var v = String(el.value).trim();
      if (!v) {
        if (el.tagName === 'SELECT') return 'Choose one of the options.';
        return 'This one is needed.';
      }
      if (el.type === 'email') return 'That email does not look complete.';
      if (el.type === 'tel') return 'Add a full number we can reach you on.';
      if (el.id === 'f-url') return 'Paste your store address, for example yourstore.myshopify.com.';
      return 'Check this field.';
    }

    /* ---------- phone formatting ---------- */
    var phone = $('input[type=tel]', form);
    if (phone) {
      phone.addEventListener('input', function () {
        var d = phone.value.replace(/\D/g, '');
        if (d.indexOf('92') === 0 && d.length > 2) d = '0' + d.slice(2);
        var out = d.slice(0, 4);
        if (d.length > 4) out += ' ' + d.slice(4, 11);
        phone.value = out;
      });
    }

    /* ---------- autosave so a refresh never loses the work ---------- */
    var DRAFT_KEY = 'verafo_application_draft';
    function fieldsAll() { return $$('input, select, textarea', form); }

    function saveDraft() {
      try {
        var d = {};
        fieldsAll().forEach(function (el) {
          if (!el.name) return;
          d[el.name] = el.type === 'checkbox' ? el.checked : el.value;
        });
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      } catch (e) { /* private mode */ }
    }

    function loadDraft() {
      var raw;
      try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) { return; }
      if (!raw) return;
      var d;
      try { d = JSON.parse(raw); } catch (e) { return; }
      var used = false;
      fieldsAll().forEach(function (el) {
        if (!el.name || !(el.name in d)) return;
        if (el.type === 'checkbox') el.checked = !!d[el.name];
        else el.value = d[el.name];
        used = true;
      });
      // If the first two steps are already complete, drop them on the last step.
      if (used) {
        var filled = function (i) {
          return $$('input, select, textarea', sets[i]).every(function (el) {
            if (el.type === 'checkbox') return true;
            return !el.required || String(el.value).trim();
          });
        };
        if (filled(0) && filled(1)) showStep(2, false);
        else if (filled(0)) showStep(1, false);
      }
    }

    function clearDraft() {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    }

    form.addEventListener('input', function (e) {
      if (e.target.matches('input, select, textarea')) {
        markBad(e.target, false);
        var h = e.target.closest('.field') && e.target.closest('.field').querySelector('.field__hint');
        if (h) { h.textContent = ''; h.classList.remove('is-on'); }
        saveDraft();
        paintSkeleton();
      }
    });
    form.addEventListener('change', function (e) {
      if (e.target.matches('input, select, textarea')) {
        markBad(e.target, false);
        saveDraft();
        paintSkeleton();
      }
    });

    function validateStep(i) {
      var set = sets[i];
      var fields = $$('input, select, textarea', set);
      var problems = [];

      fields.forEach(function (el) {
        var bad = false;
        if (el.type === 'checkbox') {
          bad = el.required && !el.checked;
        } else if (el.required) {
          bad = !String(el.value).trim();
          if (!bad && el.type === 'email') {
            bad = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(el.value.trim());
          }
          if (!bad && el.type === 'tel') {
            var digits = el.value.replace(/\D/g, '');
            bad = digits.length < 7;
          }
        }
        if (bad) {
          var hint = hintFor(el);
          if (hint) { hint.textContent = messageFor(el); hint.classList.add('is-on'); }
        }
        markBad(el, bad);
        if (bad) problems.push(el);
      });

      if (problems.length) {
        var messages = {
          1: 'Please fill in the highlighted fields so we know which store we are onboarding.',
          2: 'One of these answers is missing. It decides how much Verafo can save you.',
          3: 'Check the highlighted fields, including the consent box, and send it through.'
        };
        errBox.textContent = messages[i + 1] || 'Please complete the highlighted fields.';
        errBox.hidden = false;
        problems[0].focus({ preventScroll: true });
        return false;
      }
      errBox.hidden = true;
      return true;
    }

    function clearHints(set) {
      $$('.field__hint', set).forEach(function (h) {
        h.textContent = '';
        h.classList.remove('is-on');
      });
    }

    $$('[data-form-next]', form).forEach(function (btn) {
      btn.addEventListener('click', function () {
        clearHints(sets[current]);
        if (!validateStep(current)) return;
        showStep(current + 1, true);
        scrollToEl(form, 'center');
      });
    });

    $$('[data-form-back]', form).forEach(function (btn) {
      btn.addEventListener('click', function () { showStep(current - 1, true); });
    });

    form.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.target.tagName === 'TEXTAREA') return;
      if (e.target.closest('[data-form-set="3"]')) return;
      e.preventDefault();
      var next = sets[current] && sets[current].querySelector('[data-form-next]');
      if (next) next.click();
    });

    function collect() {
      var data = {};
      $$('input, select, textarea', form).forEach(function (el) {
        if (!el.name) return;
        data[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
      });
      data.submitted_at = new Date().toISOString();
      data.source = location.href;
      return data;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearHints(sets[2]);
      if (!validateStep(2)) return;

      var payload = collect();

      /* A short burst of sparks from the tick, so a successful send lands
         with a bit of weight. Built once and removed when it finishes, and
         skipped entirely under reduced motion. */
      var sparkBurst = function () {
        if (reduce) return;
        var ico = $('.form__done-ico', form);
        if (!ico) return;
        var box = document.createElement('span');
        box.className = 'burst';
        box.setAttribute('aria-hidden', 'true');
        for (var i = 0; i < 12; i++) {
          var spark = document.createElement('i');
          spark.style.setProperty('--d', (46 + Math.random() * 34).toFixed(0) + 'px');
          spark.style.rotate = (i * 30) + 'deg';
          spark.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
          box.appendChild(spark);
        }
        ico.appendChild(box);
        setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 1400);
      };

      var finish = function (delivered) {
        sets.forEach(function (s) { s.hidden = true; });
        stepLabel.hidden = true;
        // The skeleton has done its job once the form is submitted; leaving it
        // on screen next to the success panel would read as unfinished.
        var skel = $('.fs', form);
        if (skel) skel.hidden = true;
        done.hidden = false;
        scrollToEl(form, 'center');
        sparkBurst();

        // Show the copyable submission whenever it did not reach a server,
        // whether that is because none is configured or because the send failed.
        if (!delivered) {
          storeBox.hidden = false;
          $('[data-form-json]', form).value = JSON.stringify(payload, null, 2);
        }
      };

      try {
        var key = 'verafo_applications';
        var saved = JSON.parse(localStorage.getItem(key) || '[]');
        saved.push(payload);
        localStorage.setItem(key, JSON.stringify(saved));
      } catch (err) { /* private mode: carry on */ }

      clearDraft();

      if (VERAFO_FORM_ENDPOINT) {
        fetch(VERAFO_FORM_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function (r) {
          finish(r && r.ok);
        }).catch(function () {
          // Never claim a submission was delivered when it was not.
          finish(false);
        });
      } else {
        finish(false);
      }
    });

    var copyBtn = $('[data-form-copy]', form);
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var ta = $('[data-form-json]', form);
        ta.select();
        var ok = function () {
          var was = copyBtn.textContent;
          copyBtn.textContent = 'Copied';
          setTimeout(function () { copyBtn.textContent = was; }, 1600);
        };
        if (navigator.clipboard) {
          navigator.clipboard.writeText(ta.value).then(ok, function () { document.execCommand('copy'); ok(); });
        } else {
          document.execCommand('copy');
          ok();
        }
      });
    }

    var again = $('[data-form-again]', form);
    if (again) {
      again.addEventListener('click', function () {
        form.reset();
        clearDraft();
        clearHints(sets[0]);
        clearHints(sets[1]);
        clearHints(sets[2]);
        storeBox.hidden = true;
        stepLabel.hidden = false;
        done.hidden = true;
        showStep(0, true);
      });
    }

    loadDraft();
    if (current === 0) showStep(0, false);
  }

  /* ---------- smooth anchor offset for in-page links ---------- */
  $$('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (!id || id === '#' || id.charAt(0) !== '#') return;
      var target = document.getElementById(id.slice(1));
      if (!target) return;
      e.preventDefault();
      var top = target.getBoundingClientRect().top + window.scrollY - 92;
      try {
        window.scrollTo({ top: top, behavior: reduce ? 'auto' : 'smooth' });
      } catch (err) {
        window.scrollTo(0, top);
      }
      // Throws a SecurityError on file:// URLs, where history is restricted.
      try {
        if (history.replaceState) history.replaceState(null, '', id);
      } catch (err) { /* not worth breaking the scroll over */ }
    });
  });

  // Reached only if every block above ran without throwing.
  window.__verafoReady = true;
  if (window.__diag) window.__diag.ran = true;

})();
