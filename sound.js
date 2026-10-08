/* UI sound for the site, synthesised with the Web Audio API. No audio files, no libraries.
   Everything is gated by the SOUND switch: default OFF, remembered in localStorage, and nothing is created or
   played while it is off. The AudioContext is created lazily on the first switch-on, which is a user gesture.
   Sounds (window.Sound):
     beep()     barcode scanner: one clean beep near 2.7 kHz, about 80 ms. Project cards and primary buttons on click.
     stamp()    rubber stamp: a paper slide (band-passed noise sweep) then a low thud (filtered noise burst plus a low sine).
                Plays when a project document appears, and on arrival after an internal link (carried in sessionStorage).
     clack()    the mechanical click of the MOTION and SOUND switches.
     beeper()   forklift reverse beeper: three short, softened square beeps near 1 kHz, on a rack filter change.
     hum(on)    conveyor hum: very quiet low noise with a gentle roller tick, faded over 400 ms. Only while SOUND is on,
                MOTION is on, the hero conveyor is on screen and the tab is visible; site.js decides and calls hum().
   Every sound is built by one function that takes a context and a destination, so render(name) can play it into an
   OfflineAudioContext and report the peak level. Master gain is low; nothing here is loud. */
(function () {
  var S = window.Sound = {};
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null, master = null, on = false, humGain = null, humSrc = null, humWant = false, pendingStamp = false;

  function readPref() { try { return localStorage.getItem("sound") === "on"; } catch (e) { return false; } }
  function savePref(v) { try { localStorage.setItem("sound", v ? "on" : "off"); } catch (e) { } }
  function fire(name) { try { window.dispatchEvent(new Event(name)); } catch (e) { } }

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

  /* ---- the sounds: (context, destination, startTime) -> length in seconds ---- */
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
  /* the hum is a looping 2-second buffer: low filtered noise with a small roller tick four times a second */
  function humBuffer(c) {
    var secs = 2, n = c.sampleRate * secs, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0), y = 0, k = Math.exp(-2 * Math.PI * 140 / c.sampleRate);
    for (var i = 0; i < n; i++) { y = k * y + (1 - k) * (Math.random() * 2 - 1); d[i] = y * 4; }
    var per = Math.floor(c.sampleRate * .25), tick = Math.floor(c.sampleRate * .012), yt = 0, kt = Math.exp(-2 * Math.PI * 900 / c.sampleRate);
    for (var p = 0; p < n; p += per) for (var j = 0; j < tick && p + j < n; j++) { yt = kt * yt + (1 - kt) * (Math.random() * 2 - 1); d[p + j] += yt * 1.6 * (1 - j / tick); }
    /* normalise so the loop peaks at 0.5 before the hum gain */
    var mx = 0; for (i = 0; i < n; i++) if (Math.abs(d[i]) > mx) mx = Math.abs(d[i]);
    if (mx > 0) for (i = 0; i < n; i++) d[i] = d[i] / mx * .5;
    return buf;
  }
  SND.hum = function (c, d, t) {
    var src = c.createBufferSource(), g = c.createGain(); src.buffer = humBuffer(c); src.loop = true; g.gain.value = .22;
    src.connect(g); g.connect(d); src.start(t); src.stop(t + 1.5); return 1.5;
  };

  /* ---- live playback ---- */
  function ensure() {
    if (ctx || !AC) return ctx;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = .35; master.connect(ctx.destination);
    return ctx;
  }
  function resume() { if (ctx && ctx.state !== "running") { try { var p = ctx.resume(); if (p && p.catch) p.catch(function () { }); } catch (e) { } } }
  function play(name) {
    if (!on || !ctx || !SND[name]) return false;
    resume();
    if (ctx.state !== "running") return false;
    try { SND[name](ctx, master, ctx.currentTime + .005); } catch (e) { }
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
  S.hum = function (want) {
    humWant = !!want;
    if (!on || !ctx) return;
    resume();
    if (humWant && ctx.state === "running") {
      if (!humSrc) {
        humGain = ctx.createGain(); humGain.gain.value = 0; humGain.connect(master);
        humSrc = ctx.createBufferSource(); humSrc.buffer = humBuffer(ctx); humSrc.loop = true; humSrc.connect(humGain); humSrc.start();
      }
      humGain.gain.cancelScheduledValues(ctx.currentTime); humGain.gain.setTargetAtTime(.22, ctx.currentTime, .13);
    } else if (humSrc) {
      var g = humGain, s = humSrc; humSrc = null; humGain = null;
      g.gain.cancelScheduledValues(ctx.currentTime); g.gain.setTargetAtTime(0, ctx.currentTime, .13);
      setTimeout(function () { try { s.stop(); s.disconnect(); g.disconnect(); } catch (e) { } }, 600);
    }
  };
  S.isOn = function () { return on; };
  S.hasContext = function () { return !!ctx; };
  /* set(v, gesture): gesture is true when called from a click or key press; that is the only time the context is created */
  S.set = function (v, gesture) {
    var was = on; on = !!v; savePref(on);
    if (on) { if (gesture) { ensure(); resume(); } if (!was && gesture) S.clack(); }
    else { S.hum(false); }
    fire("soundchange");
    if (on && humWant) S.hum(true);
  };
  /* any gesture while ON: make sure the context exists and is running, then play what was waiting */
  function onGesture() {
    if (!on) return;
    ensure(); resume();
    if (ctx && pendingStamp) { pendingStamp = false; setTimeout(function () { stampOnce(); }, 40); }
    if (humWant) S.hum(true);
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

  /* page lifecycle: stop the hum when the tab hides or the page is put away; restore when it comes back */
  document.addEventListener("visibilitychange", function () { if (document.hidden) S.hum(false); else if (humWant) S.hum(true); });
  window.addEventListener("pagehide", function () { S.hum(false); if (ctx && ctx.state === "running") { try { ctx.suspend(); } catch (e) { } } });
  window.addEventListener("pageshow", function (e) { on = readPref(); if (e.persisted) { fire("soundchange"); if (on) { resume(); if (humWant) S.hum(true); } } });

  /* offline check used by the test harness: render one sound and return its peak in dBFS, after the master gain */
  S.render = function (name) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC || !SND[name]) return Promise.reject(new Error("no " + name));
    var c = new OAC(1, 44100 * 2, 44100), m = c.createGain(); m.gain.value = .35; m.connect(c.destination);
    SND[name](c, m, .05);
    return c.startRendering().then(function (buf) { var d = buf.getChannelData(0), mx = 0; for (var i = 0; i < d.length; i++) if (Math.abs(d[i]) > mx) mx = Math.abs(d[i]); return { peak: mx, dbfs: 20 * Math.log10(mx || 1e-9) }; });
  };
})();
