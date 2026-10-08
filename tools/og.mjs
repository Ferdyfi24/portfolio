/* Renders the site's image assets with headless Chromium (Playwright). Re-run it whenever projects.json changes.
     node tools/og.mjs            everything: favicon-32.png, apple-touch-icon.png, og-card.png, og/<slug>.png
     node tools/og.mjs og         only the per-project cards
     node tools/og.mjs card       only og-card.png
     node tools/og.mjs icons      only the two PNG icons (from favicon.svg)
   Fonts: the site loads Barlow Condensed, Barlow and IBM Plex Mono from Google Fonts. This script embeds the same
   fonts from a local @fontsource folder when one is found (FONTS_DIR, or node_modules/@fontsource next to the site,
   or the folder listed in CANDIDATES below) and otherwise asks Google Fonts, so it needs either the folder or a network.
   Browser: Playwright's own Chromium, or the one at PW_CHROMIUM / the first path in CHROMIUM below that exists.
   Nothing here is uploaded; the files are written into the site folder. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "ferdy-portfolio.pages.dev";
const what = process.argv[2] || "all";

/* ---- Playwright and Chromium ---- */
function loadPlaywright() {
  const tries = ["playwright", "/opt/npm-tools/node_modules/playwright", "/usr/local/lib/node_modules_global/playwright", join(ROOT, "node_modules/playwright")];
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  throw new Error("playwright not found: npm i -D playwright (the browser is not installed by this script)");
}
const CHROMIUM = [process.env.PW_CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].filter(Boolean);
function chromiumPath() {
  for (const p of CHROMIUM) if (existsSync(p)) return p;
  if (existsSync("/opt/pw-browsers")) { /* any chromium-* folder */
    for (const d of readdirSync("/opt/pw-browsers")) { const p = join("/opt/pw-browsers", d, "chrome-linux/chrome"); if (/^chromium-\d+$/.test(d) && existsSync(p)) return p; }
  }
  return undefined;
}

/* ---- fonts ---- */
const CANDIDATES = [process.env.FONTS_DIR, join(ROOT, "node_modules/@fontsource"), "/tmp/claude-0/-home-claude/734637d7-4ef4-5392-8862-4843ea5b65c8/scratchpad/fonts/node_modules/@fontsource"].filter(Boolean);
const FACES = [
  ["Barlow Condensed", "barlow-condensed", 600], ["Barlow Condensed", "barlow-condensed", 700], ["Barlow Condensed", "barlow-condensed", 800],
  ["Barlow", "barlow", 400], ["Barlow", "barlow", 500], ["Barlow", "barlow", 600],
  ["IBM Plex Mono", "ibm-plex-mono", 400], ["IBM Plex Mono", "ibm-plex-mono", 500]
];
function fontCss() {
  const dir = CANDIDATES.find(d => existsSync(join(d, "barlow-condensed/files")));
  if (!dir) {
    console.warn("local fonts not found, using Google Fonts (needs a network)");
    return '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=block">';
  }
  const css = FACES.map(([fam, pkg, w]) => {
    const file = join(dir, pkg, "files", `${pkg}-latin-${w}-normal.woff2`);
    const b64 = readFileSync(file).toString("base64");
    return `@font-face{font-family:"${fam}";font-weight:${w};font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
  }).join("\n");
  return `<style>${css}</style>`;
}

/* ---- Code 128 B barcode as inline SVG (the same table as site.js) ---- */
const C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112").split(" ");
function barcode(text, h) {
  const s = String(text || "").replace(/[^\x20-\x7e]/g, "").slice(0, 24) || "0", vals = [104]; let sum = 104;
  for (let i = 0; i < s.length; i++) { const v = s.charCodeAt(i) - 32; vals.push(v); sum += v * (i + 1); }
  vals.push(sum % 103); vals.push(106);
  let x = 10, rects = "";
  for (const v of vals) { const p = C128[v]; for (let j = 0; j < p.length; j++) { const w = +p[j]; if (j % 2 === 0) rects += `<rect x="${x}" width="${w}" height="${h}"/>`; x += w; } }
  x += 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${h}" width="${x}" height="${h}" shape-rendering="crispEdges" fill="currentColor">${rects}</svg>`;
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---- the rack and conveyor line drawing used on the site card ---- */
function rackSvg() {
  let s = "";
  const x0 = 40, bays = 3, bayW = 150, fw = 12, top = 70, floor = 400, lv = (floor - top) / 3;
  for (let b = 0; b <= bays; b++) { const fx = x0 + b * bayW; s += `<path d="M${fx} ${top - 14}V${floor}M${fx + fw} ${top - 14}V${floor}"/>`; for (let y = top; y < floor - 8; y += 18) s += `<path d="M${fx} ${y}l${fw} 9" stroke-width="1.5"/>`; }
  s += `<path d="M${x0 - 30} ${floor}H${x0 + bays * bayW + fw + 30}" stroke-width="5"/>`;
  const stock = [[[0, 36, 30], [40, 48, 42]], [[0, 56, 46]], [[0, 34, 28], [38, 34, 44], [76, 40, 36]], [[0, 48, 40], [52, 30, 30]], [[0, 60, 50]], [[0, 38, 30], [42, 52, 42]], [[0, 44, 36]], [[0, 36, 30], [40, 36, 30], [80, 36, 44]], [[0, 50, 46]]];
  let k = 0;
  for (let l = 0; l < 3; l++) for (let b = 0; b < bays; b++) {
    const bx = x0 + fw + b * bayW, bw = bayW - fw, by = top + l * lv;
    if (l > 0 || true) s += `<path d="M${bx} ${by}H${bx + bw}" stroke-width="6"/>`;
    const st = stock[k++ % stock.length], tot = st[st.length - 1][0] + st[st.length - 1][1], px = bx + (bw - tot) / 2, py = by + lv - 10;
    s += `<path d="M${bx + 10} ${py}H${bx + bw - 10}"/>`;
    for (const [ox, w, h] of st) s += carton(px + ox, py - h, w, h);
  }
  /* conveyor along the bottom */
  const yT = 450, yB = 480;
  s += `<path d="M-20 ${yT}H900M-20 ${yB}H900" stroke-width="3"/>`;
  for (let x = 0; x < 900; x += 26) s += `<circle cx="${x}" cy="${(yT + yB) / 2}" r="10" stroke-width="2"/>`;
  for (let x = 60; x < 900; x += 190) s += `<path d="M${x} ${yB}V510M${x - 12} 510H${x + 12}" stroke-width="3"/>`;
  for (const [x, w, h] of [[30, 46, 28], [190, 38, 24], [330, 54, 30], [520, 40, 26], [700, 48, 28]]) s += carton(x, yT - h - 1, w, h);
  /* rail and trolley with a hanging carton */
  s += `<path d="M${x0 - 60} 30H${x0 + bays * bayW + 70}M${x0 - 60} 24H${x0 + bays * bayW + 70}" stroke-width="3"/>`;
  const tx = x0 - 30;
  s += `<rect x="${tx - 14}" y="12" width="28" height="12"/><circle cx="${tx - 8}" cy="27" r="3"/><circle cx="${tx + 8}" cy="27" r="3"/><path d="M${tx} 30V300M${tx - 6} 300H${tx + 6}"/>` + carton(tx - 20, 300, 40, 32);
  return `<svg viewBox="-80 0 800 520" fill="none" stroke="#FFFFFF" stroke-width="3" xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
  function carton(x, y, w, h) { return `<rect x="${x}" y="${y}" width="${w}" height="${h}"/><path d="M${x} ${y + h * .3}H${x + w}M${x + w / 2} ${y}V${y + h * .3}"/><rect x="${x + w * .62}" y="${y + h * .55}" width="${w * .26}" height="${h * .3}" stroke-width="1.5"/>`; }
}

const BASE_CSS = `*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden}body{font-family:Barlow,Arial,sans-serif;color:#121212;background:#F26419;position:relative}
.mono{font-family:"IBM Plex Mono",Menlo,monospace}.cond{font-family:"Barlow Condensed","Arial Narrow",sans-serif;text-transform:uppercase}`;

function siteCard(fonts) {
  return `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${BASE_CSS}
.art{position:absolute;right:10px;top:36px;width:540px;height:520px}
.copy{position:absolute;left:64px;top:60px;width:640px}
.status{display:inline-flex;align-items:center;gap:12px;border:3px solid #121212;padding:10px 14px;font-size:19px;letter-spacing:.14em;text-transform:uppercase;font-weight:500}
.status i{width:11px;height:11px;background:#121212}
h1{font-size:92px;line-height:.88;font-weight:800;margin-top:28px;letter-spacing:-.01em}
h1 .w{display:block;color:#FFFFFF;font-size:52px;line-height:.95;margin-top:14px;letter-spacing:0}
.addr{position:absolute;left:64px;bottom:74px;display:inline-flex;border:3px solid #121212;background:#121212;color:#FFFFFF;font-size:24px;letter-spacing:.06em;padding:12px 18px;font-weight:500}
.addr b{color:#F26419;font-weight:500;margin-right:16px}
.hz{position:absolute;left:0;right:0;bottom:0;height:18px;background:#F26419 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M-6 6L6-6M0 24L24 0M18 30L30 18' stroke='%23121212' stroke-width='8.5'/%3E%3C/svg%3E") 0 0/24px 24px repeat;border-top:3px solid #121212}
.zone{position:absolute;right:64px;bottom:78px;background:#F26419;border:3px solid #121212;padding:8px 12px;font-size:19px;letter-spacing:.18em;font-weight:800}
</style></head><body>
<div class="art">${rackSvg()}</div>
<div class="copy"><span class="status mono"><i></i>Operations and data · Jakarta</span>
<h1 class="cond">Ferdy Febrian<br>Iskandar<br><span class="w">Operations and systems.<br>And the software underneath.</span></h1></div>
<div class="addr mono"><b>WWW</b>${SITE}</div>
<div class="zone mono">RACK A · 01</div>
<div class="hz"></div>
</body></html>`;
}

function projectCard(fonts, p, data) {
  const rack = (data.racks && data.racks[p.rack]) || p.rack || "";
  return `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>${BASE_CSS}
.label{position:absolute;left:56px;top:50px;width:1088px;height:530px;background:#FFFFFF;border:5px solid #121212;display:flex;flex-direction:column}
.head{display:flex;justify-content:space-between;align-items:flex-end;padding:28px 36px 22px;border-bottom:5px solid #121212}
.code{font-size:92px;line-height:.9;font-weight:800;letter-spacing:.01em}
.kind{margin-top:12px;font-size:20px;letter-spacing:.1em;text-transform:uppercase;color:#5F5F5F;font-weight:500}
.bc{text-align:right;color:#121212}.bc svg{display:block;height:84px;width:auto}.bc small{display:block;font-size:17px;letter-spacing:.3em;margin-top:8px}
.body{padding:26px 36px 0;flex:1}
.rk{display:flex;align-items:center;gap:12px;font-size:19px;letter-spacing:.14em;text-transform:uppercase;color:#5F5F5F;font-weight:500}
.rk i{width:16px;height:16px;background:#F26419;border:2.5px solid #121212}
h1{font-size:${(p.title + " " + p.titleAccent).length > 34 ? 72 : 88}px;line-height:.9;font-weight:800;margin-top:16px;letter-spacing:-.005em}
h1 .acc{color:#F26419}
.foot{display:flex;justify-content:space-between;align-items:center;padding:16px 36px;border-top:3px solid #121212;font-size:22px;letter-spacing:.06em;font-weight:500}
.foot b{font-weight:500;color:#5F5F5F}
.hz{height:16px;background:#F26419 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M-6 6L6-6M0 24L24 0M18 30L30 18' stroke='%23121212' stroke-width='8.5'/%3E%3C/svg%3E") 0 0/24px 24px repeat;border-top:3px solid #121212}
</style></head><body>
<div class="label">
  <div class="head"><div><div class="code cond">${esc(p.code)}</div><div class="kind mono">${esc(p.kind || "")}</div></div><div class="bc">${barcode(p.code, 84)}<small class="mono">${esc(p.code)}</small></div></div>
  <div class="body"><div class="rk mono"><i></i>${esc(rack)}${p.year ? " · " + esc(p.year) : ""}</div><h1 class="cond">${esc(p.title)} <span class="acc">${esc(p.titleAccent)}</span></h1></div>
  <div class="foot mono"><span><b>WWW </b>${SITE}</span><span><b>REF </b>${esc(p.slug)}</span></div>
  <div class="hz"></div>
</div>
</body></html>`;
}

function iconHtml(size) {
  const svg = readFileSync(join(ROOT, "favicon.svg"), "utf8");
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0}html,body{width:${size}px;height:${size}px;overflow:hidden;background:#F26419}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`;
}

async function main() {
  const { chromium } = loadPlaywright();
  const exe = chromiumPath();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const fonts = fontCss();
  async function shoot(html, w, h, out) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(80);
    await page.screenshot({ path: out, type: "png", clip: { x: 0, y: 0, width: w, height: h } });
    await page.close();
    console.log("wrote", out.replace(ROOT + "/", ""));
  }
  if (what === "all" || what === "icons") {
    await shoot(iconHtml(32), 32, 32, join(ROOT, "favicon-32.png"));
    await shoot(iconHtml(180), 180, 180, join(ROOT, "apple-touch-icon.png"));
  }
  if (what === "all" || what === "card") await shoot(siteCard(fonts), 1200, 630, join(ROOT, "og-card.png"));
  if (what === "all" || what === "og") {
    const data = JSON.parse(readFileSync(join(ROOT, "projects.json"), "utf8"));
    mkdirSync(join(ROOT, "og"), { recursive: true });
    for (const p of data.projects || []) {
      if (!p || !p.slug) continue;
      await shoot(projectCard(fonts, p, data), 1200, 630, join(ROOT, "og", p.slug.replace(/[^a-z0-9_-]/gi, "_") + ".png"));
    }
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
