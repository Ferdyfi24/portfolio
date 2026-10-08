/* Shared behaviour for every page. Plain ES2015, no libraries.
   - the MOTION switch: html.still stops every canvas and CSS animation, remembered in localStorage, off under
     prefers-reduced-motion, and everything pauses while the tab is hidden
   - the SOUND switch: drives sound.js (default off, remembered, created only on the visitor's own click)
   - where each sound plays: scanner beep on project cards and primary buttons, forklift beeper on a rack filter,
     switch clack on either switch, the rubber stamp carried across internal links, the conveyor hum while the hero
     conveyor is on screen
   - page transitions: cross-document view transitions where the browser has them (site.css), otherwise a short leave
     animation on internal links; state is restored on pageshow when a page comes back from the bfcache
   - helpers shared with project.html through window.Site: escaping, **bold** markup, Code 128 barcodes, count-up,
     projects.json
   - on index.html: the project rack rendered from projects.json, with filter chips computed from the data
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
    var on = !!(snd() && snd().isOn());
    if (!sbtn) return;
    sbtn.setAttribute("aria-pressed", on ? "true" : "false");
    sbtn.querySelector(".txt").textContent = on ? "SOUND ON" : "SOUND OFF";
    sbtn.setAttribute("aria-label", on ? "Sound: UI sounds are on. Press to mute them." : "Sound: UI sounds are off. Press to turn them on.");
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

  /* ---------- conveyor hum: only while the hero conveyor is on screen, motion is on, sound is on, tab visible ---------- */
  var heroCv = document.querySelector(".hero canvas[data-scene='hero']"), heroOn = false;
  function updateHum() { if (snd()) snd().hum(heroOn && !Site.isStill()); }
  if (heroCv && "IntersectionObserver" in window) {
    new IntersectionObserver(function (es) { es.forEach(function (e) { heroOn = e.isIntersecting; }); updateHum(); }, { threshold: .05 }).observe(heroCv);
  }
  window.addEventListener("motionchange", updateHum);
  window.addEventListener("soundchange", updateHum);

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
  Site.fmt = function (n, comma) { var s = String(Math.round(n)); return comma ? Number(s).toLocaleString("en-US") : s; };

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
    var to = parseFloat(el.getAttribute("data-to")), from = parseFloat(el.getAttribute("data-from") || "0"), comma = el.getAttribute("data-fmt") === "1", t0 = null;
    if (reduce || still || isNaN(to)) { el.textContent = Site.fmt(to, comma); return; }
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / 1500), k = 1 - Math.pow(1 - p, 4);
      el.textContent = Site.fmt(from + (to - from) * k, comma);
      if (p < 1) requestAnimationFrame(step);
    }
    el.textContent = Site.fmt(from, comma);
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

  /* ---------- index: the rack ---------- */
  var rack = document.getElementById("rack"), filters = document.getElementById("filters");
  if (rack && filters) {
    Site.projects().then(function (data) {
      var projects = data.projects || [], keys = [], counts = {};
      projects.forEach(function (p) { var k = p.rack || "other"; if (!counts[k]) { counts[k] = 0; keys.push(k); } counts[k]++; });
      /* chip order: the racks object first, then any rack only found on a project */
      var order = Object.keys(data.racks || {}).filter(function (k) { return counts[k]; }).concat(keys.filter(function (k) { return !(data.racks && data.racks[k]); }));
      var chips = '<button class="chip" type="button" data-f="all" aria-pressed="true">All<span>' + projects.length + '</span></button>';
      order.forEach(function (k) { chips += '<button class="chip" type="button" data-f="' + Site.esc(k) + '" aria-pressed="false">' + Site.esc(Site.rackName(data, k)) + '<span>' + counts[k] + '</span></button>'; });
      filters.innerHTML = chips;
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
      /* filter: cards leave, survivors re-enter with a stagger; the forklift beeper marks the change */
      var chipEls = [].slice.call(filters.querySelectorAll(".chip")), slots = [].slice.call(rack.querySelectorAll(".slot")), ft = null;
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
            rack.classList.toggle("filtered", f !== "all");
            if (window.Viz) window.Viz.scan();
          }
          if (reduce || still) { apply(); return; }
          slots.forEach(function (s) { if (!s.hidden) s.classList.add("out"); });
          clearTimeout(ft); ft = setTimeout(apply, 180);
        });
      });
    }).catch(function () {
      rack.innerHTML = '<div class="rack-empty">The rack could not be loaded. The code lives at <a href="https://github.com/Ferdyfi24">github.com/Ferdyfi24</a>.</div>';
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
