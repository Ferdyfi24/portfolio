/* Shared behaviour for every page. Plain ES2015, no libraries.
   - the MOTION switch: html.still stops every canvas and CSS animation, remembered in localStorage, off under
     prefers-reduced-motion, and everything pauses while the tab is hidden
   - the SOUND switch: drives sound.js (default off, remembered, created only on the visitor's own click). While the
     switch is on but the browser has not let audio start yet, the lamp blinks and the label says to click anywhere.
   - where each sound plays: scanner beep on project cards and primary buttons, forklift beeper on a rack or tag filter,
     switch clack on either switch, the rubber stamp carried across internal links, the conveyor bed while the hero
     or the footer belt is on screen, a soft scanner beep on hovering a card or tag, a door reader on the access pass, a trolley roll while scrolling and a location scan as each section heading arrives and a tick on buttons, chips and nav
     links (mouse only). The canvas scenes ask for their own cues (viz.js).
   - page transitions: cross-document view transitions where the browser has them (site.css), otherwise a short leave
     animation on internal links; state is restored on pageshow when a page comes back from the bfcache
   - helpers shared with project.html through window.Site: escaping, **bold** markup, Code 128 barcodes, count-up,
     projects.json, certificates.json and the QC tag markup for one certificate (Site.certTag)
   - on index.html: the project rack rendered from projects.json and the certificate tag board rendered from
     certificates.json, each with filter chips computed from the data
   - scroll reveal, nav state, phone menu
   The pages read fine without any of this; only the JSON-rendered parts need JS and they have noscript fallbacks. */
(function () {
  var doc = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var Site = window.Site = {};
  function snd() { return window.Sound || null; }

  /* ---------- MOTION switch ---------- */
  var mbtn = document.getElementById("motion"), still = false;
  function readPref() { try { var v = localStorage.getItem("motion"); if (v === "on") return false; if (v === "off") return true; } catch (e) { } return reduce; }
  function savePref(s) { try { localStorage.setItem("motion", s ? "off" : "on"); } catch (e) { } }
  function applyStill(s, persist) {
    still = s; doc.classList.toggle("still", s);
    if (mbtn) {
      mbtn.setAttribute("aria-pressed", s ? "false" : "true");
      mbtn.querySelector(".txt").textContent = s ? "MOTION OFF" : "MOTION ON";
      mbtn.setAttribute("aria-label", s ? "Motion: animations are off. Press to start them." : "Motion: animations are on. Press to stop them.");
    }
    [].slice.call(document.querySelectorAll("video[autoplay]")).forEach(function (v) { if (s) v.pause(); else { var p = v.play(); if (p && p.catch) p.catch(function () { }); } });
    if (persist) savePref(s);
    window.dispatchEvent(new Event("motionchange"));
  }
  Site.isStill = function () { return still || document.hidden; };
  applyStill(readPref(), false);
  if (mbtn) mbtn.addEventListener("click", function () { if (snd()) snd().clack(); applyStill(!still, true); });
  document.addEventListener("visibilitychange", function () { window.dispatchEvent(new Event("motionchange")); });

  /* ---------- SOUND switch ---------- */
  var sbtn = document.getElementById("sound");
  function paintSound() {
    var S = snd(), on = !!(S && S.isOn()), locked = !!(on && S.isLocked && S.isLocked());
    if (!sbtn) return;
    sbtn.setAttribute("aria-pressed", on ? "true" : "false");
    sbtn.classList.toggle("wait", locked);
    sbtn.querySelector(".txt").textContent = on ? "SOUND ON" : "SOUND OFF";
    var label = locked ? "Sound is on but the browser is waiting for a click: click, tap or press a key anywhere on the page to start it. Press this switch to mute."
      : on ? "Sound: ambient and UI sounds are on. Press to mute them." : "Sound: sounds are off. Press to turn them on.";
    sbtn.setAttribute("aria-label", label);
    if (locked) sbtn.setAttribute("title", "Click anywhere to start sound"); else sbtn.removeAttribute("title");
  }
  if (sbtn) {
    if (!snd()) sbtn.hidden = true;
    else sbtn.addEventListener("click", function () {
      var S = snd(), on = S.isOn();
      if (on) { S.clack(); S.set(false, true); } else S.set(true, true);
      paintSound();
    });
  }
  paintSound();
  window.addEventListener("soundchange", paintSound);

  /* ---------- ambient beds: the hero conveyor and the footer belt, each only while on screen, motion on, sound on, tab visible ---------- */
  var heroCv = document.querySelector(".hero canvas[data-scene='hero']"), beltCv = document.querySelector("canvas[data-scene='belt']"), heroOn = false, beltOn = false;
  function updateHum() {
    var S = snd(); if (!S) return;
    var ok = !Site.isStill();
    S.ambient("hero", heroOn && ok); S.ambient("belt", beltOn && ok);
    if (!ok && S.stopCues) S.stopCues();
  }
  if ("IntersectionObserver" in window) {
    if (heroCv) new IntersectionObserver(function (es) { es.forEach(function (e) { heroOn = e.isIntersecting; }); updateHum(); }, { threshold: .05 }).observe(heroCv);
    if (beltCv) new IntersectionObserver(function (es) { es.forEach(function (e) { beltOn = e.isIntersecting; }); updateHum(); }, { threshold: .05 }).observe(beltCv);
  }
  window.addEventListener("motionchange", updateHum);
  window.addEventListener("soundchange", updateHum);

  /* ---------- hover sounds, mouse only: a soft scanner beep entering a card or tag, a tick entering a button, chip or nav link ---------- */
  var lastScroll = -9;
  window.addEventListener("scroll", function () { lastScroll = performance.now(); }, { passive: true });
  document.addEventListener("pointerover", function (e) {
    var S = snd(), t = e.target;
    if (!S || e.pointerType !== "mouse" || !t || !t.closest) return;
    if (performance.now() - lastScroll < 250) return; /* the page moved under a resting pointer, that is not a hover */
    var key = t.closest(".btn, .qcbtn, footer a"), small = t.closest("button, .chip, nav.top ul a, .back, .allposts, .more, .pn a"), big = t.closest(".slot, .qctag, .feat, .post"), pass = t.closest(".idpass");
    var rel = e.relatedTarget;
    if (key && !(rel && key.contains(rel))) S.cue("button");
    else if (key) return;
    else if (small && !(rel && small.contains(rel))) S.cue("tick");
    else if (big && !(rel && big.contains(rel))) S.cue("scan");
    else if (pass && !(rel && pass.contains(rel))) S.cue("badge");
  }, { passive: true });

  /* ---------- scroll sounds: the trolley rolls while the page moves, and each section label is scanned once ---------- */
  (function () {
    var lastY = window.scrollY, lastT = performance.now(), v = 0, idle = null;
    window.addEventListener("scroll", function () {
      var S = snd(); if (!S || !S.roll) return;
      var now = performance.now(), dt = Math.max(8, now - lastT), dy = Math.abs(window.scrollY - lastY);
      lastY = window.scrollY; lastT = now;
      v = v * .6 + (dy / dt * 1000) * .4;                 /* px per second, smoothed */
      S.roll(Math.min(1, v / 2600));
      clearTimeout(idle); idle = setTimeout(function () { v = 0; S.roll(0); }, 140);
    }, { passive: true });
    if (!("IntersectionObserver" in window)) return;
    var seen = [];
    var zio = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting || seen.indexOf(e.target) >= 0) return;
        var S = snd();
        if (S && S.cue && S.cue("zone")) seen.push(e.target); /* only counts as scanned once it was heard */
      });
    }, { threshold: .6 });
    [].forEach.call(document.querySelectorAll(".shead, .end h2"), function (el) { zio.observe(el); });
  })();

  /* ---------- page transitions ---------- */
  /* cross-document view transitions are CSS only (site.css); the fallback below is for browsers without them */
  var hasVT = ("PageSwapEvent" in window) || ("PageRevealEvent" in window);
  if (!hasVT && !reduce) doc.classList.add("fb");
  function isInternal(a) {
    if (!a || a.origin !== location.origin) return false;
    var href = a.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#" || /^(mailto|tel|javascript):/i.test(href)) return false;
    if (a.target && a.target !== "_self") return false;
    if (a.hasAttribute("download")) return false;
    if (a.pathname === location.pathname && a.search === location.search && a.hash) return false; /* an anchor on this page */
    return true;
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    var S = snd();
    if (S && (a.closest(".slot") || a.classList.contains("primary") || a.classList.contains("feat"))) S.beep();
    else if (S && a.closest(".btn, .qcbtn, footer, .allposts, .post")) S.press();
    /* a link that leaves the site (LinkedIn, GitHub, Medium, a verify page) waits a moment so the press is heard */
    if (S && S.isOn() && !S.isLocked() && a.origin !== location.origin && !e.defaultPrevented && e.button === 0 &&
        !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) && (!a.target || a.target === "_self") && /^https?:/i.test(a.href)) {
      e.preventDefault();
      var out = a.href;
      setTimeout(function () { location.href = out; }, 160);
      return;
    }
    if (!isInternal(a)) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (S) S.carryStamp();
    if (!hasVT && !reduce && !still) {
      e.preventDefault();
      doc.classList.add("leaving");
      var href = a.href;
      setTimeout(function () { location.href = href; }, 230);
    }
  });
  window.addEventListener("pageshow", function (e) {
    doc.classList.remove("leaving");
    if (e.persisted) { applyStill(readPref(), false); paintSound(); updateHum(); }
  });

  /* ---------- text helpers ---------- */
  Site.esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  /* the only markup allowed in JSON text: **bold** */
  Site.inline = function (s) { return Site.esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>"); };
  /* dec: decimals to keep. Count-ups take it from the target as written (data-to="87.6" keeps one decimal). */
  Site.fmt = function (n, comma, dec) {
    dec = dec || 0; var f = Math.pow(10, dec), v = Math.round(n * f) / f;
    return comma ? v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec);
  };
  Site.decimals = function (s) { var m = /\.(\d+)/.exec(String(s)); return m ? m[1].length : 0; };

  /* ---------- Code 128 B barcode, deterministic from the code string, as inline SVG ---------- */
  var C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112").split(" ");
  Site.barcode = function (text, h) {
    var s = String(text || "").replace(/[^\x20-\x7e]/g, "").slice(0, 24) || "0", vals = [104], sum = 104;
    for (var i = 0; i < s.length; i++) { var v = s.charCodeAt(i) - 32; vals.push(v); sum += v * (i + 1); }
    vals.push(sum % 103); vals.push(106);
    var x = 10, rects = "", quiet = 10;
    for (i = 0; i < vals.length; i++) {
      var p = C128[vals[i]];
      for (var j = 0; j < p.length; j++) { var w = +p.charAt(j); if (j % 2 === 0) rects += '<rect x="' + x + '" width="' + w + '" height="' + (h || 40) + '"/>'; x += w; }
    }
    x += quiet;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + x + ' ' + (h || 40) + '" width="' + x + '" height="' + (h || 40) + '" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true" focusable="false">' + rects + '</svg>';
  };

  /* static barcodes in the page, for example the access pass in About */
  [].forEach.call(document.querySelectorAll("[data-barcode]"), function (el) { el.innerHTML = Site.barcode(el.getAttribute("data-barcode"), 40); });

  /* ---------- count up ---------- */
  var cio = ("IntersectionObserver" in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (!e.isIntersecting) return; cio.unobserve(e.target); run(e.target); });
  }, { threshold: .5 }) : null;
  function run(el) {
    var to = parseFloat(el.getAttribute("data-to")), from = parseFloat(el.getAttribute("data-from") || "0"), comma = el.getAttribute("data-fmt") === "1", dec = Site.decimals(el.getAttribute("data-to")), t0 = null;
    if (reduce || still || isNaN(to)) { el.textContent = Site.fmt(to, comma, dec); return; }
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / 1500), k = 1 - Math.pow(1 - p, 4);
      el.textContent = Site.fmt(from + (to - from) * k, comma, dec);
      if (p < 1) requestAnimationFrame(step);
    }
    el.textContent = Site.fmt(from, comma, dec);
    requestAnimationFrame(step);
  }
  Site.countUp = function (root) {
    [].slice.call((root || document).querySelectorAll("[data-to]")).forEach(function (el) { if (cio) cio.observe(el); else run(el); });
  };
  Site.countUp(document);

  /* ---------- reveal ---------- */
  var rio = ("IntersectionObserver" in window && !reduce) ? new IntersectionObserver(function (es) {
    var batch = es.filter(function (e) { return e.isIntersecting; })
      .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left; });
    batch.forEach(function (e, j) { e.target.style.setProperty("--d", Math.min(j, 6) * 70 + "ms"); e.target.classList.add("in"); rio.unobserve(e.target); });
  }, { rootMargin: "0px 0px -6% 0px" }) : null;
  Site.reveal = function (root) {
    [].slice.call((root || document).querySelectorAll(".rv:not(.in)")).forEach(function (el) { if (rio) rio.observe(el); else el.classList.add("in"); });
  };
  Site.reveal(document);

  /* ---------- projects.json, fetched once ---------- */
  var pj = null;
  Site.projects = function () {
    if (!pj) pj = fetch("projects.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("projects.json " + r.status); return r.json(); });
    return pj;
  };
  Site.rackName = function (data, key) { return (data.racks && data.racks[key]) ? data.racks[key] : key; };

  /* ---------- certificates.json, fetched once, and the QC tag for one certificate ---------- */
  var cj = null;
  Site.certificates = function () {
    if (!cj) cj = fetch("certificates.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("certificates.json " + r.status); return r.json(); });
    return cj;
  };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /* "2026-09-14" -> "14 Sep 2026", "2026-09" -> "Sep 2026", "2026" -> "2026", anything else -> as given, null -> "" */
  Site.certDate = function (d) {
    if (!d) return "";
    var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(d));
    if (!m) return String(d);
    var mon = m[2] ? MON[parseInt(m[2], 10) - 1] : "";
    return (m[3] ? parseInt(m[3], 10) + " " : "") + (mon ? mon + " " : "") + m[1];
  };
  /* the QC inspection hang tag: string, punched hole, code with barcode, title, issuer, date and score, a QC PASSED
     stamp and the actions. Everything is escaped. Wrap the output in <div class="qcboard"> (a grid) or
     <div class="qcboard one"> for a single tag. data is the parsed certificates.json, for the rack names.
     opts.hideProject leaves out the "See the project" link, for a tag shown on that project's own page. */
  Site.certTag = function (cert, data, opts) {
    var c = cert || {}, esc = Site.esc, rackName = Site.rackName(data || {}, c.rack || "other"), date = Site.certDate(c.date), acts = "";
    if (c.url) acts += '<a class="qcbtn" href="' + esc(c.url) + '" rel="noopener">Verify <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg></a>';
    if (c.project && !(opts && opts.hideProject)) acts += '<a class="qcbtn" href="project.html?p=' + encodeURIComponent(c.project) + '">See the project</a>';
    return '<div class="qc" data-k="' + esc(c.rack || "other") + '"><span class="qcstr" aria-hidden="true"></span>' +
      '<article class="qctag" aria-label="Certificate ' + esc(c.code) + '">' +
      '<div class="qchole" aria-hidden="true"><i></i></div>' +
      '<div class="qchead"><span class="qccode">' + esc(c.code) + '</span><span class="qcrack">' + esc(rackName) + '</span></div>' +
      '<div class="qcbc">' + Site.barcode(c.code, 28) + '</div>' +
      '<h3 class="qct">' + esc(c.title) + '</h3>' +
      '<div class="qciss">' + esc(c.issuer) + '</div>' +
      '<div class="qcfoot"><dl class="qcrows">' +
      (date ? '<div><dt>Date</dt><dd>' + esc(date) + '</dd></div>' : "") +
      (c.score ? '<div><dt>Score</dt><dd>' + esc(c.score) + '</dd></div>' : "") +
      '<div><dt>Insp.</dt><dd>FI</dd></div></dl>' +
      '<span class="qcstamp" aria-hidden="true">QC<br>passed</span></div>' +
      (acts ? '<div class="qcact">' + acts + '</div>' : "") +
      '</article></div>';
  };

  /* ---------- filter chips shared by the rack and the tag board: cards leave, survivors re-enter with a stagger ---------- */
  function chipsHtml(data, list, keyOf) {
    var keys = [], counts = {};
    list.forEach(function (p) { var k = keyOf(p) || "other"; if (!counts[k]) { counts[k] = 0; keys.push(k); } counts[k]++; });
    /* chip order: the racks object first, then any rack only found on an item */
    var order = Object.keys(data.racks || {}).filter(function (k) { return counts[k]; }).concat(keys.filter(function (k) { return !(data.racks && data.racks[k]); }));
    var chips = '<button class="chip" type="button" data-f="all" aria-pressed="true">All<span>' + list.length + '</span></button>';
    order.forEach(function (k) { chips += '<button class="chip" type="button" data-f="' + Site.esc(k) + '" aria-pressed="false">' + Site.esc(Site.rackName(data, k)) + '<span>' + counts[k] + '</span></button>'; });
    return chips;
  }
  function bindFilters(filters, board, itemSel) {
    var chipEls = [].slice.call(filters.querySelectorAll(".chip")), slots = [].slice.call(board.querySelectorAll(itemSel)), ft = null;
    chipEls.forEach(function (ch) {
      ch.addEventListener("click", function () {
        var f = ch.getAttribute("data-f");
        if (ch.getAttribute("aria-pressed") === "true") return;
        chipEls.forEach(function (c) { c.setAttribute("aria-pressed", c === ch ? "true" : "false"); });
        if (snd()) snd().beeper();
        function apply() {
          var j = 0;
          slots.forEach(function (s) {
            var show = f === "all" || s.getAttribute("data-k") === f;
            s.hidden = !show; s.classList.remove("out");
            if (show) { s.classList.remove("in"); void s.offsetWidth; s.style.setProperty("--d", Math.min(j++, 6) * 55 + "ms"); s.classList.add("in"); }
          });
          board.classList.toggle("filtered", f !== "all");
          if (window.Viz) window.Viz.scan();
        }
        if (reduce || still) { apply(); return; }
        slots.forEach(function (s) { if (!s.hidden) s.classList.add("out"); });
        clearTimeout(ft); ft = setTimeout(apply, 180);
      });
    });
  }

  /* ---------- index: the rack ---------- */
  var rack = document.getElementById("rack"), filters = document.getElementById("filters");
  if (rack && filters) {
    Site.projects().then(function (data) {
      var projects = data.projects || [];
      filters.innerHTML = chipsHtml(data, projects, function (p) { return p.rack; });
      var html = "";
      projects.forEach(function (p, i) {
        var tags = (p.tags || []).slice(0, 3).map(function (t) { return "<span>" + Site.esc(t) + "</span>"; }).join("");
        var pts = (p.cardPoints || []).map(function (t) { return "<li>" + Site.inline(t) + "</li>"; }).join("");
        html += '<article class="slot rv" data-k="' + Site.esc(p.rack || "other") + '">' +
          '<div class="lab"><div><span class="code">' + Site.esc(p.code) + '</span><span class="kind">' + Site.esc(p.kind || "") + '</span></div>' +
          '<div class="bc">' + Site.barcode(p.code, 40) + '<small>' + Site.esc(p.code) + '</small></div></div>' +
          '<canvas class="viz" data-viz="' + Site.esc(p.visual || "") + '"' + (p.image ? ' data-image="' + Site.esc(p.image) + '"' : "") + ' aria-hidden="true"></canvas>' +
          '<div class="in"><div class="rk"><i></i>' + Site.esc(Site.rackName(data, p.rack)) + (p.year ? " · " + Site.esc(p.year) : "") + '<em>' + ("0" + (i + 1)).slice(-2) + " / " + ("0" + projects.length).slice(-2) + '</em></div>' +
          '<h3><a href="project.html?p=' + encodeURIComponent(p.slug) + '">' + Site.esc(p.short || p.title) + '</a></h3>' +
          '<p>' + Site.esc(p.summary || "") + '</p>' + (pts ? "<ul>" + pts + "</ul>" : "") +
          '<div class="foot"><div class="tags">' + tags + '</div><span class="go">Open →</span></div></div></article>';
      });
      rack.innerHTML = html;
      Site.reveal(rack);
      if (window.Viz) window.Viz.scan();
      bindFilters(filters, rack, ".slot");
    }).catch(function () {
      rack.innerHTML = '<div class="rack-empty">The rack could not be loaded. The code lives at <a href="https://github.com/Ferdyfi24">github.com/Ferdyfi24</a>.</div>';
    });
  }

  /* ---------- index: the certificate tag board, and the count in About ---------- */
  var board = document.getElementById("certboard"), cfilters = document.getElementById("cfilters"), ccount = document.getElementById("certcount");
  if (board && cfilters) {
    Site.certificates().then(function (data) {
      var list = data.certificates || [];
      cfilters.innerHTML = chipsHtml(data, list, function (c) { return c.rack; });
      board.innerHTML = list.map(function (c) { return Site.certTag(c, data); }).join("");
      [].forEach.call(board.querySelectorAll(".qc"), function (el) { el.classList.add("rv"); });
      Site.reveal(board);
      bindFilters(cfilters, board, ".qc");
      if (ccount) {
        var n = {}; list.forEach(function (c) { var k = c.rack || "other"; n[k] = (n[k] || 0) + 1; });
        var parts = Object.keys(n).map(function (k) { return n[k] + " " + Site.rackName(data, k).toLowerCase(); });
        ccount.textContent = list.length + " on the tag board" + (parts.length ? " (" + parts.join(", ") + ")" : "") + " · ";
      }
    }).catch(function () {
      board.innerHTML = '<div class="rack-empty">The tag board could not be loaded. The certificates are listed on <a href="https://www.linkedin.com/in/ferdyfebrianiskandar">LinkedIn</a>.</div>';
    });
  }

  /* ---------- nav: active section and phone menu ---------- */
  var links = [].slice.call(document.querySelectorAll("nav.top ul a[href^='#']"));
  var secs = links.map(function (a) { return document.querySelector(a.getAttribute("href")); });
  var ticking = false;
  function onScroll() {
    var cur = -1;
    secs.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < 140) cur = i; });
    links.forEach(function (a, i) { a.classList.toggle("on", i === cur); });
    ticking = false;
  }
  if (links.length) { window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true }); onScroll(); }
  var menu = document.querySelector(".menu"), ul = document.querySelector("nav.top ul");
  if (menu && ul) {
    menu.addEventListener("click", function () { var open = ul.classList.toggle("open"); menu.setAttribute("aria-expanded", open ? "true" : "false"); });
    ul.addEventListener("click", function (e) { if (e.target.tagName === "A") { ul.classList.remove("open"); menu.setAttribute("aria-expanded", "false"); } });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ul.classList.contains("open")) { ul.classList.remove("open"); menu.setAttribute("aria-expanded", "false"); menu.focus(); } });
  }
})();
