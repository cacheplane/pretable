# Column fill: document `flex`, use it on the showcase grids — design

**Date:** 2026-09-17
**Issue:** #604
**Decision:** no behaviour change. `flex` already fills leftover viewport width (`packages/layout-core/src/flex-widths.ts`, tested in `packages/react/src/__tests__/flex-columns.test.tsx`). The gap is that the docs mention it in one clause and the site's own grids do not use it, so the dead band on the right is what a reader sees first. The default stays opt-in, chosen over a `columnFill` grid prop.

## What ships

1. **A live example, `column-flex`**, under `apps/website/content/examples/column-flex/`, following the examples-first authoring contract (`docs/superpowers/specs/2026-08-14-examples-first-docs.md`). Four columns: two fixed (`widthPx`), two flexible with different weights and a `minWidthPx` on the narrower one, so a reader can see both the share and the floor. The row ends exactly at the viewport edge at every width the docs pane takes between 900px and 1600px page widths; the widths were tuned so the floor does not bind there, and the section says what happens when a floor does bind (the row overruns and scrolls by the difference). The caption beneath the grid names which columns flex and their weights.

2. **A `## Fill the viewport` section in `apps/website/content/docs/grid/column-layout.mdx`**, placed directly before `## Auto width`, leading with `<Example id="column-flex" />` and then explaining, in the page's voice:
   - leftover = viewport width minus the sum of non-flex column widths; flex columns split it by weight; rounding is settled on the last flex column so the row ends on the edge, not one pixel short;
   - `minWidthPx` / `maxWidthPx` clamp a share, and a column with neither still never drops under a 24px floor;
   - when the fixed columns alone exceed the viewport there is nothing to share, each flex column keeps its own width, and the grid scrolls horizontally;
   - what a resize drag does to a flex column. This must be verified in the browser during implementation, not assumed, and the sentence written from what was observed.
     The one clause in `## Auto width` that mentions flex stays and links to the new section.

3. **The showcase grids use it.** The hero grid's last column (`AI Analyst`, `apps/website/app/components/heroGrid/positionColumns.tsx`) gains `flex: 1` with `minWidthPx` equal to its current `widthPx`, so it never gets narrower than today and absorbs the band on wide screens. The `scrolled-seam` fixture's `amount` column gains `flex: 1` with `minWidthPx: 140` for the same reason.

## What does not change

- No new grid prop, no change to `distributeFlexWidths`, no change to the default width.
- The `column-layout` example keeps its fixed widths; it demonstrates resize and pin, where a stretching column would muddy the readout.

## Verification

- `pnpm --filter @pretable/app-website examples:gen` regenerates the registry; `examples:check` and the docs guard pass.
- Website unit suite green (the example is registered and referenced exactly once).
- Playwright: a new `column-flex.spec.ts` opens `/docs/grid/column-layout`, waits for the `column-flex` example's grid to hydrate, and asserts the sum of the drawn header cell widths equals the scroll viewport's `clientWidth` (within 1px), at two viewport widths (1280 and 900). This is the pixel claim the section makes.
- The hero grid e2e specs still pass with the new flex column.
- Screenshot of the docs section and the hero at 1400px reviewed by eye.
