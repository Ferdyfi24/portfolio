/* Sound for the site, synthesised with the Web Audio API. No audio files, no libraries.
   Everything is gated by the SOUND switch: default OFF, remembered in localStorage, and nothing is created or
   played while it is off. The AudioContext is created lazily on the visitor's first click, tap or key press while the
   switch is on, because browsers refuse to start audio before a gesture. Until then Sound.isLocked() is true and the
   switch lamp blinks (site.js).

   UI sounds (window.Sound), on click:
     beep()     barcode scanner: one clean beep near 2.7 kHz, about 80 ms. Project cards and primary buttons.
     stamp()    rubber stamp: a paper slide (band-passed noise sweep) then a low thud. Plays when a project document
                appears, and on arrival after an internal link (carried in sessionStorage).
     clack()    the mechanical click of the MOTION and SOUND switches.
     beeper()   forklift reverse beeper: three short, softened square beeps near 1 kHz, on a rack filter change.
   Ambient beds, looping while SOUND is on, MOTION is on, the tab is visible and the scene is on screen (site.js decides):
     ambient("hero", on)   the hero conveyor: roller rattle with most of its energy between 300 Hz and 3 kHz so that
                           laptop and phone speakers can play it (the old 140 Hz hum could not be heard on them).
     ambient("belt", on)   the footer belt: the same bed, quieter and duller.
   Cues, short sounds that the canvas scenes in viz.js ask for with cue(name, {pan, panTo, gain, dur, dir}):
     motor      trolley motor whir while the hoist trolley travels along its rail (sustained, pan follows it)
     winch      winch whine while the cable lowers or lifts (sustained; dir "up" or "down")
     latch      the hook grabbing a carton
     thump      a carton landing on the conveyor
     caster     a floor carton starting to roll (floor grid)
     settle     a floor carton set down at its node
     tap        hover: a soft cardboard tap on a project card, certificate tag or the featured card (site.js)
     tick       hover: a tiny tick on buttons, chips and nav links (site.js)
   Floor cues are throttled to one per 1.2 s and stay silent while the hero is on screen. Hover cues are throttled to
   one per 50 ms. Each cue is panned by its x position with a StereoPannerNode where the browser has one.
   Every sound is one function (context, destination, startTime, options) so render(name) can play it into an
   OfflineAudioContext and report the peak level. Master gain is low; nothing here is loud. */
(function () {
  var S = window.Sound = {};
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, on = false, pendingStamp = false;
  var amb = { hero: false, belt: false }, beds = {}, active = [];
  var LEVEL = { hero: .32, belt: .14 };

  function readPref() { try { return localStorage.getItem("sound") === "on"; } catch (e) { return false; } }
  function savePref(v) { try { localStorage.setItem("sound", v ? "on" : "off"); } catch (e) { } }
  function fire(name) { try { window.dispatchEvent(new Event(name)); } catch (e) { } }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---- building blocks ---- */
  function noise(c, secs, lowpass) {
    /* white noise, optionally run through a one-pole low-pass while it is generated (cheap brown-ish noise) */
    var n = Math.max(1, Math.floor(c.sampleRate * secs)), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0), y = 0, k = lowpass ? Math.exp(-2 * Math.PI * lowpass / c.sampleRate) : 0;
    for (var i = 0; i < n; i++) { var w = Math.random() * 2 - 1; if (lowpass) { y = k * y + (1 - k) * w; d[i] = y * 3.2; } else d[i] = w; }
    return buf;
  }
  function env(c, g, t, a, peak, hold, rel) {
    /* linear attack to peak, hold, then exponential release to silence */
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }
  function tone(c, dest, t, type, f0, f1, dur, a, peak, filterHz) {
    var o = c.createOscillator(), g = c.createGain(), out = g;
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(c, g, t, a, peak, Math.max(0, dur * .35 - a), Math.max(.01, dur * .65));
    if (filterHz) { var fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = filterHz; fl.Q.value = .7; g.connect(fl); out = fl; }
    o.connect(g); out.connect(dest); o.start(t); o.stop(t + dur + .05);
  }
  function burst(c, dest, t, dur, peak, type, f0, f1, q) {
    var src = c.createBufferSource(), g = c.createGain(), fl = c.createBiquadFilter();
    src.buffer = noise(c, dur + .05); fl.type = type; fl.frequency.setValueAtTime(f0, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur); fl.Q.value = q || .8;
    env(c, g, t, .004, peak, dur * .2, dur * .8);
    src.connect(fl); fl.connect(g); g.connect(dest); src.start(t); src.stop(t + dur + .1);
  }
  /* a sustained noise band with its own attack and release, amplitude-modulated when lfoHz is given; returns the gain node */
  function band(c, dest, t, dur, peak, f, q, a, rel, lfoHz, lfoDepth) {
    var src = c.createBufferSource(), g = c.createGain(), fl = c.createBiquadFilter();
    src.buffer = noise(c, dur + rel + .1); fl.type = "bandpass"; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + Math.max(a, dur - rel)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + .02);
    src.connect(fl);
    if (lfoHz) {
      var m = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      m.gain.value = 1 - lfoDepth; lfo.type = "sine"; lfo.frequency.value = lfoHz; lg.gain.value = lfoDepth; lfo.connect(lg); lg.connect(m.gain); lfo.start(t); lfo.stop(t + dur + rel + .1);
      fl.connect(m); m.connect(g);
    } else fl.connect(g);
    g.connect(dest); src.start(t); src.stop(t + dur + rel + .1);
    return g;
  }

  /* the conveyor bed: a seamless loop of roller rumble (300 Hz to 1.8 kHz band, slowly rattling) with a roller tick
     every 0.47 s, the time a carton takes to cross one roller in the hero scene, and a lighter tick in between */
  function beltBuffer(c) {
    if (c.__belt) return c.__belt;
    var sr = c.sampleRate, per = .47, secs = per * 6, n = Math.round(sr * secs), ov = Math.round(sr * .06), N = n + ov;
    var rum = new Float32Array(N), tk = new Float32Array(N), i, j;
    var k1 = Math.exp(-2 * Math.PI * 1800 / sr), k2 = Math.exp(-2 * Math.PI * 300 / sr), y1 = 0, y2 = 0, sq = 0;
    for (i = 0; i < N; i++) {
      var w = Math.random() * 2 - 1, tt = i / sr; y1 = k1 * y1 + (1 - k1) * w; y2 = k2 * y2 + (1 - k2) * w;
      rum[i] = (y1 - y2) * (1 + .3 * Math.sin(6.2832 * 11.3 * tt) + .15 * Math.sin(6.2832 * 4.1 * tt)); sq += rum[i] * rum[i];
    }
    var rms = Math.sqrt(sq / N) || 1; for (i = 0; i < N; i++) rum[i] *= .11 / rms;
    var w0 = 2 * Math.PI * 1500 / sr, R = .982, a1 = 2 * R * Math.cos(w0), a2 = -R * R, kl = Math.exp(-2 * Math.PI * 600 / sr), len = Math.round(sr * .02), mx = 0;
    for (var q = 0; q < 12; q++) {
      var p = Math.round(q * per / 2 * sr), amp = (q % 2 === 0 ? 1 : .45) * (.8 + .4 * Math.random()), z1 = 0, z2 = 0, yl = 0;
      for (j = 0; j < len && p + j < N; j++) {
        var x = (Math.random() * 2 - 1) * Math.exp(-j / (sr * .0035)), yr = x + a1 * z1 + a2 * z2; z2 = z1; z1 = yr; yl = kl * yl + (1 - kl) * x;
        tk[p + j] += amp * (yr * .12 + (x - yl) * Math.exp(-j / (sr * .0012)) * 1.2);
      }
    }
    for (i = 0; i < N; i++) if (Math.abs(tk[i]) > mx) mx = Math.abs(tk[i]);
    if (mx > 0) for (i = 0; i < N; i++) tk[i] *= .4 / mx;
    var buf = c.createBuffer(1, n, sr), d = buf.getChannelData(0);
    for (i = 0; i < n; i++) { var v = rum[i] + tk[i]; if (i < ov) { var f = i / ov; v = v * f + (rum[n + i] + tk[n + i]) * (1 - f); } d[i] = clamp(v, -.5, .5); }
    c.__belt = buf; return buf;
  }
  function bed(c, d, t, name, o) {
    var src = c.createBufferSource(), g = c.createGain(), out = g; src.buffer = beltBuffer(c); src.loop = true;
    var hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 220; hp.Q.value = .5; src.connect(hp);
    if (name === "belt") { var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1600; lp.Q.value = .5; hp.connect(lp); lp.connect(g); } else hp.connect(g);
    g.gain.value = o && o.fade ? 0 : LEVEL[name]; out.connect(d); src.start(t);
    return { src: src, g: g };
  }

  /* ---- the sounds: (context, destination, startTime, options) -> length in seconds ---- */
  var SND = {};
  SND.beep = function (c, d, t) { tone(c, d, t, "sine", 2700, 2700, .08, .004, .42); return .15; };
  SND.clack = function (c, d, t) {
    burst(c, d, t, .012, .5, "highpass", 1800, 0, .5);          /* the contact */
    tone(c, d, t, "sine", 340, 180, .05, .002, .18);             /* the body of the switch */
    burst(c, d, t + .045, .01, .22, "highpass", 2400, 0, .5);   /* the settle */
    return .15;
  };
  SND.stamp = function (c, d, t) {
    burst(c, d, t, .22, .16, "bandpass", 1400, 420, 1.2);        /* paper slides into place */
    burst(c, d, t + .2, .1, .5, "lowpass", 200, 90, .7);         /* the thud */
    tone(c, d, t + .2, "sine", 76, 42, .17, .003, .45);          /* low body */
    burst(c, d, t + .205, .02, .18, "highpass", 2500, 0, .5);    /* the handle's click */
    return .5;
  };
  SND.beeper = function (c, d, t) {
    for (var i = 0; i < 3; i++) tone(c, d, t + i * .21, "square", 980, 980, .09, .006, .11, 2400);
    return .75;
  };
  /* beds, rendered as 2 s for the level check; live playback loops them through ambient() */
  SND.bedHero = function (c, d, t) { var b = bed(c, d, t, "hero"); b.src.stop(t + 2); return 2; };
  SND.bedBelt = function (c, d, t) { var b = bed(c, d, t, "belt"); b.src.stop(t + 2); return 2; };
  /* trolley motor: a low sawtooth heard through its harmonics around 650 Hz, with a chattering noise band on top */
  SND.motor = function (c, d, t, o) {
    var dur = (o && o.dur) || 1.2, osc = c.createOscillator(), g = c.createGain(), bp = c.createBiquadFilter();
    osc.type = "sawtooth"; osc.frequency.setValueAtTime(82, t); osc.frequency.linearRampToValueAtTime(94, t + Math.min(.5, dur * .4)); osc.frequency.setValueAtTime(94, t + dur - .2); osc.frequency.linearRampToValueAtTime(70, t + dur + .15);
    bp.type = "bandpass"; bp.frequency.value = 650; bp.Q.value = 1.1;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(.22, t + .14); g.gain.setValueAtTime(.22, t + Math.max(.14, dur - .22)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + .02);
    osc.connect(bp); bp.connect(g); g.connect(d); osc.start(t); osc.stop(t + dur + .2);
    var nb = band(c, d, t, dur, .09, 1400, 1, .14, .22, 27, .5);
    if (o && o.live) o.live.push(g, nb);
    return dur + .25;
  };
  /* winch whine: a triangle wave near 1.2 kHz with a slow vibrato, rising while it lifts and sinking while it lowers */
  SND.winch = function (c, d, t, o) {
    var dur = (o && o.dur) || 1.2, up = o && o.dir === "up", f0 = up ? 1150 : 1320, f1 = up ? 1320 : 1180;
    var osc = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter(), lfo = c.createOscillator(), lg = c.createGain();
    osc.type = "triangle"; osc.frequency.setValueAtTime(f0, t); osc.frequency.linearRampToValueAtTime(f1, t + dur);
    lfo.type = "sine"; lfo.frequency.value = 6.5; lg.gain.value = 14; lfo.connect(lg); lg.connect(osc.frequency);
    lp.type = "lowpass"; lp.frequency.value = 3500; lp.Q.value = .6;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(.07, t + .1); g.gain.setValueAtTime(.07, t + Math.max(.1, dur - .2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + .02);
    osc.connect(lp); lp.connect(g); g.connect(d); osc.start(t); osc.stop(t + dur + .1); lfo.start(t); lfo.stop(t + dur + .1);
    var drum = c.createOscillator(), dg = c.createGain(), dl = c.createBiquadFilter();
    drum.type = "sawtooth"; drum.frequency.value = up ? 300 : 280; dl.type = "lowpass"; dl.frequency.value = 1200; dl.Q.value = .5;
    dg.gain.setValueAtTime(0.0001, t); dg.gain.linearRampToValueAtTime(.035, t + .12); dg.gain.setValueAtTime(.035, t + Math.max(.12, dur - .2)); dg.gain.exponentialRampToValueAtTime(0.0001, t + dur + .02);
    drum.connect(dl); dl.connect(dg); dg.connect(d); drum.start(t); drum.stop(t + dur + .1);
    if (o && o.live) o.live.push(g, dg);
    return dur + .15;
  };
  /* latch: the hook closes on a carton, a metal click with a short ring and a low body */
  SND.latch = function (c, d, t) {
    burst(c, d, t, .006, .16, "highpass", 1800, 0, .5);
    tone(c, d, t, "square", 2100, 1900, .02, .001, .045, 4000);
    tone(c, d, t, "sine", 170, 110, .06, .002, .12);
    burst(c, d, t + .035, .03, .09, "bandpass", 2600, 0, 3);
    return .15;
  };
  /* thump: a carton lands on the conveyor, cardboard first then the low body */
  SND.thump = function (c, d, t) {
    burst(c, d, t, .035, .11, "bandpass", 1100, 0, 1.2);         /* the cardboard face */
    burst(c, d, t, .11, .25, "lowpass", 420, 140, .7);           /* the body */
    tone(c, d, t, "sine", 110, 58, .12, .003, .2);
    burst(c, d, t + .05, .02, .05, "bandpass", 2400, 0, 1);      /* a flap settles */
    return .3;
  };
  /* caster: a floor carton starts to roll, a soft swelling band with wheel chatter */
  SND.caster = function (c, d, t) {
    band(c, d, t, .32, .14, 850, .9, .1, .12, 19, .45);
    band(c, d, t, .32, .1, 320, .7, .12, .1);
    return .5;
  };
  /* settle: the same carton set down at its node */
  SND.settle = function (c, d, t) {
    burst(c, d, t, .025, .12, "lowpass", 1400, 500, .7);
    tone(c, d, t, "sine", 240, 170, .04, .002, .09);
    return .1;
  };
  /* tap: hover on a card or tag, a knuckle on cardboard */
  SND.tap = function (c, d, t) {
    burst(c, d, t, .035, .2, "bandpass", 700, 0, 1);
    tone(c, d, t, "sine", 200, 140, .05, .002, .13);
    return .12;
  };
  /* scan: hover on a card or tag, the same scanner as the click beep but short and soft, like aiming it before the scan */
  SND.scan = function (c, d, t) { tone(c, d, t, "sine", 2700, 2700, .045, .003, .15); return .1; };
  /* tick: hover on a button, chip or link */
  SND.tick = function (c, d, t) {
    burst(c, d, t, .005, .12, "highpass", 3200, 0, .5);
    tone(c, d, t, "sine", 2300, 2300, .01, .001, .05);
    return .05;
  };

  /* ---- live playback ---- */
  function running() { return !!(ctx && ctx.state === "running"); }
  function ensure() {
    if (ctx || !AC) return ctx;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = .35; master.connect(ctx.destination);
    ctx.onstatechange = function () { fire("soundchange"); applyAmbient(); };
    return ctx;
  }
  function resume() { if (ctx && ctx.state !== "running") { try { var p = ctx.resume(); if (p && p.catch) p.catch(function () { }); } catch (e) { } } }
  function play(name, o) {
    if (!on || !ctx || !SND[name]) return false;
    resume();
    if (!running()) return false;
    o = o || {};
    var t = ctx.currentTime + .005, dest = master, tail = [];
    try {
      if (o.pan != null && ctx.createStereoPanner) {
        var p = ctx.createStereoPanner(); p.pan.setValueAtTime(clamp(+o.pan || 0, -1, 1), t);
        if (o.panTo != null) p.pan.linearRampToValueAtTime(clamp(+o.panTo || 0, -1, 1), t + (o.dur || .5));
        p.connect(dest); dest = p; tail.push(p);
      }
      if (o.gain != null && o.gain !== 1) { var g = ctx.createGain(); g.gain.value = clamp(+o.gain || 0, 0, 1); g.connect(dest); dest = g; tail.push(g); }
      o.live = [];
      var len = SND[name](ctx, dest, t, o) || .5;
      o.live.forEach(function (n) { active.push({ g: n, until: t + len }); });
      if (tail.length) setTimeout(function () { tail.forEach(function (n) { try { n.disconnect(); } catch (e) { } }); }, (len + .6) * 1000);
    } catch (e) { return false; }
    return true;
  }
  S.beep = function () { return play("beep"); };
  S.clack = function () { return play("clack"); };
  S.beeper = function () { return play("beeper"); };
  /* one stamp per arrival: the carried stamp and the document's own stamp may both ask within a second */
  var lastStamp = -9;
  function stampOnce() {
    var t = performance.now() / 1000;
    if (t - lastStamp < 1.5) return true;
    if (!play("stamp")) return false;
    lastStamp = t; return true;
  }
  S.stamp = function () { if (!on) return false; if (!stampOnce()) { pendingStamp = true; return false; } return true; };

  /* cues from the scenes and from hover; sound.js decides whether they play */
  var CAT = { caster: "floor", settle: "floor", tap: "hover", scan: "hover", tick: "hover" }, GAP = { floor: 1.2, hover: .05, hero: .06 }, lastCat = {};
  S.cue = function (name, o) {
    if (!on || !ctx || !SND[name] || !running()) return false;
    var cat = CAT[name] || "hero", key = cat === "hero" ? name : cat; /* hero cues may overlap each other, so they throttle per name */
    if (cat === "floor" && amb.hero) return false; /* the hero conveyor is the sound while it is on screen; the floor keeps quiet */
    var now = ctx.currentTime;
    if (now - (lastCat[key] == null ? -9 : lastCat[key]) < GAP[cat]) return false;
    if (!play(name, o)) return false;
    lastCat[key] = now; return true;
  };
  /* stop every sustained cue (motion switched off, tab hidden, sound switched off) */
  S.stopCues = function () {
    if (!ctx) { active = []; return; }
    var now = ctx.currentTime;
    active.forEach(function (a) { if (a.until > now) { try { a.g.gain.cancelScheduledValues(now); a.g.gain.setTargetAtTime(0.0001, now, .04); } catch (e) { } } });
    active = [];
  };

  /* ambient beds: site.js says which scene is on screen; the bed runs only while sound is on, the tab is visible and the context runs */
  function applyAmbient() {
    if (!ctx) return;
    Object.keys(amb).forEach(function (name) {
      var want = on && amb[name] && !document.hidden && running(), b = beds[name], now = ctx.currentTime;
      if (want && !b) {
        try { b = beds[name] = bed(ctx, master, now, name, { fade: true }); b.g.gain.setTargetAtTime(LEVEL[name], now, .25); } catch (e) { }
      } else if (!want && b) {
        beds[name] = null;
        b.g.gain.cancelScheduledValues(now); b.g.gain.setTargetAtTime(0, now, .13);
        setTimeout(function () { try { b.src.stop(); b.src.disconnect(); b.g.disconnect(); } catch (e) { } }, 700);
      }
    });
  }
  S.ambient = function (name, want) { if (!(name in amb)) return; amb[name] = !!want; applyAmbient(); };
  S.hum = function (want) { S.ambient("hero", want); }; /* older name, kept */
  S.bedsRunning = function () { return Object.keys(beds).filter(function (k) { return !!beds[k]; }); };
  S.isOn = function () { return on; };
  S.hasContext = function () { return !!ctx; };
  /* true while the switch is on but the browser has not let audio start yet: the next click, tap or key starts it */
  S.isLocked = function () { return on && !running(); };
  /* set(v, gesture): gesture is true when called from a click or key press; that is the only time the context is created */
  S.set = function (v, gesture) {
    var was = on; on = !!v; savePref(on);
    if (on) { if (gesture) { ensure(); resume(); } if (!was && gesture) S.clack(); }
    else { S.stopCues(); applyAmbient(); }
    fire("soundchange");
    if (on) applyAmbient();
  };
  /* any gesture while ON: make sure the context exists and is running, then play what was waiting */
  function onGesture() {
    if (!on) return;
    ensure(); resume();
    if (ctx && pendingStamp) { pendingStamp = false; setTimeout(function () { stampOnce(); }, 40); }
    applyAmbient();
  }
  ["pointerdown", "keydown", "touchend"].forEach(function (ev) { document.addEventListener(ev, onGesture, { capture: true, passive: true }); });

  /* stamp carried across an internal navigation: the leaving page sets the flag, the arriving page plays it once */
  S.carryStamp = function () { if (!on) return; try { sessionStorage.setItem("stamp", "1"); } catch (e) { } };
  function arrival() {
    var flag = false; try { flag = sessionStorage.getItem("stamp") === "1"; sessionStorage.removeItem("stamp"); } catch (e) { }
    if (!flag || !on) return;
    /* the visitor clicked on this site a moment ago, so a context may start; if it does not, the next gesture plays it */
    ensure();
    if (ctx) { resume(); if (!stampOnce()) pendingStamp = true; }
  }
  on = readPref();
  if (on) arrival();

  /* page lifecycle: stop the beds and cues when the tab hides or the page is put away; restore when it comes back */
  document.addEventListener("visibilitychange", function () { if (document.hidden) S.stopCues(); applyAmbient(); });
  window.addEventListener("pagehide", function () { S.stopCues(); Object.keys(amb).forEach(function (k) { amb[k] = false; }); applyAmbient(); if (ctx && ctx.state === "running") { try { ctx.suspend(); } catch (e) { } } });
  window.addEventListener("pageshow", function (e) { on = readPref(); if (e.persisted) { fire("soundchange"); if (on) { resume(); applyAmbient(); } } });

  /* offline check used by the test harness: render one sound and return its peak and RMS in dBFS, after the master gain.
     Stereo, so that a panned cue is measured the way it plays. */
  S.names = function () { return Object.keys(SND); };
  S.render = function (name, o) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC || !SND[name]) return Promise.reject(new Error("no " + name));
    var c = new OAC(2, 44100 * 2.5, 44100), m = c.createGain(); m.gain.value = .35; m.connect(c.destination);
    o = o || {}; o.live = [];
    SND[name](c, m, .05, o);
    return c.startRendering().then(function (buf) {
      var mx = 0, sq = 0, n = 0;
      for (var ch = 0; ch < buf.numberOfChannels; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < d.length; i++) { var a = Math.abs(d[i]); if (a > mx) mx = a; if (a > 1e-4) { sq += d[i] * d[i]; n++; } } }
      var rms = n ? Math.sqrt(sq / n) : 0;
      return { peak: mx, dbfs: 20 * Math.log10(mx || 1e-9), rmsDbfs: 20 * Math.log10(rms || 1e-9) };
    });
  };
})();
