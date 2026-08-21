/* ============================================================
   James Kurian — portfolio behaviour
   Vanilla ES2018. No dependencies, no build step.

   Four jobs:
     1. Publish the real masthead height as --chrome.
     2. Light/dark theme switch. (The initial choice is made by a
        blocking inline script in <head>, not here — by the time
        this file runs the first paint has happened.)
     3. Reading progress bar + sticky index scroll-spy.
     4. The password gate — genuine AES-GCM decryption, not a
        show-and-hide over content that was in the page all along.
   ============================================================ */

(function () {
  "use strict";

  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* == 1 Chrome height =======================================
     .masthead__inner wraps at narrow widths, so its height is
     not a constant. Everything that positions against the
     masthead — the reading bar's 0% and 100% points, the rail's
     sticky offset, every chapter's scroll-margin-top — reads
     --chrome, so it has to be measured rather than guessed.
     Hardcoding it drifted anchors by ~9px on phones. */

  var masthead = document.querySelector("[data-masthead]");

  function publishChrome() {
    if (!masthead) return;
    var h = Math.round(masthead.getBoundingClientRect().height);
    if (h > 0) root.style.setProperty("--chrome", h + "px");
  }

  publishChrome();
  if (masthead && "ResizeObserver" in window) {
    new ResizeObserver(publishChrome).observe(masthead);
  } else {
    window.addEventListener("resize", publishChrome);
  }
  window.addEventListener("load", publishChrome);

  /* == 2 Theme switch ========================================
     The <head> script already applied the stored or preferred
     theme before first paint. This only handles the control:
     sync it to that decision, then flip on click.

     Three details worth naming:

     Persistence is per-choice, not always-on. Nothing is written
     until the visitor actually touches the switch, so someone who
     never touches it keeps following their OS as it changes
     through the day — writing a value on load would silently
     freeze them to whatever it happened to be on their first
     visit.

     theme-color moves with the theme, so the browser chrome on
     mobile matches the page instead of framing a white page in a
     charcoal bar.

     No transition is added on the swap. Cross-fading every colour
     on the page reads as a lag, not as polish, and on a long case
     study it means repainting the whole document mid-animation. */

  var THEME_KEY = "jk.theme";
  var themer = document.querySelector("[data-themer]");

  function store(value) {
    try { localStorage.setItem(THEME_KEY, value); } catch (e) {}
  }

  function currentTheme() {
    return root.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    if (themer) themer.setAttribute("aria-checked", String(theme === "light"));

    var meta = document.querySelector('meta[name="theme-color"]');
    var scheme = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      // Read the resolved page colour rather than repeating a hex here,
      // so the meta tag cannot drift away from the stylesheet.
      var surface = getComputedStyle(root).getPropertyValue("--void").trim();
      if (surface) meta.setAttribute("content", surface);
    }
    if (scheme) scheme.setAttribute("content", theme);
  }

  if (themer) {
    applyTheme(currentTheme());
    themer.addEventListener("click", function () {
      var next = currentTheme() === "light" ? "dark" : "light";
      applyTheme(next);
      store(next);
    });

    // Follow the OS while the visitor has expressed no preference of
    // their own; stop the moment they do.
    var mq = window.matchMedia("(prefers-color-scheme: light)");
    var onSystemChange = function (ev) {
      var chosen = null;
      try { chosen = localStorage.getItem(THEME_KEY); } catch (e) {}
      if (chosen === "light" || chosen === "dark") return;
      applyTheme(ev.matches ? "light" : "dark");
    };
    if (mq.addEventListener) mq.addEventListener("change", onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }

  /* == 3 Reading bar + rail scroll-spy =======================
     One rAF-throttled scroll pass drives both, because they are
     answering the same question: where in the article are we?
     Progress is measured against the <article>, not the
     document, so the bar reaches 100% at the last word rather
     than somewhere inside the footer. */

  var reading = null;

  /* How far in the rail's back-to-top link waits before appearing, counted
     in chapters passed. At the top of an article the link is a control that
     does nothing, so it arrives once the reader is past the third chapter and
     leaves again if they scroll back up.

     Counted in chapters rather than pixels on purpose: these three articles
     run 1,300 to 1,500 words over seven, eight and ten chapters, so any fixed
     scroll distance would mean a different fraction of each page. Chapters are
     also free — the scroll-spy already knows which one is active, so this adds
     no second listener and no second measurement to disagree with the first. */
  var TOP_AFTER = 3;

  function initReading() {
    var bar = document.querySelector("[data-readbar]");
    var article = document.querySelector("[data-article]");
    if (!article) return;

    var rail = document.querySelector("[data-rail]");
    var toTop = rail ? rail.querySelector("[data-totop]") : null;
    var links = rail ? Array.prototype.slice.call(rail.querySelectorAll("[data-spy]")) : [];
    var chapters = links
      .map(function (a) {
        var id = (a.getAttribute("href") || "").slice(1);
        var el = id ? document.getElementById(id) : null;
        return el ? { link: a, el: el } : null;
      })
      .filter(Boolean);

    var current = -1;
    var queued = false;

    function chromePx() {
      var v = parseFloat(getComputedStyle(root).getPropertyValue("--chrome"));
      return isNaN(v) ? 64 : v;
    }

    function pass() {
      queued = false;
      var chrome = chromePx();

      if (bar) {
        var box = article.getBoundingClientRect();
        var start = window.scrollY + box.top - chrome;
        var span = box.height - (window.innerHeight - chrome);
        var pct = span > 8 ? (window.scrollY - start) / span : (window.scrollY > start ? 1 : 0);
        pct = Math.max(0, Math.min(1, pct));
        bar.style.width = (pct * 100).toFixed(2) + "%";
        var track = bar.closest("[role='progressbar']");
        if (track) track.setAttribute("aria-valuenow", Math.round(pct * 100));
      }

      if (!chapters.length) return;

      /* The active chapter is the last one whose top has passed
         just below the masthead. The 24px of slack stops the
         highlight flickering between two chapters when a heading
         sits exactly on the line. */
      var line = chrome + 24;
      var next = 0;
      for (var i = 0; i < chapters.length; i++) {
        if (chapters[i].el.getBoundingClientRect().top <= line) next = i;
        else break;
      }

      /* At the very bottom, select the last chapter outright:
         a short final chapter can never reach the line. */
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        next = chapters.length - 1;
      }

      if (next === current) return;
      current = next;

      /* Sits below the early return deliberately: the only thing that can
         change this link's state is a change of chapter, so there is nothing
         to recompute on the scroll frames in between. */
      if (toTop) toTop.hidden = next < TOP_AFTER;

      for (var j = 0; j < chapters.length; j++) {
        if (j === next) chapters[j].link.setAttribute("aria-current", "true");
        else chapters[j].link.removeAttribute("aria-current");
      }

      keepInView(rail, chapters[next].link);
    }

    function onScroll() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(pass);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    pass();

    reading = { refresh: onScroll };
  }

  /* Scroll the rail so the active row stays visible, using a
     rect delta rather than scrollIntoView. scrollIntoView would
     also scroll the page, and offsetTop would depend on which
     ancestor happens to be the offsetParent. A delta between two
     bounding rects is immune to both. */
  function keepInView(rail, link) {
    if (!rail) return;
    var r = rail.getBoundingClientRect();
    var l = link.getBoundingClientRect();
    var pad = 12;
    var delta = 0;
    if (l.top < r.top + pad) delta = l.top - r.top - pad;
    else if (l.bottom > r.bottom - pad) delta = l.bottom - r.bottom + pad;
    if (!delta) return;
    if (reduced || !rail.scrollTo) rail.scrollTop += delta;
    else rail.scrollTo({ top: rail.scrollTop + delta, behavior: "smooth" });
  }

  /* == 4 The gate ============================================
     The case study narrative is not in the page. It ships as an
     AES-256-GCM ciphertext and a key is derived from the
     password with PBKDF2-SHA256. A wrong password fails the GCM
     authentication tag, so there is nothing to compare against
     and nothing to read out of the source.

     One unlock covers the visit: the derived key — not the
     password — is cached in sessionStorage, which is per-tab and
     dies when the tab closes.

     Web Crypto needs a secure context. https and localhost are
     fine; file:// is not, in Chrome. That case is detected up
     front so the gate explains itself instead of failing when
     someone types a correct password. */

  var KEY_STORE = "jk.k";
  var CHECK = "ok:james-kurian";
  var subtle = window.crypto && window.crypto.subtle;
  var vault = window.__LOCKED || {};

  function b64ToBytes(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToB64(b) {
    var s = "";
    var a = new Uint8Array(b);
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s);
  }

  function deriveKey(password, saltB64, iterations) {
    return window.crypto.subtle
      .importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"])
      .then(function (base) {
        return window.crypto.subtle.deriveBits(
          { name: "PBKDF2", salt: b64ToBytes(saltB64), iterations: iterations, hash: "SHA-256" },
          base,
          256
        );
      });
  }

  function importRaw(bits) {
    return window.crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["decrypt"]);
  }

  function decrypt(key, blob) {
    return window.crypto.subtle
      .decrypt({ name: "AES-GCM", iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ct))
      .then(function (plain) {
        return new TextDecoder().decode(plain);
      });
  }

  function cachedBits() {
    try {
      var s = sessionStorage.getItem(KEY_STORE);
      return s ? b64ToBytes(s).buffer : null;
    } catch (e) {
      return null;
    }
  }

  function cacheBits(bits) {
    try {
      sessionStorage.setItem(KEY_STORE, bytesToB64(bits));
    } catch (e) {
      /* Private mode with storage denied: the unlock still works
         for this page, it just will not carry to the next one. */
    }
  }

  /* Resolves with the AES key if the password (or the cached
     key) is right, rejects otherwise. */
  function unlock(bits) {
    var check = vault.__check;
    if (!check) return Promise.reject(new Error("no-check"));
    return importRaw(bits).then(function (key) {
      return decrypt(key, check).then(function (text) {
        if (text !== CHECK) throw new Error("bad");
        return key;
      });
    });
  }

  function unlockWithPassword(password) {
    var check = vault.__check;
    if (!check) return Promise.reject(new Error("no-check"));
    return deriveKey(password, check.salt, check.iter).then(function (bits) {
      return unlock(bits).then(function (key) {
        cacheBits(bits);
        return key;
      });
    });
  }

  function unlockFromCache() {
    var bits = cachedBits();
    if (!bits) return Promise.reject(new Error("no-cache"));
    return unlock(bits);
  }

  /* -- Gate form wiring, shared by the modal and the inline
        page gate. onSuccess receives the live CryptoKey. */
  function wireGate(scope, onSuccess) {
    var form = scope.querySelector("[data-gate-form]");
    if (!form) return;
    var input = form.querySelector("[data-gate-input]");
    var err = scope.querySelector("[data-gate-error]");
    var submit = form.querySelector("[data-gate-submit]");
    var label = submit ? submit.textContent : "";

    function fail(message) {
      if (!err) return;
      /* Unhide before writing: role="alert" announces on change,
         and a change inside a hidden node is not announced. */
      err.hidden = false;
      err.textContent = message;
      if (input) {
        input.setAttribute("aria-invalid", "true");
        input.select();
      }
    }

    function clear() {
      if (err) { err.hidden = true; err.textContent = ""; }
      if (input) input.removeAttribute("aria-invalid");
    }

    if (input) input.addEventListener("input", clear);

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      clear();

      if (!subtle) {
        fail("This browser will not expose its decryption API on a file:// page. Serve the folder over http — for example, run “python3 -m http.server” inside it — and the gate will work.");
        return;
      }

      var value = input ? input.value : "";
      if (!value) { fail("Enter the password to continue."); return; }

      form.classList.add("is-busy");
      if (submit) submit.textContent = "Unlocking…";

      unlockWithPassword(value)
        .then(function (key) {
          form.classList.remove("is-busy");
          if (submit) submit.textContent = label;
          onSuccess(key);
        })
        .catch(function () {
          form.classList.remove("is-busy");
          if (submit) submit.textContent = label;
          fail("That password is not right. Check the case is exact — it is case-sensitive.");
        });
    });

    if (!subtle) {
      var note = scope.querySelector("[data-gate-insecure]");
      if (note) note.hidden = false;
    }
  }

  /* -- Modal gate on the index pages ======================== */

  var modal = document.querySelector("[data-gate-modal]");
  var pendingHref = null;
  var lastFocus = null;

  function openModal(href, title) {
    if (!modal) { window.location.href = href; return; }
    pendingHref = href;
    lastFocus = document.activeElement;
    var name = modal.querySelector("[data-gate-target]");
    if (name) name.textContent = title || "this case study";
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    var input = modal.querySelector("[data-gate-input]");
    if (input) { input.value = ""; input.focus(); }
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    pendingHref = null;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (modal) {
    wireGate(modal, function () {
      var href = pendingHref;
      closeModal();
      if (href) window.location.href = href;
    });

    modal.addEventListener("click", function (ev) {
      if (ev.target === modal) closeModal();
    });

    var dismiss = modal.querySelector("[data-gate-dismiss]");
    if (dismiss) dismiss.addEventListener("click", closeModal);

    document.addEventListener("keydown", function (ev) {
      if (modal.hidden) return;
      if (ev.key === "Escape") { closeModal(); return; }
      if (ev.key !== "Tab") return;
      /* Keep Tab inside the card while it is open. */
      var stops = modal.querySelectorAll("a[href], button:not([disabled]), input:not([disabled])");
      if (!stops.length) return;
      var first = stops[0];
      var last = stops[stops.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });
  }

  /* Intercept every locked thumbnail. If the visit is already
     unlocked, go straight through — no second password. */
  var locks = Array.prototype.slice.call(document.querySelectorAll("[data-lock-link]"));
  if (locks.length) {
    unlockFromCache()
      .then(function () {
        locks.forEach(function (a) {
          var card = a.closest("[data-locked]");
          if (card) card.setAttribute("data-locked", "false");
        });
      })
      .catch(function () {
        locks.forEach(function (a) {
          a.addEventListener("click", function (ev) {
            ev.preventDefault();
            openModal(a.getAttribute("href"), a.getAttribute("data-lock-title"));
          });
        });
      });
  }

  /* -- Inline gate on a case study page ==================== */

  var shell = document.querySelector("[data-locked-page]");
  if (shell) {
    var slug = shell.getAttribute("data-locked-page");
    var gatePage = document.querySelector("[data-gate-page]");

    function reveal(key) {
      var blob = vault[slug];
      if (!blob) return Promise.reject(new Error("missing-payload"));
      return decrypt(key, blob).then(function (json) {
        var payload = JSON.parse(json);
        var article = document.querySelector("[data-article]");
        var rail = document.querySelector("[data-rail]");
        if (rail && payload.rail) rail.innerHTML = payload.rail;
        if (article && payload.article) article.innerHTML = payload.article;
        if (gatePage) gatePage.hidden = true;
        shell.hidden = false;
        /* The bar and the spy both measure the article, so they
           can only be started once it actually exists. */
        initReading();
        var jump = window.location.hash;
        if (jump && jump.length > 1) {
          var target = document.getElementById(jump.slice(1));
          if (target) target.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
        }
        return true;
      });
    }

    if (gatePage) {
      wireGate(gatePage, function (key) {
        reveal(key).catch(function () {
          var err = gatePage.querySelector("[data-gate-error]");
          if (err) {
            err.textContent = "The password was right but the encrypted file for this case study is missing.";
            err.hidden = false;
          }
        });
      });
    }

    if (subtle) {
      unlockFromCache()
        .then(reveal)
        .catch(function () {
          if (gatePage) {
            gatePage.hidden = false;
            var input = gatePage.querySelector("[data-gate-input]");
            if (input) input.focus({ preventScroll: true });
          }
        });
    } else if (gatePage) {
      gatePage.hidden = false;
      var insecure = gatePage.querySelector("[data-gate-insecure]");
      if (insecure) insecure.hidden = false;
    }
  } else {
    initReading();
  }

  /* == 5 Footer year ========================================= */
  var year = document.querySelector("[data-year]");
  if (year) year.textContent = new Date().getFullYear();

  /* == 6 Copy the address ====================================
     The button ships hidden and is only revealed here, once the
     clipboard API has actually been found. A copy button that
     silently does nothing is worse than no copy button, and
     navigator.clipboard is absent on plain http — which is a
     configuration this site can genuinely end up in. */

  var copyBtn = document.querySelector("[data-copy]");
  if (copyBtn && navigator.clipboard && window.isSecureContext) {
    var label = copyBtn.querySelector("[data-copy-label]");
    var resting = label ? label.textContent : "";
    var settle;

    copyBtn.hidden = false;

    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(copyBtn.getAttribute("data-copy")).then(
        function () {
          copyBtn.setAttribute("data-copied", "");
          /* The word changes, not only the colour: a state reported by
             hue alone is not reported at all (1.4.1). The label is in an
             aria-live region so it is announced once rather than needing
             focus to move. */
          if (label) label.textContent = "Copied";
          clearTimeout(settle);
          settle = setTimeout(function () {
            copyBtn.removeAttribute("data-copied");
            if (label) label.textContent = resting;
          }, 2200);
        },
        function () {
          /* Permission refused. Say so rather than showing a tick for a
             copy that did not happen. */
          if (label) label.textContent = "Press ⌘C instead";
          clearTimeout(settle);
          settle = setTimeout(function () {
            if (label) label.textContent = resting;
          }, 3200);
        }
      );
    });
  }

  /* == 7 Reveal on scroll ====================================
     Arms only what is already below the fold. Anything visible at
     load is left alone, so the page never hides content it is
     about to show anyway, and the first screen cannot flicker.

     Nothing is armed at all without IntersectionObserver or with
     reduced motion requested — in both cases the elements keep
     their resting (visible) state and this is a no-op. */

  var toReveal = [].slice.call(document.querySelectorAll("[data-reveal]"));
  if (toReveal.length && !reduced && "IntersectionObserver" in window) {
    var armed = toReveal.filter(function (el) {
      return el.getBoundingClientRect().top > window.innerHeight * 0.9;
    });

    armed.forEach(function (el) { el.setAttribute("data-reveal", "pending"); });

    if (armed.length) {
      var revealer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.setAttribute("data-reveal", "in");
          revealer.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -12% 0px", threshold: 0.01 });

      armed.forEach(function (el) { revealer.observe(el); });

      /* A backstop. If anything is still pending after five seconds —
         an observer that never fired because an ancestor was display:
         none at arm time, a browser quirk, anything — it gets shown.
         Content permanently invisible because of a decoration is the
         one outcome this feature is not allowed to have. */
      setTimeout(function () {
        armed.forEach(function (el) {
          if (el.getAttribute("data-reveal") === "pending") {
            revealer.unobserve(el);
            el.setAttribute("data-reveal", "in");
          }
        });
      }, 5000);
    }
  }

  /* == 8 Pointer glow ========================================
     Two soft pools of violet behind the home hero: one under the
     cursor, one lagging behind it. The lag is the whole point —
     a gradient pinned exactly to the pointer reads as a torch
     stuck to the mouse, which is the distracting version.

     Four gates before a single frame is drawn: the section and
     layer exist, motion is allowed, the pointer is fine and
     hovers (so no phone runs this), and the hero is on screen. */

  var field = document.querySelector("[data-pointer-field]");
  var glow = field && field.querySelector("[data-glow]");
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  if (field && glow && !reduced && fine) {
    /* Viewport pixels, not percentages. The first version of this
       wrote percentages, and they were percentages of the wrong
       box: measured against the hero section, applied to a glow
       layer inset beyond it on all four sides. So the light landed
       near the cursor at the centre and drifted further away the
       further out you moved — which is exactly what it looked
       like. The layer is position: fixed now, filling the viewport,
       and clientX/clientY are already in that coordinate space, so
       there is no arithmetic left here to get wrong.

       The seed is the middle of the viewport rather than 0,0, so
       the first pointermove eases in from somewhere plausible
       instead of sliding in from the top-left corner. */
    var want = { x: window.innerWidth / 2, y: window.innerHeight * 0.38 };
    var at = { x: want.x, y: want.y };
    var trail = { x: want.x, y: want.y };
    var ticking = false;
    var onScreen = true;

    function frame() {
      /* Two different rates: the near pool catches up quickly, the
         far one dawdles. Both are frame-rate dependent, which is
         acceptable for a decoration — the visible difference
         between 60Hz and 120Hz here is that it settles slightly
         faster, not that it goes anywhere else. */
      at.x += (want.x - at.x) * 0.10;
      at.y += (want.y - at.y) * 0.10;
      trail.x += (at.x - trail.x) * 0.045;
      trail.y += (at.y - trail.y) * 0.045;

      glow.style.setProperty("--mx", at.x.toFixed(1) + "px");
      glow.style.setProperty("--my", at.y.toFixed(1) + "px");
      glow.style.setProperty("--mx2", trail.x.toFixed(1) + "px");
      glow.style.setProperty("--my2", trail.y.toFixed(1) + "px");

      /* Stop when it has arrived. Holding a rAF loop open to
         re-round the same two numbers keeps a core awake and a
         laptop fan on for nothing.

         The threshold is in pixels now. It used to be 0.12 of a
         percent, which on a 1400px-wide window was about 1.7px —
         so 1.5px is the same decision expressed in the units the
         loop actually works in, rather than a number that silently
         got stricter on a smaller screen. Below that the far pool
         is moving less than the blur radius hides. */
      var moving = Math.abs(want.x - at.x) + Math.abs(want.y - at.y) +
                   Math.abs(at.x - trail.x) + Math.abs(at.y - trail.y);
      if (moving > 1.5 && onScreen) {
        requestAnimationFrame(frame);
      } else {
        ticking = false;
      }
    }

    function tick() {
      if (ticking || !onScreen) return;
      ticking = true;
      requestAnimationFrame(frame);
    }

    field.addEventListener("pointermove", function (e) {
      if (e.pointerType !== "mouse") return;
      want.x = e.clientX;
      want.y = e.clientY;
      glow.setAttribute("data-lit", "");
      tick();
    });

    field.addEventListener("pointerleave", function () {
      /* Fades out rather than snapping, and the pools keep drifting
         towards where they were headed underneath the fade, so
         coming back in does not restart from a stale position. */
      glow.removeAttribute("data-lit");
    });

    /* Scrolled past: stop the loop. There is nothing to look at. */
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        if (!onScreen) glow.removeAttribute("data-lit");
        else tick();
      }).observe(field);
    }
  }

  /* == 9 Case study filter ===================================
     Two categories, and a card can be in both. Orbital is: the
     system was a craft problem and getting 350 people onto it was
     a stakeholder one.

     It sorts rather than hides. Pressing a pill lifts the matching
     case studies to the front of the grid and pushes the rest down
     behind them, dimmed but whole. With three case studies there
     is nothing to gain by emptying two thirds of the page, and a
     good deal to lose: the work that did not match is still work
     worth seeing, and someone who pressed the wrong pill should
     not have to press another one to get the page back.

     The reorder is done by moving the elements, not by CSS order.
     Visual order and DOM order stay the same thing, so Tab and a
     screen reader walk the grid in the sequence the eye does —
     which is what 2.4.3 and 1.3.2 ask for and what CSS order
     quietly breaks.

     The control ships hidden in the markup and is revealed here,
     the same bargain the copy button makes. Sorting is the
     scripted half of this feature, so if the script never runs
     the page is simply the index in its authored order — no dead
     tabs, and nothing waiting on JavaScript that did not
     arrive. */

  var filter = document.querySelector("[data-filter]");
  var grid = document.querySelector("[data-cases]");
  /* Captured once, so this stays the authored order however many
     times the cards are shuffled afterwards. Both groups are
     emitted in it, which is what makes Everything able to put the
     grid back exactly as it was written. */
  var cards = [].slice.call(document.querySelectorAll("[data-cats]"));
  var pills = filter ? [].slice.call(filter.querySelectorAll("[data-filter-btn]")) : [];
  var count = filter && filter.querySelector("[data-filter-count]");

  /* All three have to be present. A pill bar with no cards to act on, or
     cards with no bar, is a control that lies about what it does — better
     to leave the page as the plain index it already is. (That every card
     carries at least one category, and that every category has a pill, is
     checked statically by check.py section 16 rather than at runtime,
     where nobody would see it.) */
  if (filter && grid && cards.length && pills.length) {
    filter.hidden = false;

    var words = { craft: "systems and craft", business: "business and stakeholders" };

    function apply(cat) {
      var lead = [];
      var rest = [];

      cards.forEach(function (card) {
        var cats = (card.getAttribute("data-cats") || "").split(/\s+/);
        var match = cat === "all" || cats.indexOf(cat) > -1;
        (match ? lead : rest).push(card);
        /* A state attribute, not a class, and set on the article rather
           than on anything holding text. The dimming it drives steps down
           the ink scale — no opacity over a word anywhere, because a
           translucent layer is the one thing the contrast audit cannot
           resolve, and text that has quietly gone to 3:1 looks exactly
           like text that was meant to. */
        if (match) card.removeAttribute("data-aside");
        else card.setAttribute("data-aside", "");
      });

      /* Minimal moves: walk the wanted order alongside the live one and
         only touch a card that is out of place. Reordering detaches and
         reinserts a node, which in some browsers drops focus, so the
         cheapest reconcile is also the safest one — and pressing the
         pill you are already on becomes a genuine no-op rather than
         three silent DOM operations. */
      var want = lead.concat(rest);
      var at = grid.firstElementChild;
      want.forEach(function (card) {
        if (card === at) at = at.nextElementSibling;
        else grid.insertBefore(card, at);
      });

      pills.forEach(function (p) {
        p.setAttribute("aria-pressed", p.getAttribute("data-cat") === cat ? "true" : "false");
      });

      /* Said in words, because the change is an order and a tint — and
         neither of those is available to someone who cannot see the
         grid, or who cannot tell the two greys apart. 1.4.1: the state
         is carried by position, by this sentence, and by the pressed
         pill, with colour as the fourth channel rather than the only
         one. */
      if (count) {
        count.textContent = cat === "all"
          ? (lead.length === 1 ? "One case study."
                               : lead.length + " case studies, in their own order.")
          : lead.length + (lead.length === 1 ? " case study" : " case studies") +
            " in " + (words[cat] || cat) + ", first." +
            (rest.length === 0 ? " That is all of them."
             : rest.length === 1 ? " The other one is below."
             : " The other " + rest.length + " are below.");
      }
    }

    pills.forEach(function (p) {
      p.addEventListener("click", function () {
        apply(p.getAttribute("data-cat") || "all");
      });
    });

    /* Sets the count line from the real number rather than trusting the
       sentence sitting in the HTML, which is there so the region is not
       empty before the first press. */
    apply("all");
  }
})();
