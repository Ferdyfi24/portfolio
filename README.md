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
- `sound.js`: UI sound synthesised with the Web Audio API (scanner beep, rubber stamp, switch clack, forklift beeper, conveyor hum). Off by default.
- Media: `poster.jpg`, `hero-poster.jpg`, `hero-loop.mp4`, `wms-2min.mp4`, `r1.jpg` to `r9.jpg`.

## Adding a project

Add an entry to the `projects` array in `projects.json`. The order of the array is the order on the site and the prev/next order. Pick a `doc` (which form the page looks like) and a `visual` (which sketch animates on the card); for a screenshot instead of a sketch use `"visual": "image"` with an `"image"` filename at the root. Filter chips and counts are computed from the data; a new `rack` key only needs a label in `racks`.
