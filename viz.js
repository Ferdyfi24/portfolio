/* Every canvas on the site, drawn from one requestAnimationFrame loop.
   Two kinds of canvas:
   - canvas[data-viz="name"]: the small animated sketch on a project card and at the top of a project page.
     Named sketches: ledger, po, repl, basket, anom, lpg, fc, rfm, dash, fin.
     Generic sketches for future projects: line, bars, network, lanes, scatter, clusters, dashboard, document, image.
     An unknown or missing name falls back to "generic", a rack map that fills and empties.
   - canvas[data-scene="hero|floor|belt"]: the background scenes. hero = racking elevation with a hoist and a conveyor
     along the bottom; floor = faint location grid with cartons moving node to node; belt = a slim conveyor in the footer.
   Palette: ink, safety orange, two greys, white. States are ink versus orange, solid versus dashed or hatched. No gradients, no shadows.
   Off-screen canvases are idle. html.still (the motion switch), prefers-reduced-motion and a hidden tab all stop the loop
   after one still frame. devicePixelRatio is handled and everything is redrawn once web fonts arrive.
   Sound: the hero and floor scenes ask window.Sound.cue(name, {pan, ...}) when something happens (the hoist phases,
   a floor carton rolling or set down). They only ask on live frames; sound.js decides whether anything plays. */
(function () {
  var INK = "#121212", OR = "#F26419", MUT = "#5F5F5F", RULE = "#D6D6D6", WHITE = "#FFFFFF";
  var MONO = "IBM Plex Mono, Menlo, Consolas, monospace", COND = "Barlow Condensed, Arial Narrow, sans-serif";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- helpers ---------- */
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(r) { return (r() + r() + r() + r() - 2) / 1.15; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(p) { p = clamp(p, 0, 1); return p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
  function eo(p) { p = clamp(p, 0, 1); return 1 - Math.pow(1 - p, 3); }
  function sm(a, b, x) { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function txt(c, s, x, y, px, col, align, font, weight) { c.font = (weight || 400) + " " + px + "px " + (font || MONO); c.fillStyle = col; c.textAlign = align || "left"; c.textBaseline = "middle"; c.fillText(s, x, y); }
  function dash(c, on, off) { c.setLineDash(on ? [on, off || on] : []); }
  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, 6.2832); }
  function line(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  function box(c, x, y, w, h) { c.beginPath(); c.rect(x, y, w, h); }
  var MW = {};
  function chw(c, fs) { var k = Math.round(fs * 4); var v = MW[k]; if (!v) { c.font = "400 " + (k / 4) + "px " + MONO; v = MW[k] = c.measureText("0").width / (k / 4); } return v * fs; }
  function tw(c, s, px, font, weight) { c.font = (weight || 400) + " " + px + "px " + (font || MONO); return c.measureText(s).width; }
  function fitMono(c, n, maxW, fs) { var cw = chw(c, fs); return cw * n <= maxW ? fs : Math.max(5.5, fs * maxW / (cw * n)); }
  /* orange hatch pattern, one per context */
  function hatch(c, col) {
    var key = "__hatch" + (col || "");
    if (!c[key]) {
      var p = document.createElement("canvas"); p.width = p.height = 8; var g = p.getContext("2d");
      g.strokeStyle = col || OR; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
      c[key] = c.createPattern(p, "repeat");
    }
    return c[key];
  }
  function alpha(hex, a) { var s = hex.slice(1); return "rgba(" + parseInt(s.slice(0, 2), 16) + "," + parseInt(s.slice(2, 4), 16) + "," + parseInt(s.slice(4, 6), 16) + "," + a + ")"; }
  /* sound cues: the scenes only ask, sound.js decides whether anything plays. pan is -1 (left) to 1 (right) from an x position. */
  function cue(name, o) { try { if (window.Sound && window.Sound.cue) window.Sound.cue(name, o); } catch (e) { } }
  function panOf(x, w) { return clamp((x / w) * 2 - 1, -1, 1) * .8; }
  /* a scene may fire cues only on a live frame that follows another live frame closely: not on the first draw after a
     rebuild, not on a still frame, and not after a long gap (tab hidden, scrolled away), where every threshold between
     the old and new time would otherwise fire at once */
  function liveStep(it, t) { var ok = !!it.live && it.lastT != null && t - it.lastT < .5 && t > it.lastT; it.lastT = t; return ok; }
  function tag(c, s, x, y, px, col, bg) { var ww = tw(c, s, px) + px; c.fillStyle = bg || WHITE; c.fillRect(x - px / 2, y - px * .8, ww, px * 1.6); c.strokeStyle = col; c.lineWidth = 1; c.strokeRect(x - px / 2, y - px * .8, ww, px * 1.6); txt(c, s, x, y, px, col); }
  /* a carton in line work: outline, flap seam, a small label */
  function carton(c, x, y, w, h, col, lw) {
    c.strokeStyle = col; c.lineWidth = lw || 2; c.strokeRect(x, y, w, h);
    line(c, x, y + h * .3, x + w, y + h * .3);
    line(c, x + w * .5, y, x + w * .5, y + h * .3);
    c.lineWidth = Math.max(1, (lw || 2) * .6); c.strokeRect(x + w * .62, y + h * .55, w * .26, h * .3);
  }

  var D = {};

  /* 1. Warehouse ledger: rows only append, stock is the sum, an UPDATE is refused */
  var LB = null;
  D.ledger = function (c, w, h, t, S) {
    S = Math.min(S, w / 300);
    var Q = [24, -6, -4, 12, -8, -3, 6, -9, 18, -5, -7, -2];
    if (LB === null) { LB = 0; for (var b = 0; b < 60; b++) if (b % 5 !== 4) LB += Q[b % 12]; }
    function sumTo(k) { var s = 120, full = Math.floor((k + 1) / 60); s += full * LB; for (var i = full * 60; i <= k; i++) if (i % 5 !== 4) s += Q[i % 12]; return s; }
    var big = S > 1.4 && w > 460, pad = 12 * S, rh = 17 * S, tw0 = Math.round(w * .62), top = pad + 18 * S;
    var fs = fitMono(c, 30, tw0 - pad - 6 * S, 9.5 * S), cw = chw(c, fs);
    var per = 1.05, kf = t / per + 9, kNow = Math.floor(kf), frac = kf - kNow;
    txt(c, "LEDGER  append only", pad, pad + 5 * S, fs * .95, MUT);
    if (big) txt(c, (kNow + 1) + " rows", tw0 - 8 * S, pad + 5 * S, fs * .9, MUT, "right");
    c.strokeStyle = INK; c.lineWidth = 1.5; line(c, pad - 4, top - 2, tw0 - 4, top - 2);
    var n = Math.max(3, Math.ceil((h - top - pad) / rh)) + 1;
    var slide = (1 - eo(frac / .5)) * rh, xId = pad, xSku = pad + cw * 6.5, xR = tw0 - 8 * S;
    c.save(); c.beginPath(); c.rect(pad - 4, top - 1, tw0 - pad + 4, h - top - pad + 2); c.clip();
    for (var j = 0; j < n; j++) {
      var k = kNow - j; if (k < 0) break;
      var y = top + rh * (j + .5) - slide, refused = k % 5 === 4, q = Q[k % 12], enter = j === 0 ? eo((frac - .05) / .4) : 1;
      c.globalAlpha = enter;
      if (j === 0) { c.globalAlpha = enter * (1 - eo(frac / 1)); c.fillStyle = refused ? OR : INK; c.fillRect(pad - 4, y - rh / 2 + 1, 3 * S, rh - 2); c.globalAlpha = enter; }
      txt(c, "#" + (1000 + k), xId, y, fs, refused ? OR : MUT);
      if (refused) {
        var lab = "UPDATE #" + (999 + k - 3), lw = cw * lab.length, wipe = j === 0 ? eo((frac - .25) / .35) : 1;
        txt(c, lab, xSku, y, fs, OR);
        c.strokeStyle = OR; c.lineWidth = Math.max(1, S * .9); line(c, xSku, y + .5, xSku + lw * wipe, y + .5);
        c.globalAlpha = enter * (j === 0 ? eo((frac - .45) / .3) : 1);
        txt(c, "refused", xR, y, fs * .9, OR, "right");
      } else {
        txt(c, "SKU-" + ("0" + ((k * 7) % 43 + 1)).slice(-2), xSku, y, fs, INK);
        txt(c, (q > 0 ? "+" : "") + q, xR, y, fs, INK, "right");
      }
      c.globalAlpha = 1;
      c.strokeStyle = RULE; c.lineWidth = 1; line(c, pad - 4, y + rh / 2, tw0 - 4, y + rh / 2);
    }
    c.restore();
    /* stock panel */
    var px0 = tw0 + 8 * S, pw = w - tw0 - 8 * S - pad, cx = px0 + pw / 2;
    c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(px0, pad, pw, h - pad * 2);
    var sPrev = sumTo(kNow - 1), sNow = sumTo(kNow), sum = Math.round(lerp(sPrev, sNow, eo((frac - .12) / .5)));
    txt(c, "STOCK", cx, h * .3, fs * .95, MUT, "center");
    var nfs = Math.min(40 * S, pw * .4), ns = String(sum); if (tw(c, ns, nfs, COND, 800) > pw - 16 * S) nfs *= (pw - 16 * S) / tw(c, ns, nfs, COND, 800);
    var flash = (1 - eo(frac / .6));
    txt(c, ns, cx, h * .5, nfs, flash > .5 ? OR : INK, "center", COND, 800);
    txt(c, "= SUM(ledger)", cx, h * .7, fs * .9, INK, "center");
  };

  /* 2. PO line parser: scan each line, read barcode and quantity, refuse what fails. generic = "document" */
  D.po = function (c, w, h, t, S, generic) {
    S = Math.min(S, w / 300);
    var L = generic ? [
      ["DOCUMENT  NO 2026-0001", 0],
      ["Ref 021 7590 1234 56", "x not an item"],
      ["1 8991234567891 ITEM A   6. PCS", "891 x 6"],
      ["2 8991234567907 ITEM B  12  PCS", "907 x 12"],
      ["3 8991234567914 ITEM C  24  EA", "914 x 24"],
      ["Page 3/4  ref 889912345678", "x no unit, refused"],
      ["4 8991234567921 ITEM D   4  CTN", "921 x 4"]
    ] : [
      ["PURCHASE ORDER  PO-2611-0042", 0],
      ["Tel 021 7590 1234 56", "x phone, check digit fails"],
      ["1 8991234567891 BEAR S   6. PCS", "891 x 6"],
      ["2 8991234567907 BEAR M  12  PCS", "907 x 12"],
      ["3 8991234567914 KEYRING 24  EA", "914 x 24"],
      ["Box 3/4  ref 889912345678", "x no unit, refused"],
      ["4 8991234567921 BLANKET  4  CTN", "921 x 4"]
    ];
    var big = S > 1.4 && w > 460, pad = 12 * S, dw = Math.round(w * (big ? .6 : .57)), lh = (h - pad * 2) / L.length;
    var fs = fitMono(c, 31, dw - pad - 14 * S, 9 * S), cw = chw(c, fs);
    var per = .75, scanT = L.length * per, hold = 2.0, fade = .6, cyc = scanT + hold + fade + .25, tt = t % cyc;
    var scan = Math.min(tt / per, L.length), out = tt > scanT + hold ? eo((tt - scanT - hold) / fade) : 0, res = 1 - out;
    /* paper */
    c.fillStyle = WHITE; c.fillRect(pad, pad - 2, dw - pad, h - pad * 2 + 4);
    c.strokeStyle = INK; c.lineWidth = 1.5; c.strokeRect(pad, pad - 2, dw - pad, h - pad * 2 + 4);
    c.save(); c.beginPath(); c.rect(pad, pad - 2, dw - pad, h - pad * 2 + 4); c.clip();
    for (var i = 0; i < L.length; i++) {
      var y = pad + lh * (i + .5), done = scan > i + 1, on = tt < scanT && scan > i && scan <= i + 1, bad = L[i][1] && L[i][1].charAt(0) === "x";
      if (on) { c.fillStyle = alpha(OR, .12); c.fillRect(pad, y - lh / 2, dw, lh); }
      if (done && L[i][1]) {
        var a = eo((scan - i - 1) * 2.5) * res; c.globalAlpha = a;
        if (bad) { c.fillStyle = hatch(c); c.fillRect(pad + 4 * S, y - lh * .34, cw * (L[i][0].length) + 6 * S, lh * .68); }
        else { c.strokeStyle = INK; c.lineWidth = 1.2; c.strokeRect(pad + 7 * S + cw * 1.8, y - lh * .32, cw * 13.4, lh * .64); }
        c.globalAlpha = 1;
      }
      txt(c, L[i][0], pad + 7 * S, y, fs, INK, "left", MONO, i === 0 ? 500 : 400);
      if (i) { c.strokeStyle = RULE; c.lineWidth = 1; line(c, pad, y + lh / 2, dw, y + lh / 2); }
    }
    if (scan < L.length) {
      var sy = pad + lh * scan, sa = sm(0, .2, tt);
      c.fillStyle = alpha(OR, .1 * sa); c.fillRect(pad, sy - 14 * S, dw, 14 * S);
      c.fillStyle = alpha(OR, sa); c.fillRect(pad, sy - 1, dw, 2);
    }
    c.restore();
    /* chips */
    var x0 = dw + 8 * S, avail = w - x0 - pad, cfs = big ? fs * .92 : fitMono(c, 26, avail - 12 * S, fs * .92), cwc = chw(c, cfs), maxCh = Math.floor((avail - 12 * S) / cwc);
    for (var j = 0; j < L.length; j++) {
      if (!L[j][1] || scan <= j + 1) continue;
      var yy = pad + lh * (j + .5), isBad = L[j][1].charAt(0) === "x", lab = (isBad ? "x " : "ok ") + (isBad ? L[j][1].slice(2) : L[j][1]);
      var ap = eo((scan - j - 1) * 2.5), al = ap * res, lines = [lab];
      if (lab.length > maxCh) {
        if (big) { var cut = lab.lastIndexOf(" ", maxCh); if (cut < 2) cut = maxCh; lines = [lab.slice(0, cut), lab.slice(cut + 1)]; if (lines[1].length > maxCh) lines[1] = lines[1].slice(0, Math.max(1, maxCh - 1)) + "…"; }
        else lines = [lab.slice(0, Math.max(4, maxCh - 1)) + "…"];
      }
      var need = cwc * Math.max(lines[0].length, lines[1] ? lines[1].length : 0) + 12 * S, ch = lines.length > 1 ? Math.min(lh * .92, cfs * 2.9) : lh * .76;
      var cx0 = x0 - 10 * S * (1 - ap), col = isBad ? OR : INK;
      c.globalAlpha = al;
      c.fillStyle = WHITE; c.fillRect(cx0, yy - ch / 2, need, ch);
      if (isBad) { c.fillStyle = hatch(c); c.globalAlpha = al * .35; c.fillRect(cx0, yy - ch / 2, need, ch); c.globalAlpha = al; }
      c.strokeStyle = col; c.lineWidth = isBad ? 1.5 : 1; c.strokeRect(cx0, yy - ch / 2, need, ch);
      if (lines.length > 1) { txt(c, lines[0], cx0 + 6 * S, yy - cfs * .62, cfs, col); txt(c, lines[1], cx0 + 6 * S, yy + cfs * .62, cfs, col); }
      else txt(c, lines[0], cx0 + 6 * S, yy, cfs, col);
      c.globalAlpha = 1;
    }
    if (big) { var sa2 = sm(scanT + .1, scanT + .6, tt) * res, yy0 = pad + lh * .5; c.globalAlpha = sa2; txt(c, "4 read, 2 refused", x0, yy0, fs * .92, MUT); c.globalAlpha = 1; }
  };
  D.document = function (c, w, h, t, S) { D.po(c, w, h, t, S, true); };

  /* 3. Replenishment: stock falls, reorder at ROP, refills to MAX. The series is a loop cut between two refills. */
  var REP = null;
  D.repl = function (c, w, h, t, S) {
    S = Math.min(S, w / 300);
    if (!REP) {
      var r = rng(7), s = 82, wait = -1, pts = [], refills = [];
      for (var i = 0; i < 900; i++) { var d = 7 + 4 * Math.sin(i * .6) + r() * 5; s -= d; var ev = 0; if (wait === 0) { s = 100; ev = 2; wait = -1; refills.push(i); } else if (wait > 0) wait--; if (s <= 38 && wait < 0) { wait = 2; ev = 1; } if (s < 6) s = 6; pts.push([s, ev]); }
      REP = pts.slice(refills[1], refills[refills.length - 2]);
    }
    var big = S > 1.4 && w > 460, N = REP.length, pad = 14 * S, x0 = pad + 26 * S, x1 = w - pad, y0 = pad + 6 * S, y1 = h - pad - 4 * S, fs = 8.5 * S;
    function Y(v) { return y1 - (v / 110) * (y1 - y0); }
    function P(i) { return REP[((i % N) + N) % N]; }
    var vis = 26, spd = 2.4, o = (t * spd) % N, i0 = Math.floor(o), fo = o - i0, dx = (x1 - x0) / vis;
    c.fillStyle = alpha(INK, .04); c.fillRect(x0, Y(100), x1 - x0, Y(38) - Y(100));
    dash(c, 4 * S); c.lineWidth = 1;
    c.strokeStyle = MUT; line(c, x0, Y(100), x1, Y(100));
    c.strokeStyle = OR; c.lineWidth = 1.5; line(c, x0, Y(38), x1, Y(38));
    c.strokeStyle = RULE; c.lineWidth = 1; line(c, x0, Y(14), x1, Y(14));
    dash(c, 0);
    txt(c, "MAX", x0 - 6 * S, Y(100), fs, MUT, "right"); txt(c, "ROP", x0 - 6 * S, Y(38), fs, OR, "right"); txt(c, "MIN", x0 - 6 * S, Y(14), fs, MUT, "right");
    c.save(); c.beginPath(); c.rect(x0, 0, x1 - x0, h); c.clip();
    c.beginPath();
    for (var k = 0; k <= vis + 1; k++) { var x = x0 + (k - fo) * dx; if (k === 0) c.moveTo(x, Y(P(i0 + k)[0])); else c.lineTo(x, Y(P(i0 + k)[0])); }
    c.strokeStyle = INK; c.lineWidth = 1.8 * Math.min(S, 1.6); c.lineJoin = "round"; c.stroke();
    for (k = 0; k <= vis + 1; k++) {
      var p = P(i0 + k); x = x0 + (k - fo) * dx; var py = Y(p[0]), age = (x1 - x) / dx / spd;
      if (p[1] === 1) {
        var drop = eo(age / .5); c.globalAlpha = drop; c.fillStyle = OR;
        c.beginPath(); c.moveTo(x, py + 6 * S + (1 - drop) * 8 * S); c.lineTo(x - 5 * S, py + 14 * S + (1 - drop) * 8 * S); c.lineTo(x + 5 * S, py + 14 * S + (1 - drop) * 8 * S); c.fill();
        if (big) txt(c, "PO", x, py + 23 * S, fs, OR, "center");
        c.globalAlpha = 1;
      }
      if (p[1] === 2) {
        c.fillStyle = INK; circle(c, x, py, 3.2 * S); c.fill();
        if (age < 1.2) { c.globalAlpha = (1 - age / 1.2) * .8; c.strokeStyle = INK; c.lineWidth = 1.2; circle(c, x, py, 4 * S + eo(age / 1.2) * 12 * S); c.stroke(); c.globalAlpha = 1; }
      }
    }
    c.restore();
    var ha = P(i0 + vis)[0], hb = P(i0 + vis + 1)[0], hv = lerp(ha, hb, fo), hy = Y(hv);
    c.fillStyle = OR; c.fillRect(x1 - 3.5 * S, hy - 3.5 * S, 7 * S, 7 * S);
    if (big) txt(c, Math.round(hv) + " units", x1 - 8 * S, hy - 12 * S, fs, INK, "right");
  };

  /* 4. Basket: SKUs that sell together light up in pairs, rising stars are orange. generic = "network" */
  var BK = {};
  D.basket = function (c, w, h, t, S, generic) {
    S = Math.min(S, w / 300);
    var big = S > 1.4 && w > 460, key = Math.round(w) + "x" + Math.round(h) + (big ? "b" : "s"), N = 12;
    var E = [[0, 3], [3, 7], [1, 5], [2, 9], [4, 10], [0, 8], [6, 11], [7, 2], [5, 9], [10, 1], [3, 11], [8, 4], [6, 0], [9, 7]];
    var star = { 0: 1, 3: 1, 7: 1 };
    if (!BK[key]) {
      var r = rng(11), P = [], cx = w * .5 + (big ? 14 * S : 0), cy = h * .5 - (big ? 6 * S : 0), rx = w * .42 - 16 * S, ry = h * .5 - 18 * S;
      for (var i = 0; i < N; i++) { var ang = i / N * Math.PI * 2 + (r() - .5) * .5, rad = .62 + r() * .38; P.push([cx + Math.cos(ang) * rx * rad, cy + Math.sin(ang) * ry * rad]); }
      var minD = 26 * S;
      for (var it = 0; it < 12; it++) for (i = 0; i < N; i++) for (var j = i + 1; j < N; j++) {
        var ddx = P[j][0] - P[i][0], ddy = P[j][1] - P[i][1], dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        if (dd < minD) { var push = (minD - dd) / 2; ddx /= dd; ddy /= dd; P[i][0] -= ddx * push; P[i][1] -= ddy * push; P[j][0] += ddx * push; P[j][1] += ddy * push; }
      }
      for (i = 0; i < N; i++) { P[i][0] = clamp(P[i][0], 14 * S, w - 14 * S); P[i][1] = clamp(P[i][1], 16 * S, h - 14 * S); }
      BK[key] = P;
    }
    var P = BK[key], step = .8, len = E.length, act = Math.floor(t / step) % len, f = (t / step) % 1;
    var glow = [], lit = [], hit = [];
    for (var k = 0; k < len; k++) { var since = ((act - k + len) % len) * step + f * step; glow[k] = k === act ? .3 + .7 * eo(f) : Math.exp(-(since - step) / 1.3); }
    for (i = 0; i < N; i++) { lit[i] = 0; hit[i] = 9; }
    for (k = 0; k < len; k++) { var e = E[k]; if (glow[k] > lit[e[0]]) lit[e[0]] = glow[k]; if (glow[k] > lit[e[1]]) lit[e[1]] = glow[k]; var age = ((act - k + len) % len) * step + f * step - step; if (age >= 0 && age < hit[e[1]]) hit[e[1]] = age; }
    for (k = 0; k < len; k++) {
      var a = P[E[k][0]], b = P[E[k][1]];
      c.strokeStyle = RULE; c.lineWidth = 1.2; line(c, a[0], a[1], b[0], b[1]);
      if (glow[k] > .02) { c.strokeStyle = OR; c.globalAlpha = glow[k]; c.lineWidth = 1 + glow[k] * 1.4 * S; line(c, a[0], a[1], b[0], b[1]); c.globalAlpha = 1; }
    }
    var ea = P[E[act][0]], eb = P[E[act][1]];
    for (var q = 3; q >= 0; q--) {
      var pf = ease(clamp(f - q * .04, 0, 1)), px = lerp(ea[0], eb[0], pf), py = lerp(ea[1], eb[1], pf), pa = sm(0, .1, f) * (1 - sm(.9, 1, f)) * (1 - q / 4), sz = (q ? 2.2 : 3.2) * S * (1 - q / 6);
      c.globalAlpha = pa; c.fillStyle = OR; c.fillRect(px - sz, py - sz, sz * 2, sz * 2);
    }
    c.globalAlpha = 1;
    for (i = 0; i < N; i++) {
      var p = P[i], rad2 = (star[i] ? 7 : 5.5) * Math.min(S, 1.8), li = lit[i];
      if (hit[i] < .9) { c.globalAlpha = (1 - hit[i] / .9) * .8; c.strokeStyle = OR; c.lineWidth = 1.2; circle(c, p[0], p[1], rad2 + eo(hit[i] / .9) * 14 * S); c.stroke(); c.globalAlpha = 1; }
      c.fillStyle = star[i] ? OR : (li > .5 ? INK : WHITE); c.strokeStyle = star[i] ? INK : INK; c.lineWidth = 1.6;
      circle(c, p[0], p[1], rad2); c.fill(); c.stroke();
      if (star[i]) {
        var by = p[1] - rad2 - 7 * S - Math.sin(t * 2.4 + i) * 2 * S;
        c.strokeStyle = INK; c.lineWidth = 2; c.lineCap = "round"; c.beginPath(); c.moveTo(p[0] - 4 * S, by + 3 * S); c.lineTo(p[0], by - 1 * S); c.lineTo(p[0] + 4 * S, by + 3 * S); c.stroke(); c.lineCap = "butt";
        if (big && !generic) txt(c, "SKU-" + ("0" + (i * 7 + 3)).slice(-2), p[0], p[1] + rad2 + 10 * S, 8.5 * S, INK, "center");
      }
    }
    if (big) {
      c.fillStyle = OR; c.strokeStyle = INK; c.lineWidth = 1.4; circle(c, 20 * S, h - 30 * S, 4 * S); c.fill(); c.stroke(); txt(c, generic ? "key node" : "rising star", 30 * S, h - 30 * S, 9 * S, INK);
      c.strokeStyle = OR; c.lineWidth = 2; line(c, 14 * S, h - 14 * S, 26 * S, h - 14 * S); txt(c, generic ? "linked" : "bought together", 30 * S, h - 14 * S, 9 * S, INK);
    }
  };
  D.network = function (c, w, h, t, S) { D.basket(c, w, h, t, S, true); };

  /* 5. Procurement anomaly: points judged against their own group, outliers flagged by a sweep. generic = "scatter" */
  var AN = {};
  D.anom = function (c, w, h, t, S, generic) {
    S = Math.min(S, w / 300);
    var big = S > 1.4 && w > 460, G = 4, pad = 14 * S, gw = (w - pad * 2) / G, n = big ? 22 : 13, key = Math.round(w) + "x" + Math.round(h) + n;
    var mu = [.45, .58, .38, .52], sd = [.07, .06, .09, .05], botY = big ? 12 * S : 8 * S;
    function Y(v) { return pad + 8 * S + (1 - v) * (h - pad * 2 - 10 * S - botY); }
    if (!AN[key]) {
      var r = rng(5), pts = [];
      for (var g = 0; g < G; g++) for (var i = 0; i < n; i++) {
        var out = i === 0 || (g % 2 === 0 && i === 1), v = out ? mu[g] + (r() < .5 ? -1 : 1) * sd[g] * (2.5 + r() * 1.2) : mu[g] + gauss(r) * sd[g] * .9;
        pts.push([pad + gw * g + 10 * S + r() * (gw - 20 * S), Y(clamp(v, .02, .98)), out ? 1 : 0]);
      }
      AN[key] = pts;
    }
    var sweepT = 4.6, cyc = t % 8, span = w + 30 * S, sweep = Math.min(cyc, sweepT) / sweepT * span - 15 * S, rel = cyc < 7.4 ? 1 : 1 - eo((cyc - 7.4) / .6);
    for (g = 0; g < G; g++) {
      var gx = pad + gw * g, cx = gx + gw / 2, yt = Y(mu[g] + 2 * sd[g]), yb = Y(mu[g] - 2 * sd[g]);
      c.fillStyle = alpha(INK, .04); c.fillRect(gx + 6 * S, yt, gw - 12 * S, yb - yt);
      c.strokeStyle = MUT; dash(c, 3 * S); c.lineWidth = 1; line(c, gx + 6 * S, yt, gx + gw - 6 * S, yt); line(c, gx + 6 * S, yb, gx + gw - 6 * S, yb); dash(c, 0);
      if (big) { c.strokeStyle = RULE; line(c, gx + 6 * S, Y(mu[g]), gx + gw - 6 * S, Y(mu[g])); }
      txt(c, big ? (generic ? "Group " : "Region ") + (g + 1) : (generic ? "G" : "R") + (g + 1), cx, h - pad + 3 * S, 8.5 * S, MUT, "center");
    }
    var pts2 = AN[key], rad = 2.6 * Math.min(S, 1.8), flagged = 0;
    for (i = 0; i < pts2.length; i++) {
      var p = pts2[i], seen = clamp((sweep - p[0]) / (10 * S), 0, 1) * rel, isOut = p[2] === 1;
      if (isOut && seen > .5) flagged++;
      c.globalAlpha = .45 + .55 * seen;
      if (isOut && seen > .5) { c.fillStyle = OR; circle(c, p[0], p[1], rad * 1.35); c.fill(); c.strokeStyle = INK; c.lineWidth = 1; circle(c, p[0], p[1], rad * 1.35); c.stroke(); }
      else { c.fillStyle = INK; circle(c, p[0], p[1], rad); c.fill(); }
      if (isOut && seen > 0) {
        var tp = (p[0] + 15 * S) / span * sweepT, age = cyc - tp;
        if (age >= 0 && age < 1.1) { c.globalAlpha = (1 - age / 1.1) * .85 * rel; c.strokeStyle = OR; c.lineWidth = 1.3; circle(c, p[0], p[1], rad * 1.6 + eo(age / 1.1) * 12 * S); c.stroke(); }
      }
      c.globalAlpha = 1;
    }
    if (cyc < sweepT) {
      var sa = sm(0, .15, cyc) * (1 - sm(sweepT - .25, sweepT, cyc));
      c.fillStyle = alpha(OR, .08 * sa); c.fillRect(sweep - 36 * S, pad - 4, 36 * S, h - pad * 2 + 4 - botY);
      c.fillStyle = alpha(OR, sa); c.fillRect(sweep, pad - 4, 2, h - pad * 2 + 4 - botY);
    }
    if (big) { txt(c, generic ? "band = mean +/- 2 sd per group" : "band = mean +/- 2 sd per region", w - pad, pad, 9 * S, MUT, "right"); c.globalAlpha = rel; txt(c, "flagged " + flagged, pad, pad, 9 * S, flagged ? OR : MUT); c.globalAlpha = 1; }
  };
  D.scatter = function (c, w, h, t, S) { D.anom(c, w, h, t, S, true); };

  /* 6. LPG distribution: three lanes from a depot, delivery takes 1.5, 2.2 and 3.1 days. generic = "lanes" */
  D.lpg = function (c, w, h, t, S, generic) {
    S = Math.min(S, w / 300);
    var big = S > 1.4 && w > 460, pad = 12 * S, dep = 54 * S, x0 = pad + dep + 8 * S, x1 = w - pad - (big ? 96 : 58) * S, fs = 9 * S;
    var lanes = generic ? [["1", 1.5, INK], ["2", 2.2, MUT], ["3", 3.1, OR]] : [["A", 1.5, INK], ["B", 2.2, MUT], ["C", 3.1, OR]];
    c.fillStyle = INK; c.fillRect(pad, h * .18, dep, h * .64);
    txt(c, generic ? "ORIGIN" : "DEPOT", pad + dep / 2, h * .5, fs * .95, WHITE, "center", MONO, 500);
    lanes.forEach(function (ln, i) {
      var y = h * (.25 + i * .25), T = ln[1] * 1.5, gap = T / 3, age = t % gap, flash = Math.exp(-age * 4), bw = 16 * S;
      c.strokeStyle = RULE; c.lineWidth = 1.5; dash(c, 5 * S, 5 * S); c.lineDashOffset = -(t * (x1 - x0 - 18 * S) / T) % (10 * S); line(c, x0, y, x1, y); dash(c, 0); c.lineDashOffset = 0;
      c.fillStyle = flash > .4 ? OR : WHITE; c.strokeStyle = INK; c.lineWidth = 1.5; c.fillRect(x1, y - 9 * S, bw, 18 * S); c.strokeRect(x1, y - 9 * S, bw, 18 * S);
      var lab = generic ? (big ? "Lane " + ln[0] : "L" + ln[0]) : (big ? "Area " + ln[0] + "  " + ln[1] + " d" : ln[0] + " " + ln[1] + "d");
      txt(c, lab, x1 + bw + 6 * S, y - (big ? 5 * S : 0), fs, ln[2]);
      if (big) txt(c, Math.floor(t / gap) + 12 + " delivered", x1 + bw + 6 * S, y + 8 * S, fs * .85, MUT);
      for (var k = 0; k < 3; k++) {
        var p = ((t + k * gap) % T) / T, x = x0 + (x1 - x0 - 18 * S) * p;
        c.globalAlpha = p < .06 ? p / .06 : p > .94 ? (1 - p) / .06 : 1;
        c.fillStyle = ln[2] === OR ? OR : INK; c.fillRect(x, y - 7 * S, 18 * S, 12 * S);
        c.fillStyle = WHITE; c.strokeStyle = INK; c.lineWidth = 1; for (var q = 0; q < 2; q++) { circle(c, x + 5 * S + q * 8 * S, y + 6 * S, 2.2 * S); c.fill(); c.stroke(); }
        c.globalAlpha = 1;
      }
    });
  };
  D.lanes = function (c, w, h, t, S) { D.lpg(c, w, h, t, S, true); };

  /* 7. Forecast: actual demand and three methods, then a three-month projection. generic = "line" */
  var FC = null;
  D.fc = function (c, w, h, t, S, generic) {
    S = Math.min(S, w / 300);
    if (!FC) {
      var r = rng(3), sea = [1.15, 1.18, 1.1, 1, .95, .92, .9, .88, .9, .95, 1, 1.08], a = [];
      for (var i = 0; i < 18; i++) a.push(2000 * sea[(i + 11) % 12] + gauss(r) * 70);
      var sma = [], wma = [], ses = [a[0]];
      for (i = 0; i < 18; i++) { sma.push(i < 2 ? null : (a[i] + a[i - 1] + a[i - 2]) / 3); wma.push(i < 2 ? null : a[i] * .5 + a[i - 1] * .3 + a[i - 2] * .2); if (i) ses.push(.4 * a[i] + .6 * ses[i - 1]); }
      FC = { a: a, m: [[sma, MUT, 4], [wma, INK, 2], [ses, OR, 0]] };
    }
    var names = generic ? ["Actual", "Method A", "Method B", "Method C"] : ["Actual", "SMA-3", "WMA-3", "SES"];
    var big = S > 1.4 && w > 460, pad = 14 * S, x0 = pad, x1 = w - pad, y0 = pad + 14 * S, y1 = h - pad - (big ? 10 * S : 0), n = 21, fs = 8.5 * S;
    function X(i) { return x0 + (x1 - x0) * i / (n - 1); }
    function Y(v) { return y1 - (v - 1600) / (2500 - 1600) * (y1 - y0); }
    c.strokeStyle = RULE; c.lineWidth = 1; for (var g = 0; g < 4; g++) { var gy = y0 + (y1 - y0) * g / 3; line(c, x0, gy, x1, gy); }
    var cyc = t % 9.6, lim = clamp(cyc / 4.8, 0, 1) * 17, pr = eo((cyc - 5) / 1.3), all = cyc < 8.6 ? 1 : 1 - eo((cyc - 8.6) / .8);
    c.fillStyle = hatch(c, RULE); c.fillRect(X(17), y0, X(20) - X(17), y1 - y0);
    if (big) { for (i = 0; i < 18; i += 5) txt(c, "m" + (i + 1), X(i), y1 + 7 * S, fs * .9, MUT, "center"); txt(c, "+3 mo", X(18.5), y1 + 7 * S, fs * .9, OR, "center"); }
    c.beginPath(); FC.a.forEach(function (v, i) { if (i) c.lineTo(X(i), Y(v)); else c.moveTo(X(i), Y(v)); }); c.strokeStyle = INK; c.lineWidth = 1.6; c.lineJoin = "round"; c.stroke();
    FC.a.forEach(function (v, i) { c.fillStyle = INK; circle(c, X(i), Y(v), 2 * Math.min(S, 1.6)); c.fill(); });
    c.globalAlpha = all;
    FC.m.forEach(function (m) {
      c.beginPath(); var st = false, hx = 0, hy = 0;
      for (var i = 0; i <= Math.ceil(lim) && i < 18; i++) {
        var v = m[0][i]; if (v == null) continue;
        var xx = i > lim ? lim : i, vv = i > lim ? m[0][i - 1] + (v - m[0][i - 1]) * (lim - i + 1) : v;
        if (!st) { c.moveTo(X(xx), Y(vv)); st = true; } else c.lineTo(X(xx), Y(vv)); hx = X(xx); hy = Y(vv);
      }
      c.strokeStyle = m[1]; c.lineWidth = (m[1] === OR ? 2.2 : 1.3) * Math.min(S, 1.6); dash(c, m[2] ? m[2] * S : 0); c.stroke(); dash(c, 0);
      if (st && lim < 17) { c.fillStyle = m[1]; c.fillRect(hx - 2.6 * S, hy - 2.6 * S, 5.2 * S, 5.2 * S); }
    });
    if (pr > 0) {
      var last = FC.m[2][0][17], pts = [last, last * 1.03, last * 1.07, last * 1.12];
      c.save(); c.beginPath(); c.rect(X(17), 0, (X(20) - X(17)) * pr + 1, h); c.clip();
      c.fillStyle = alpha(OR, .14); c.beginPath();
      for (var k = 0; k < 4; k++) c.lineTo(X(17 + k), Y(pts[k] + k * 45)); for (k = 3; k >= 0; k--) c.lineTo(X(17 + k), Y(pts[k] - k * 45)); c.closePath(); c.fill();
      c.beginPath(); for (k = 0; k < 4; k++) { if (k) c.lineTo(X(17 + k), Y(pts[k])); else c.moveTo(X(17), Y(pts[0])); } c.strokeStyle = OR; c.lineWidth = 2; dash(c, 3 * S); c.stroke(); dash(c, 0);
      c.restore();
      var hp = pr * 3, h0 = Math.min(3, Math.floor(hp)), hv = lerp(pts[h0], pts[Math.min(3, h0 + 1)], hp - h0);
      c.globalAlpha = all * (1 - sm(.92, 1, pr)); c.fillStyle = OR; c.fillRect(X(17 + hp) - 2.6 * S, Y(hv) - 2.6 * S, 5.2 * S, 5.2 * S);
      c.globalAlpha = all;
    }
    var lx = x0;
    [[names[0], INK, 1, 0], [names[1], MUT, eo(lim / 2) * all, 4], [names[2], INK, eo(lim / 2) * all, 2], [names[3], OR, eo(lim) * all, 0]].forEach(function (l) {
      c.globalAlpha = .35 + .65 * l[2];
      c.strokeStyle = l[1]; c.lineWidth = 2; dash(c, l[3] ? l[3] * S : 0); line(c, lx, pad + 3 * S, lx + 12 * S, pad + 3 * S); dash(c, 0);
      txt(c, l[0], lx + 16 * S, pad + 4 * S, fs, MUT); lx += chw(c, fs) * l[0].length + 28 * S;
    });
    c.globalAlpha = 1;
  };
  D.line = function (c, w, h, t, S) { D.fc(c, w, h, t, S, true); };

  /* 8. RFM: accounts scattered, then pulled into four segments: orange, ink, grey, orange-hatched. generic = "clusters" */
  var RF = {};
  D.rfm = function (c, w, h, t, S, generic) {
    S = Math.min(S, w / 300);
    var big = S > 1.4 && w > 460, n = big ? 220 : 110, key = n + "x" + Math.round(w) + "x" + Math.round(h);
    var C = generic ? [[.25, .32, "or", "Segment 1"], [.72, .3, "ink", "Segment 2"], [.3, .74, "grey", "Segment 3"], [.74, .74, "hatch", "Segment 4"]]
      : [[.25, .32, "or", "Champions"], [.72, .3, "ink", "Loyal"], [.3, .74, "grey", "At risk"], [.74, .74, "hatch", "Lost"]];
    if (!RF[key]) { var r = rng(9), pts = [], cnt = [0, 0, 0, 0]; for (var i = 0; i < n; i++) { var s = i % 9 < 2 ? 0 : i % 9 < 5 ? 1 : i % 9 < 7 ? 2 : 3; cnt[s]++; pts.push([r(), r(), s, gauss(r) * .07, gauss(r) * .07, r()]); } RF[key] = { p: pts, cnt: cnt }; }
    var cyc = t % 8.8, mode = cyc < 1.2 ? 0 : cyc < 3.6 ? 1 : cyc < 7.6 ? 2 : 3, u = mode === 1 ? (cyc - 1.2) / 2.4 : mode === 3 ? 1 - (cyc - 7.6) / 1.2 : mode === 2 ? 1 : 0;
    var kg = mode === 1 ? ease(u) : mode === 3 ? ease(u) : u;
    /* cluster outlines */
    C.forEach(function (cc) {
      if (kg > .05) {
        var R = (big ? 50 : 32) * S * kg;
        c.globalAlpha = kg;
        if (cc[2] === "hatch") { c.fillStyle = hatch(c); circle(c, cc[0] * w, cc[1] * h, R); c.fill(); }
        c.strokeStyle = cc[2] === "grey" ? MUT : cc[2] === "ink" ? INK : OR; c.lineWidth = 1.2; dash(c, 3 * S); circle(c, cc[0] * w, cc[1] * h, R); c.stroke(); dash(c, 0);
        c.globalAlpha = 1;
      }
    });
    var pts2 = RF[key].p, rad = 2.4 * Math.min(S, 1.7);
    for (i = 0; i < pts2.length; i++) {
      var p = pts2[i], cc = C[p[2]], d = p[5], kp;
      if (mode === 1) kp = ease(clamp((u - d * .3) / .7, 0, 1)); else if (mode === 3) kp = ease(clamp((u - (1 - d) * .3) / .7, 0, 1)); else kp = kg;
      var wob = .011 * (1 - kp) + .0025, x = (lerp(.04 + p[0] * .92, cc[0] + p[3], kp) + Math.sin(t * .9 + i * 1.7) * wob) * w, y = (lerp(.06 + p[1] * .88, cc[1] + p[4], kp) + Math.cos(t * .8 + i * 2.3) * wob) * h;
      var on = kp > .5;
      if (!on) { c.fillStyle = MUT; circle(c, x, y, rad); c.fill(); continue; }
      if (cc[2] === "or") { c.fillStyle = OR; circle(c, x, y, rad); c.fill(); }
      else if (cc[2] === "ink") { c.fillStyle = INK; circle(c, x, y, rad); c.fill(); }
      else if (cc[2] === "grey") { c.fillStyle = RULE; circle(c, x, y, rad); c.fill(); c.strokeStyle = MUT; c.lineWidth = 1; c.stroke(); }
      else { c.fillStyle = WHITE; circle(c, x, y, rad); c.fill(); c.strokeStyle = OR; c.lineWidth = 1.3; c.stroke(); }
    }
    var la = sm(.78, 1, kg);
    if (la > 0) C.forEach(function (cc, j) {
      c.globalAlpha = la; var ly = cc[1] * h - (big ? 56 : 36) * S * .8;
      txt(c, cc[3], cc[0] * w, ly, 9.5 * S, INK, "center", MONO, 500);
      if (big) txt(c, "n = " + RF[key].cnt[j], cc[0] * w, ly + 11 * S, 8 * S, MUT, "center");
    });
    c.globalAlpha = 1;
    if (big) { var st = mode === 0 ? "raw accounts" : mode === 1 ? "K-Means, k = 4" : mode === 2 ? "4 segments" : "next batch"; c.globalAlpha = sm(0, .4, cyc - [0, 1.2, 3.6, 7.6][mode]); txt(c, st, w - 14 * S, 14 * S, 9 * S, MUT, "right"); c.globalAlpha = 1; }
  };
  D.clusters = function (c, w, h, t, S) { D.rfm(c, w, h, t, S, true); };

  /* 9. Ops dashboard: a small app cycling through its four pages with crossfades. generic = "dashboard" */
  var DS = null;
  D.dash = function (c, w, h, t, S, generic) {
    S = Math.min(S, w / 300);
    if (!DS) {
      DS = []; for (var pg = 0; pg < 4; pg++) { var r = rng(pg + 2), bars = [], ln = [], sc = []; for (var b = 0; b < 9; b++) bars.push(.35 + r() * .6); for (b = 0; b < 12; b++) ln.push((r() - .5) * .15); for (b = 0; b < 44; b++) sc.push([(r() - .5) * .22, (r() - .5) * .3, r()]); DS.push({ bars: bars, line: ln, sc: sc, tiles: [.3 + r() * .5, .3 + r() * .5, .3 + r() * .5] }); }
    }
    var big = S > 1.4 && w > 460, pad = 10 * S, sw = w * .27, fs = 8.5 * S, names = generic ? ["Page 1", "Page 2", "Page 3", "Page 4"] : ["Overview", "Distribution", "Forecasting", "Segmentation"];
    var per = 3.0, tr = .6, pf = t / per, act = Math.floor(pf) % 4, f = pf - Math.floor(pf), prev = (act + 3) % 4, bl = f * per < tr ? eo(f * per / tr) : 1;
    var nfs = fitMono(c, 12, sw - pad - 18 * S, fs);
    c.fillStyle = INK; c.fillRect(pad, pad, sw - pad, h - pad * 2);
    var hy = lerp(pad + 16 * S + prev * 20 * S, pad + 16 * S + act * 20 * S, bl);
    c.fillStyle = OR; c.fillRect(pad, hy - 8 * S, 4 * S, 16 * S);
    names.forEach(function (nm, i) { var y = pad + 16 * S + i * 20 * S, on = i === act ? bl : i === prev ? 1 - bl : 0; c.globalAlpha = .55 + .45 * on; txt(c, nm, pad + 11 * S, y, nfs, WHITE); c.globalAlpha = 1; });
    var mx = sw + 8 * S, mw = w - mx - pad, my = pad, mh = h - pad * 2;
    for (var k = 0; k < 3; k++) {
      var tx = mx + k * (mw / 3), tv = lerp(DS[prev].tiles[k], DS[act].tiles[k], bl);
      c.strokeStyle = INK; c.lineWidth = 1.2; c.strokeRect(tx, my, mw / 3 - 6 * S, 30 * S);
      c.fillStyle = k === 0 ? OR : RULE; c.fillRect(tx + 7 * S, my + 9 * S, (mw / 3 - 20 * S) * tv, 3 * S);
      c.fillStyle = INK; c.fillRect(tx + 7 * S, my + 17 * S, (mw / 3 - 20 * S) * .35, 6 * S);
    }
    var cy = my + 38 * S, ch = mh - 38 * S;
    c.strokeStyle = INK; c.lineWidth = 1.2; c.strokeRect(mx, cy, mw - 6 * S, ch);
    var ix = mx + 10 * S, iw = mw - 26 * S, iy = cy + 10 * S + (big ? 12 * S : 0), ih = ch - 20 * S - (big ? 12 * S : 0);
    function page(pg, al, tin) {
      if (al <= .01) return;
      var d = DS[pg], ty = tin < 9 ? (1 - eo(tin / .5)) * 6 * S : -(1 - al) * 6 * S; c.globalAlpha = al;
      if (big) txt(c, names[pg], mx + 10 * S, cy + 11 * S + ty, fs, INK, "left", MONO, 500);
      if (pg === 0 || pg === 1) {
        var nb = pg === 0 ? 6 : 9;
        for (var b = 0; b < nb; b++) { var bh = ih * d.bars[b] * eo(tin * 2 - b * .07), bx = ix + b * (iw / nb); c.fillStyle = pg === 0 ? INK : (b % 2 ? OR : INK); c.fillRect(bx + 2 * S, iy + ih - bh, iw / nb - 5 * S, bh); }
      } else if (pg === 2) {
        var reveal = eo(tin * 1.4);
        c.save(); c.beginPath(); c.rect(ix, iy - 4 * S, iw * reveal, ih + 8 * S); c.clip();
        c.beginPath(); for (var i = 0; i < 12; i++) { var x = ix + iw * i / 11, y = iy + ih * (.55 + .28 * Math.sin(i * .9) + d.line[i]); if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.strokeStyle = INK; c.lineWidth = 1.4; c.lineJoin = "round"; c.stroke();
        c.beginPath(); for (i = 0; i < 12; i++) { x = ix + iw * i / 11; y = iy + ih * (.55 + .25 * Math.sin(i * .9 - .5)); if (i) c.lineTo(x, y); else c.moveTo(x, y); } c.strokeStyle = OR; dash(c, 3 * S); c.stroke(); dash(c, 0);
        c.restore();
        var kx = ix + iw * (.2 + .6 * (.5 + .5 * Math.sin(t * 1.6))); c.fillStyle = RULE; c.fillRect(ix, iy + 1 * S, iw, 3 * S); c.fillStyle = OR; c.fillRect(ix, iy + 1 * S, kx - ix, 3 * S); c.fillStyle = INK; c.fillRect(kx - 3.5 * S, iy - 1 * S, 7 * S, 7 * S);
      } else {
        var cl = [[.25, .35, "or"], [.7, .3, "ink"], [.3, .75, "grey"], [.75, .72, "hatch"]];
        for (i = 0; i < 44; i++) { var q = cl[i % 4], s = d.sc[i], ka = eo(tin * 2.2 - s[2] * .8); if (ka <= 0) continue; c.globalAlpha = al * ka; var px = ix + iw * (q[0] + s[0]), py = iy + ih * (q[1] + s[1]), rr = 2 * Math.min(S, 1.6) * (.6 + .4 * ka); circle(c, px, py, rr); if (q[2] === "hatch") { c.fillStyle = WHITE; c.fill(); c.strokeStyle = OR; c.lineWidth = 1; c.stroke(); } else { c.fillStyle = q[2] === "or" ? OR : q[2] === "ink" ? INK : MUT; c.fill(); } }
      }
      c.globalAlpha = 1;
    }
    c.save(); c.beginPath(); c.rect(mx, cy, mw - 6 * S, ch); c.clip();
    if (bl < 1) page(prev, 1 - bl, 9);
    page(act, bl, f * per);
    c.restore();
  };
  D.dashboard = function (c, w, h, t, S) { D.dash(c, w, h, t, S, true); };

  /* 10. Finance: Monte Carlo portfolios build an efficient frontier. Orange squares clear the Sharpe threshold. */
  var FN = null;
  D.fin = function (c, w, h, t, S) {
    S = Math.min(S, w / 300);
    var rf = .065;
    if (!FN) { var r = rng(21); FN = []; for (var i = 0; i < 900; i++) { var v = .12 + Math.pow(r(), .8) * .3, top = .06 + .55 * Math.sqrt(v - .11), ret = top - Math.pow(r(), 1.6) * (top - .03); FN.push([v, ret, (ret - rf) / v > .5]); } }
    var big = S > 1.4 && w > 460, pad = 16 * S, x0 = pad + (big ? 20 : 0) * S, x1 = w - pad, y0 = pad + 10 * S, y1 = h - pad;
    function X(v) { return x0 + (v - .1) / .34 * (x1 - x0); }
    function Y(v) { return y1 - v / .4 * (y1 - y0); }
    var cyc = t % 10.4, all = cyc < 9.4 ? 1 : 1 - eo((cyc - 9.4) / .8), m = Math.floor(FN.length * eo(cyc / 5.6)), ps = 2.6 * S;
    if (big) { c.strokeStyle = INK; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0, y1); c.lineTo(x1, y1); c.stroke(); dash(c, 3 * S); c.strokeStyle = MUT; c.lineWidth = 1; line(c, x0, Y(rf), x1, Y(rf)); dash(c, 0); txt(c, "rf", x0 - 4 * S, Y(rf), 8 * S, MUT, "right"); }
    c.globalAlpha = .9 * all;
    for (i = 0; i < m; i++) { var p = FN[i]; c.fillStyle = p[2] ? OR : RULE; c.fillRect(X(p[0]) - ps / 2, Y(p[1]) - ps / 2, ps, ps); }
    if (m < FN.length) for (i = Math.max(0, m - 10); i < m; i++) { p = FN[i]; var sp = (i - (m - 10)) / 10; c.globalAlpha = sp * .9 * all; c.fillStyle = INK; var r2 = ps * (1 + sp * 1.2); c.fillRect(X(p[0]) - r2 / 2, Y(p[1]) - r2 / 2, r2, r2); }
    c.globalAlpha = all;
    var best = 0, bv = .12;
    for (var j = 0; j <= 40; j++) { var v2 = .12 + .3 * j / 40, r3 = .06 + .55 * Math.sqrt(v2 - .11); if ((r3 - rf) / v2 > best) { best = (r3 - rf) / v2; bv = v2; } }
    var br = .06 + .55 * Math.sqrt(bv - .11), sx = X(bv), sy = Y(br), mx = X(.12), myy = Y(.06 + .55 * Math.sqrt(.01)), R = 7 * Math.min(S, 1.8);
    if (cyc > 5.6) {
      var k = clamp((cyc - 5.6) / 1, 0, 1), cx = 0, cy = 0;
      c.beginPath(); for (j = 0; j <= 40 * k; j++) { v2 = .12 + .3 * j / 40; r3 = .06 + .55 * Math.sqrt(v2 - .11); cx = X(v2); cy = Y(r3); if (j) c.lineTo(cx, cy); else c.moveTo(cx, cy); }
      c.strokeStyle = INK; c.lineWidth = 2; c.lineJoin = "round"; c.stroke();
      if (k < 1) { c.fillStyle = INK; circle(c, cx, cy, 2.8 * S); c.fill(); }
    }
    if (cyc > 6.6) {
      var ks = eo((cyc - 6.6) / .5), kd = eo((cyc - 6.9) / .5), age = cyc - 7.1;
      if (big && kd > 0) { c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip(); c.globalAlpha = all * kd * .8; c.strokeStyle = OR; c.lineWidth = 1; dash(c, 4 * S); line(c, X(.1), Y(rf + best * .1), X(.44), Y(rf + best * .44)); dash(c, 0); c.restore(); c.globalAlpha = all; }
      if (age > 0 && age < 1.2) { c.globalAlpha = all * (1 - age / 1.2) * .8; c.strokeStyle = OR; c.lineWidth = 1.5; circle(c, sx, sy, R + eo(age / 1.2) * 16 * S); c.stroke(); c.globalAlpha = all; }
      if (ks > 0) { var Rs = R * ks; c.fillStyle = OR; c.strokeStyle = INK; c.lineWidth = 1.2; c.beginPath(); for (var a = 0; a < 10; a++) { var rad = a % 2 ? Rs * .45 : Rs, an = -Math.PI / 2 + a * Math.PI / 5; c.lineTo(sx + Math.cos(an) * rad, sy + Math.sin(an) * rad); } c.closePath(); c.fill(); c.stroke(); }
      if (kd > 0) { var Rd = R * kd; c.fillStyle = INK; c.beginPath(); c.moveTo(mx, myy - Rd * .8); c.lineTo(mx + Rd * .7, myy); c.lineTo(mx, myy + Rd * .8); c.lineTo(mx - Rd * .7, myy); c.closePath(); c.fill(); }
      if (big) { c.globalAlpha = all * ks; tag(c, "max Sharpe", sx + 12 * S, sy + 10 * S, 9 * S, OR); c.globalAlpha = all * kd; tag(c, "min variance", mx + 12 * S, myy + 12 * S, 9 * S, INK); c.globalAlpha = all; }
    }
    txt(c, "runs " + (m * 5).toLocaleString("en-US"), x0 + (big ? 6 * S : 0), pad, 9 * S, MUT);
    c.globalAlpha = 1;
    if (big) { txt(c, "risk", x1, y1 + 8 * S, 9 * S, MUT, "right"); txt(c, "return", x0 + 6 * S, y0 + 12 * S, 9 * S, MUT); }
  };

  /* 11. Generic bars: eight bars, three datasets, crossfading. The largest bar is orange. */
  var BR = null;
  D.bars = function (c, w, h, t, S) {
    S = Math.min(S, w / 300);
    if (!BR) { BR = []; for (var d = 0; d < 3; d++) { var r = rng(30 + d), a = []; for (var i = 0; i < 8; i++) a.push(.2 + r() * .8); BR.push(a); } }
    var big = S > 1.4 && w > 460, pad = 14 * S, x0 = pad + (big ? 10 * S : 0), x1 = w - pad, y0 = pad + 12 * S, y1 = h - pad - 10 * S, n = 8, bw = (x1 - x0) / n;
    var per = 3.2, pf = t / per, act = Math.floor(pf) % 3, prev = (act + 2) % 3, f = pf - Math.floor(pf), bl = ease(clamp(f * per / .9, 0, 1));
    c.strokeStyle = RULE; c.lineWidth = 1; for (var g = 0; g < 4; g++) { var gy = y0 + (y1 - y0) * g / 3; line(c, x0, gy, x1, gy); }
    c.strokeStyle = INK; c.lineWidth = 1.5; line(c, x0, y1, x1, y1);
    var vals = [], mx = -1, mi = 0;
    for (i = 0; i < n; i++) { vals[i] = lerp(BR[prev][i], BR[act][i], bl); if (vals[i] > mx) { mx = vals[i]; mi = i; } }
    for (i = 0; i < n; i++) {
      var bh = (y1 - y0) * vals[i], bx = x0 + i * bw + bw * .18, ww = bw * .64;
      if (i === mi) { c.fillStyle = OR; c.fillRect(bx, y1 - bh, ww, bh); } else { c.fillStyle = INK; c.fillRect(bx, y1 - bh, ww, bh); }
      txt(c, String.fromCharCode(65 + i), bx + ww / 2, y1 + 7 * S, 8.5 * S, MUT, "center");
    }
    txt(c, "set " + (act + 1) + " of 3", x1, pad, 9 * S, MUT, "right");
    if (big) txt(c, "largest in orange", x0, pad, 9 * S, MUT);
  };

  /* 12. Image: a screenshot shown cropped in the frame, with a slow pan. */
  var IMG = {};
  D.image = function (c, w, h, t, S, generic, it) {
    var src = it && it.image;
    if (!src) { D.generic(c, w, h, t, S); return; }
    var im = IMG[src];
    if (!im) { im = IMG[src] = new Image(); im.src = src; im.onload = function () { if (window.Viz) window.Viz.redraw(); }; }
    if (!im.complete || !im.naturalWidth) { c.strokeStyle = RULE; c.lineWidth = 1; c.strokeRect(10, 10, w - 20, h - 20); txt(c, "loading image", w / 2, h / 2, 9 * S, MUT, "center"); return; }
    var sc = Math.max(w / im.naturalWidth, h / im.naturalHeight) * 1.08, dw = im.naturalWidth * sc, dh = im.naturalHeight * sc;
    var k = .5 + .5 * Math.sin(t * .18), ox = -(dw - w) * k, oy = -(dh - h) * (.5 + .5 * Math.sin(t * .11 + 1));
    c.drawImage(im, ox, oy, dw, dh);
  };

  /* 13. Generic fallback: a rack map where slots fill and empty, in ink and orange. */
  D.generic = function (c, w, h, t, S) {
    S = Math.min(S, w / 300);
    var pad = 14 * S, cols = Math.max(6, Math.round((w - pad * 2) / (38 * S))), rows = Math.max(3, Math.round((h - pad * 2 - 14 * S) / (30 * S)));
    var cw = (w - pad * 2) / cols, ch = (h - pad * 2 - 14 * S) / rows, r = rng(41), seeds = [];
    for (var i = 0; i < cols * rows; i++) seeds.push(r());
    txt(c, "LOCATION MAP", pad, pad, 8.5 * S, MUT);
    c.strokeStyle = INK; c.lineWidth = 1.5; line(c, pad, pad + 10 * S, w - pad, pad + 10 * S);
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      var k = y * cols + x, sd = seeds[k], ph = (t * .18 + sd * 7) % 1, fill = sm(.1, .3, ph) * (1 - sm(.7, .9, ph));
      var X = pad + x * cw + 2 * S, Y = pad + 14 * S + y * ch + 2 * S, W = cw - 4 * S, H = ch - 4 * S;
      c.strokeStyle = RULE; c.lineWidth = 1; c.strokeRect(X, Y, W, H);
      if (fill > .02) { c.globalAlpha = fill; c.fillStyle = sd > .85 ? OR : INK; c.fillRect(X + 3 * S, Y + H - (H - 6 * S) * fill - 3 * S, W - 6 * S, (H - 6 * S) * fill); c.globalAlpha = 1; }
    }
  };

  /* ---------- background scenes ---------- */
  var SC = {};
  function conveyor(c, x0, x1, yT, yB, t, speed, col, lw, legs, carts, floorY) {
    c.strokeStyle = col; c.lineWidth = lw;
    line(c, x0, yT, x1, yT); line(c, x0, yB, x1, yB);
    var rr = (yB - yT) * .36, cy = (yT + yB) / 2, sp = rr * 2.6, ph = (t * speed) % sp;
    c.lineWidth = Math.max(1, lw * .6);
    for (var x = x0 - sp + ph; x < x1 + sp; x += sp) { if (x < x0 - rr || x > x1 + rr) continue; circle(c, x, cy, rr); c.stroke(); var an = t * speed / rr; line(c, x, cy, x + Math.cos(an) * rr * .75, cy + Math.sin(an) * rr * .75); }
    if (legs) { c.lineWidth = lw; for (x = x0 + 60; x < x1; x += 190) { line(c, x, yB, x, floorY); line(c, x - 12, floorY, x + 12, floorY); } }
    if (carts) carts.forEach(function (k) { var X = ((t * speed + k.o) % k.L) - 80; if (X > x1 + 80 || X + k.w < x0 - 80) return; carton(c, X, yT - k.h - 1, k.w, k.h, col, lw); });
  }
  function cartons(seed, L, minGap, maxGap, minW, maxW, minH, maxH) {
    var r = rng(seed), out = [], x = 0;
    while (x < L - maxGap) { var w = minW + r() * (maxW - minW); out.push({ o: x, w: w, h: minH + r() * (maxH - minH), L: L }); x += w + minGap + r() * (maxGap - minGap); }
    return out;
  }

  /* hero: racking elevation on the right (or below the copy on a phone), a hoist that lifts a carton from the top beam down to the conveyor */
  SC.hero = function (c, w, h, t, it) {
    var R = it.rect, col = WHITE, prevT = it.lastT, live = liveStep(it, t);
    if (!R || R.w < 120) R = { x: w * .55, y: 40, w: w * .4, h: h - 180 };
    var yT = h - 90, yB = h - 62, floorY = h - 36, v = 55;
    var bays = R.w > 400 ? 3 : 2, fw = 10, bayW = (R.w - fw) / bays, railY = R.y + 14, rackTop = R.y + 58, rackFloor = R.y + R.h - 6, levelH = (rackFloor - rackTop) / 3;
    var dropX = R.x > 140 ? R.x - 22 : R.x + R.w - 26, lw = 2;
    if (!it.carts) it.carts = cartons(3, Math.max(w + 400, 1500), 70, 220, 30, 54, 20, 30);
    if (!it.stock) {
      it.stock = []; var r = rng(17);
      for (var b = 0; b < bays; b++) for (var l = 0; l < 4; l++) { var st = [], n = 1 + Math.floor(r() * 3), x = 0; for (var k = 0; k < n; k++) { var cw = 26 + r() * 30; st.push({ x: x, w: cw, h: 16 + r() * (levelH * .5 - 14) }); x += cw + 4; } it.stock.push({ items: st, tot: x - 4 }); }
    }
    /* rail and trolley */
    var railX0 = Math.min(dropX, R.x) - 14, railX1 = Math.max(dropX, R.x + R.w) + 14;
    c.strokeStyle = col; c.lineWidth = lw; line(c, railX0, railY, railX1, railY); line(c, railX0, railY - 6, railX1, railY - 6);
    /* floor */
    c.lineWidth = 3; line(c, R.x - 30, rackFloor, R.x + R.w + 30, rackFloor);
    /* frames */
    for (b = 0; b <= bays; b++) {
      var fx = R.x + b * bayW; c.lineWidth = lw;
      line(c, fx, rackTop - 12, fx, rackFloor); line(c, fx + fw, rackTop - 12, fx + fw, rackFloor);
      c.lineWidth = 1; for (var y = rackTop; y < rackFloor - 8; y += 16) line(c, fx, y, fx + fw, y + 8);
      c.lineWidth = lw; line(c, fx - 6, rackFloor, fx + fw + 6, rackFloor);
    }
    /* beams and stock */
    var lift = it.lift || { slot: -1, k: 0 };
    for (l = 0; l < 4; l++) {
      var by = rackTop + l * levelH; /* beam y for level l (0 = top, 3 = the floor) */
      for (b = 0; b < bays; b++) {
        var bx = R.x + fw + b * bayW, bw = bayW - fw;
        if (l < 3) { c.lineWidth = 4; line(c, bx, by, bx + bw, by); }
        c.fillStyle = WHITE; c.fillRect(bx + 4, by + 2, 34, 11); txt(c, "A-0" + (b + 1) + "-" + (4 - l), bx + 21, by + 7.6, 7.5, INK, "center", MONO, 500);
        if (l === 0) continue; /* top beam: single cartons, drawn by the hoist logic */
        var s = it.stock[b * 4 + l], px = bx + (bw - s.tot) / 2, py = by - 8;
        c.lineWidth = lw; line(c, bx + 10, py, bx + bw - 10, py); for (k = 0; k < 3; k++) c.strokeRect(bx + 14 + k * (bw - 36) / 2, py, 8, 7);
        s.items.forEach(function (ci) { carton(c, px + ci.x, py - ci.h, ci.w, ci.h, col, lw); });
      }
    }
    /* the hoist: instances every P seconds, each takes the carton from top slot n mod bays */
    var P = 11, nNow = Math.floor(t / P), topY = rackTop, cW = 34, cH = 28, liftTop = railY + 22, trolleyX = dropX, cableTo = railY + 8, empty = {};
    var inst = [];
    for (var n = nNow - 2; n <= nNow; n++) {
      if (n < 0) continue;
      var u = t - n * P, slot = ((n % bays) + bays) % bays, sx = R.x + fw + slot * bayW + (bayW - fw) / 2, cx, cy;
      var palY = topY - 8, restY = palY - cH;
      if (u < 2.4 || (u >= 2.4 && u < 9)) empty[slot] = u < 2.4 ? 0 : 1; /* slot carton present until 2.4, absent until 9 */
      if (u >= 9) empty[slot] = 2 + eo((u - 9) / 1.4); /* restocking */
      if (u < 1.2) { trolleyX = lerp(dropX, sx, ease(u / 1.2)); cableTo = railY + 8; cx = sx; cy = restY; }
      else if (u < 2.4) { trolleyX = sx; cableTo = lerp(railY + 8, restY, ease((u - 1.2) / 1.2)); cx = sx; cy = restY; }
      else if (u < 3.6) { trolleyX = sx; cy = lerp(restY, liftTop, ease((u - 2.4) / 1.2)); cableTo = cy; cx = sx; }
      else if (u < 5.6) { trolleyX = lerp(sx, dropX, ease((u - 3.6) / 2)); cx = trolleyX; cy = liftTop; cableTo = cy; }
      else if (u < 7) { trolleyX = dropX; cx = dropX; cy = lerp(liftTop, yT - cH - 1, ease((u - 5.6) / 1.4)); cableTo = cy; }
      else { cx = dropX + v * (u - 7); cy = yT - cH - 1; if (u < 7.8) { cableTo = lerp(yT - cH - 1, railY + 8, ease((u - 7) / .8)); trolleyX = dropX; } }
      inst.push({ u: u, cx: cx, cy: cy });
    }
    /* sound cues for the current hoist, fired once when its phase time crosses a threshold (lastU < threshold <= u).
       The trolley motor runs while it travels, the winch while the cable moves, the latch grabs at 2.4, the carton lands at 7. */
    if (live) {
      var uN = t - nNow * P, uL = prevT - nNow * P, slotN = ((nNow % bays) + bays) % bays, sxN = R.x + fw + slotN * bayW + (bayW - fw) / 2, pD = panOf(dropX, w), pS = panOf(sxN, w);
      var cross = function (th) { return uL < th && th <= uN; };
      if (cross(0)) cue("motor", { pan: pD, panTo: pS, dur: 1.2 });
      if (cross(1.2)) cue("winch", { pan: pS, dur: 1.2, dir: "down" });
      if (cross(2.4)) { cue("latch", { pan: pS }); cue("winch", { pan: pS, dur: 1.2, dir: "up" }); }
      if (cross(3.6)) cue("motor", { pan: pS, panTo: pD, dur: 2 });
      if (cross(5.6)) cue("winch", { pan: pD, dur: 1.4, dir: "down" });
      if (cross(7)) { cue("thump", { pan: pD }); cue("winch", { pan: pD, dur: .8, dir: "up", gain: .6 }); }
    }
    /* pallets and resting cartons on the top beam */
    for (b = 0; b < bays; b++) {
      var tbx = R.x + fw + b * bayW, tbw = bayW - fw, tpy = topY - 8, tcx = tbx + tbw / 2;
      c.lineWidth = lw; line(c, tbx + 10, tpy, tbx + tbw - 10, tpy); for (k = 0; k < 3; k++) c.strokeRect(tbx + 14 + k * (tbw - 36) / 2, tpy, 8, 7);
      var e = empty[b];
      if (e === undefined || e === 0) carton(c, tcx - cW / 2, tpy - cH, cW, cH, col, lw);
      else if (e >= 2) { var a = Math.min(1, e - 2); c.globalAlpha = a; carton(c, tcx - cW / 2, tpy - cH - (1 - a) * 6, cW, cH, col, lw); c.globalAlpha = 1; }
    }
    /* trolley, cable, hook */
    c.lineWidth = lw; c.strokeRect(trolleyX - 14, railY - 14, 28, 12); circle(c, trolleyX - 8, railY - 3, 3); c.stroke(); circle(c, trolleyX + 8, railY - 3, 3); c.stroke();
    line(c, trolleyX, railY, trolleyX, cableTo); line(c, trolleyX - 6, cableTo, trolleyX + 6, cableTo);
    /* conveyor */
    conveyor(c, -10, w + 10, yT, yB, t, v, col, lw, true, it.carts, floorY);
    /* hoisted and riding cartons (drawn last, in front) */
    inst.forEach(function (q) { if (q.u >= 2.4 && q.cx < w + 60) carton(c, q.cx - cW / 2, q.cy, cW, cH, col, lw); });
  };

  /* floor: a faint location grid under the white sections, with a few cartons moving node to node */
  SC.floor = function (c, w, h, t, it) {
    var G = 64;
    if (!it.grid || it.grid.w !== w || it.grid.h !== h) {
      var g = document.createElement("canvas"), dpr = it.dpr; g.width = Math.round(w * dpr); g.height = Math.round(h * dpr); var gc = g.getContext("2d"); gc.setTransform(dpr, 0, 0, dpr, 0, 0);
      gc.strokeStyle = alpha(INK, .055); gc.lineWidth = 1;
      for (var x = .5; x < w; x += G) { gc.beginPath(); gc.moveTo(x, 0); gc.lineTo(x, h); gc.stroke(); }
      for (var y = .5; y < h; y += G) { gc.beginPath(); gc.moveTo(0, y); gc.lineTo(w, y); gc.stroke(); }
      gc.strokeStyle = alpha(INK, .11); gc.lineWidth = 1.5;
      for (x = .5; x < w; x += G * 4) { gc.beginPath(); gc.moveTo(x, 0); gc.lineTo(x, h); gc.stroke(); }
      for (y = .5; y < h; y += G * 4) { gc.beginPath(); gc.moveTo(0, y); gc.lineTo(w, y); gc.stroke(); }
      it.grid = { w: w, h: h, cv: g };
      var r = rng(23), want = Math.max(4, Math.min(8, Math.round(w * h / (G * G * 48)))), ms = [];
      for (var i = 0; i < want; i++) ms.push({ nx: Math.floor(r() * (w / G)), ny: Math.floor(r() * (h / G)), dx: 1, dy: 0, p: r(), v: .25 + r() * .25, s: 9 + r() * 4, or: r() < .3, dwell: r() * 2, r: r });
      it.movers = ms;
    }
    c.drawImage(it.grid.cv, 0, 0, w, h);
    var dt = Math.min(.05, t - (it.last == null ? t : it.last)); it.last = t;
    var live = liveStep(it, t);
    it.movers.forEach(function (m) {
      var wasDwell = m.dwell > 0;
      if (m.dwell > 0) m.dwell -= dt; else m.p += m.v * dt;
      if (live && wasDwell && m.dwell <= 0) cue("caster", { pan: panOf(m.nx * G, w) }); /* a carton starts to roll */
      if (m.p >= 1) {
        m.p = 0; m.nx += m.dx; m.ny += m.dy;
        if (m.r() < .35) { var d = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(m.r() * 4)]; m.dx = d[0]; m.dy = d[1]; m.dwell = .6 + m.r() * 1.8; } else m.dwell = m.r() < .5 ? 0 : .3 + m.r() * .8;
        if (m.nx < -1) m.nx = Math.ceil(w / G); if (m.nx > w / G + 1) m.nx = -1; if (m.ny < -1) m.ny = Math.ceil(h / G); if (m.ny > h / G + 1) m.ny = -1;
        if (live && m.dwell > 0) cue("settle", { pan: panOf(m.nx * G, w) }); /* set down at its node */
      }
      var k = ease(m.p), x = (m.nx + m.dx * k) * G, y = (m.ny + m.dy * k) * G, s = m.s;
      c.globalAlpha = .34;
      if (m.or) { c.fillStyle = OR; c.fillRect(x - s / 2, y - s / 2, s, s); c.strokeStyle = INK; c.lineWidth = 1; c.strokeRect(x - s / 2, y - s / 2, s, s); }
      else { c.strokeStyle = INK; c.lineWidth = 1; c.strokeRect(x - s / 2, y - s / 2, s, s); line(c, x - s / 2, y - s / 2 + s * .35, x + s / 2, y - s / 2 + s * .35); }
      c.globalAlpha = 1;
    });
  };

  /* belt: a slim conveyor in the footer */
  SC.belt = function (c, w, h, t, it) {
    if (!it.carts) it.carts = cartons(5, Math.max(w + 300, 1200), 90, 260, 24, 40, 14, 18);
    conveyor(c, -10, w + 10, h - 26, h - 8, t, 40, WHITE, 1.5, false, it.carts, 0);
  };

  /* ---------- runner: one rAF loop for every canvas on screen ---------- */
  var items = [], start = performance.now(), running = false, STILL = 7.3, paused = 0, pausedAt = 0;
  function isStill() { return reduce || document.hidden || (window.Site && window.Site.isStill && window.Site.isStill()) || document.documentElement.classList.contains("still"); }
  function setup(cv) {
    var r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2), scene = cv.getAttribute("data-scene");
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    var it = { cv: cv, c: cv.getContext("2d"), w: r.width, h: r.height, dpr: dpr, on: scene === "floor", scene: scene, fn: scene ? SC[scene] : (D[cv.getAttribute("data-viz")] || D.generic), image: cv.getAttribute("data-image") || "" };
    if (scene === "hero") { var box = cv.parentElement.querySelector(".rackbox"); if (box) { var b = box.getBoundingClientRect(); it.rect = { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height }; } }
    return it;
  }
  function draw(it, t, live) {
    if (!it.fn || it.w < 2) return;
    it.live = !!live; /* only a frame of the running loop may fire sound cues */
    var c = it.c; c.setTransform(it.dpr, 0, 0, it.dpr, 0, 0); c.clearRect(0, 0, it.w, it.h);
    c.globalAlpha = 1; c.setLineDash([]); c.lineDashOffset = 0; c.lineCap = "butt"; c.lineJoin = "miter";
    var S = Math.min(it.h / 150, 2.3);
    try { if (it.scene) it.fn(c, it.w, it.h, t, it); else it.fn(c, it.w, it.h, t, S, false, it); } catch (e) { /* a sketch must never break the page */ }
  }
  function now() { return (performance.now() - start) / 1000 - paused; }
  function loop() {
    if (isStill()) { running = false; return; }
    var any = false, t = now();
    for (var i = 0; i < items.length; i++) if (items[i].on) { any = true; draw(items[i], t, true); }
    if (any) requestAnimationFrame(loop); else running = false;
  }
  function wake() { if (!running && !isStill()) { running = true; requestAnimationFrame(loop); } }
  function stills() { var t = Math.max(STILL, now()); items.forEach(function (it) { draw(it, t, false); }); }
  function resetAll() { items.forEach(function (it, i) { var on = it.on; items[i] = setup(it.cv); items[i].on = on; }); if (isStill()) stills(); else wake(); }
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { for (var i = 0; i < items.length; i++) if (items[i].cv === e.target) items[i].on = e.isIntersecting || items[i].scene === "floor"; });
    wake();
  }, { rootMargin: "40px 0px" }) : null;
  function scan() {
    var cvs = [].slice.call(document.querySelectorAll("canvas[data-viz],canvas[data-scene]"));
    items = items.filter(function (it) { return cvs.indexOf(it.cv) >= 0 && document.contains(it.cv); });
    cvs.forEach(function (cv) {
      for (var i = 0; i < items.length; i++) if (items[i].cv === cv) { if (Math.abs(items[i].w - cv.getBoundingClientRect().width) > 1) { var on = items[i].on; items[i] = setup(cv); items[i].on = on; } return; }
      var it = setup(cv); items.push(it);
      if (io) io.observe(cv); else it.on = true;
    });
    if (isStill()) stills(); else wake();
  }
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(resetAll, 150); });
  window.addEventListener("motionchange", function () {
    if (isStill()) { if (!pausedAt) pausedAt = performance.now(); running = false; stills(); }
    else { if (pausedAt) { paused += (performance.now() - pausedAt) / 1000; pausedAt = 0; } wake(); }
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { MW = {}; if (isStill()) stills(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
  window.Viz = { draw: D, scenes: SC, scan: scan, redraw: function () { if (isStill()) stills(); else wake(); } };
})();
