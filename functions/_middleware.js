/* Cloudflare Pages Function. Runs only on the paths listed in _routes.json.
   - /project and /project.html: project pages are filled in by JavaScript, which link previews (LinkedIn, WhatsApp,
     X) never run. This writes the project's own title, description and preview image into the page head on the
     server, read from projects.json, so a shared project link shows that project instead of the generic card.
   - /sitemap.xml: built from projects.json on request, so a new project is in the sitemap as soon as it is committed.
   Nothing here changes what a visitor sees in the page body. If anything fails, the normal page is served. */
const SITE = "https://ferdy-portfolio.pages.dev";
const MOVED = { procurement: "order-anomaly" };

async function projects(ctx, url) {
  try {
    const r = await ctx.env.ASSETS.fetch(new URL("/projects.json", url));
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
}

async function exists(ctx, url, path) {
  try { const r = await ctx.env.ASSETS.fetch(new URL(path, url), { method: "HEAD" }); return r.ok; } catch (e) { return false; }
}

function xml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

async function sitemap(ctx, url) {
  const data = await projects(ctx, url);
  const paths = ["/", "/wms"].concat(((data && data.projects) || []).filter(p => p && p.slug).map(p => "/project?p=" + encodeURIComponent(p.slug)));
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map(p => "  <url><loc>" + xml(SITE + p) + "</loc></url>").join("\n") + "\n</urlset>\n";
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

class SetAttr {
  constructor(name, value) { this.name = name; this.value = value; }
  element(e) { e.setAttribute(this.name, this.value); }
}
class SetText {
  constructor(value) { this.value = value; }
  element(e) { e.setInnerContent(this.value); }
}

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  if (url.pathname === "/sitemap.xml") return sitemap(ctx, url);
  const res = await ctx.next();
  if (url.pathname !== "/project" && url.pathname !== "/project.html") return res;
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  try {
    let slug = url.searchParams.get("p") || "";
    if (MOVED[slug]) slug = MOVED[slug];
    const data = await projects(ctx, url);
    const p = data && (data.projects || []).find(x => x && x.slug === slug);
    if (!p) return res;
    const title = (p.short || p.title || "Project") + " · Ferdy Febrian Iskandar";
    const desc = p.lede || p.summary || "";
    const img = SITE + ((await exists(ctx, url, "/og/" + encodeURIComponent(slug) + ".png")) ? "/og/" + encodeURIComponent(slug) + ".png" : "/og-card.png");
    const pageUrl = SITE + "/project?p=" + encodeURIComponent(slug);
    return new HTMLRewriter()
      .on("title", new SetText(title))
      .on('meta[name="description"]', new SetAttr("content", desc))
      .on('meta[property="og:title"]', new SetAttr("content", title))
      .on('meta[property="og:description"]', new SetAttr("content", desc))
      .on('meta[property="og:url"]', new SetAttr("content", pageUrl))
      .on('meta[property="og:image"]', new SetAttr("content", img))
      .transform(res);
  } catch (e) { return res; }
}
