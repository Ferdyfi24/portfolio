# portfolio

Personal portfolio of Ferdy Febrian Iskandar: operations, supply chain and data projects.

Plain static site, no build step, no libraries. Deployed on Cloudflare Pages straight from this repo, so everything sits flat at the root.

## Files

- `index.html`: home page. The project rack is rendered in the browser from `projects.json`; everything else is static HTML.
- `project.html`: one template for every project page. It reads `?p=<slug>` and renders the project as a warehouse document (stock count sheet, purchase order, picking list, delivery note or goods receipt). An unknown slug shows a "not found in this rack" page.
- `wms.html`: case study "Five files. Now one WMS." with the 2-minute walkthrough video and real screens.
- `projects.json`: the single source of truth for all projects. The field reference is in the comment at the top of the script in `project.html`.
- `site.css`: all styles. One safety orange, white, ink and two greys.
- `site.js`: the MOTION and SOUND switches, page transitions, barcodes, count-up, the rack and its filters, nav.
- `viz.js`: every canvas: the animated sketch on each card and project page, the hero racking and conveyor, the floor grid, the footer belt.
- `sound.js`: sound synthesised with the Web Audio API, off by default: UI sounds (scanner beep, rubber stamp, switch clack, forklift beeper), hover taps, and ambient sound tied to the animations (conveyor bed, hoist motor, winch, latch, carton thump, floor cartons).
- `certificates.json`: every certificate on the site, shown as QC tags on the home page and on the linked project page.
- `404.html`: served by Cloudflare Pages for any unknown address.
- `functions/_middleware.js` with `_routes.json`: a Cloudflare Pages Function that writes each project's own title and preview image into `/project` pages for link previews, and builds `/sitemap.xml` from `projects.json`.
- `robots.txt`, `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `og-card.png` and `og/<slug>.png` (link preview images).
- `tools/og.mjs`: regenerates the preview images and icons with Playwright (`node tools/og.mjs og`).
- Media: `poster.jpg`, `hero-poster.jpg`, `hero-loop.mp4`, `wms-2min.mp4`, `r1.jpg` to `r9.jpg`.

## Adding a project

Add an entry to the `projects` array in `projects.json`. The order of the array is the order on the site and the prev/next order. Pick a `doc` (which form the page looks like) and a `visual` (which sketch animates on the card); for a screenshot instead of a sketch use `"visual": "image"` with an `"image"` filename at the root. Filter chips and counts are computed from the data; a new `rack` key only needs a label in `racks`.


Certificates: add an entry to `certificates.json`; see ADD-A-PROJECT.md.
