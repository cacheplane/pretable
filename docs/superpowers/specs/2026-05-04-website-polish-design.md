# Website polish — drawer, nav, "why it works", docs return path

Four polish passes on the marketing site. Each is independent; they ship together but can be reviewed separately.

## 1. Drawer handle redesign

**Problem.** The bottom drawer handle is the only affordance to open the marketing drawer when the home page is closed. It currently sits at `bottom: 0`, full-width, with class `bg-drawer-bg`. That utility resolves to `rgba(0,0,0,0)` (transparent) — even though the underlying `--pt-drawer-bg` token is `#1e293b`. The handle is therefore invisible against the grid behind it.

**Fix.** Plain CSS in `globals.css` for the handle's appearance, since Tailwind's bg utility isn't picking up the token here. Treat the handle visually as the top edge of an iOS-style drawer:

- Full-width bar pinned `bottom: 0`.
- Solid `--pt-drawer-bg` background (no transparency).
- Top corners rounded (~14px); bottom corners square.
- Subtle top border / shadow to lift it off the grid (`box-shadow: 0 -8px 24px rgba(0,0,0,0.25)`).
- Centered grab-bar pill above the label: ~36×4px, `--pt-text-dim`, ~50% opacity, ~6px above text.
- Label text "↑ Why pretable" stays.
- Increase vertical padding so the bar reads as a peek-card edge (~14px top / 16px bottom).
- Hover translate-y unchanged.

CSS lives alongside the existing `.drawer-handle` rules in `globals.css`. The Tailwind `bg-drawer-bg` and padding utilities on the button get removed (the new CSS owns appearance).

## 2. Drawer NavBar — brand closes drawer

**Problem.** When the drawer is open and the user clicks the `pretable.ai` brand link in the in-drawer NavBar, the link navigates to `/` — but they're already on `/`, so nothing useful happens (drawer stays open, no scroll). User expectation: brand = home = the grid.

**Fix.** In `NavBar` (`mode="drawer"`), the brand becomes interactive: `onClick` calls the same `close()` that "Show the grid" does, and `preventDefault`s the navigation. Brand still renders as `<Link href="/">` for SEO + middle-click + accessibility, but its click handler closes the drawer in-place.

Implementation: `NavBar` already accepts `onClose` for drawer mode. Pass through to brand `onClick` (same handler as "Show the grid"). Site-mode NavBar is unchanged — brand navigates normally.

## 3. "Why it works" — promote the math thesis

**Problem.** The strongest claim in the section ("DOM is expensive. We use math instead.") is buried as one of four callouts at the bottom. Section heading is "A deterministic pipeline. No magic." — accurate but soft. No mention of agentic / LLM streaming, which is the workload the streaming pipeline is designed for.

**Fix.** Re-anchor the section on the math thesis and add an agentic-apps callout.

**Heading change** in `HowItWorks.tsx`:

- Eyebrow stays (`04 · how it works`).
- New `<h2>`: **"DOM measuring sucks. We use math. It's hard."** (with `It's hard.` as the italic-accent emphasis, replacing the current `No magic.`).

**Lede paragraph** (replaces current intro about five stages):

> Wrapped row heights are computed with character-width tables and font metrics — pure arithmetic. No `getBoundingClientRect`, no forced reflow, no measure-on-mount. The DOM is touched exactly once per frame, at commit. The five-stage pipeline below is what enforces that discipline.

The pipeline diagram + LayerStack stay where they are, framed as the implementation of the thesis rather than the thesis itself.

**Callouts (4-pack) — replace the DOM/math callout with the agentic one:**

1. **Engine is a pure function.** (unchanged)
2. **RAF batches the stream.** (unchanged)
3. **Telemetry stays off-DOM.** (unchanged)
4. **Built for agentic apps.** (new) — body: "LLM streams, partial JSON, tool-call traces — bursts of 100 to 25,000 patches/sec all collapse to one snapshot per animation frame. No per-token reflow. Selection survives every patch."

Existing source-link footer (`packages/grid-core, layout-core, text-core, renderer-dom — under 3,000 lines combined`) is unchanged.

Tests in `apps/website/__tests__/components/HowItWorks.test.tsx` need updating to match the new heading + callout copy.

## 4. Docs → marketing return path

**Problem.** From `/docs`, clicking the brand returns to `/`, but `/` lands on the grid with drawer closed. The marketing content the user just left is invisible. There's no clear path back.

**Fix.** Conditional brand href, driven by sessionStorage.

- When `useDrawer.open()` runs on `/`, set `sessionStorage.setItem('pretable:lastDrawer', 'open')`.
- When `useDrawer.close()` runs, remove the key.
- On non-home pages (`/docs`, `/bench`), the brand link reads the flag at click time. If `open`, the href is `/#receipts`; otherwise `/`.

`useDrawer` already auto-opens the drawer on mount when the URL hash matches a known drawer section, so a `/#receipts` landing restores the marketing view automatically.

SEO note: hash fragments are part of the same URL to crawlers, so `/` vs `/#receipts` are equivalent for indexing — this knob is invisible to search.

Implementation:

- `useDrawer.ts`: write/clear the sessionStorage flag in `open` / `close`.
- `NavBar.tsx`: in `mode="site"`, the brand component becomes a small client wrapper that reads the flag (in a `useEffect` to avoid SSR mismatch) and rewrites `href` accordingly. Default `/` for SSR + cold loads.

## Out of scope

- The pipeline diagram, LayerStack, and other "how it works" subcomponents are not redesigned — only the heading, lede, and the one swapped callout change.
- Docs sidebar is unchanged.
- Bench page brand link gets the same conditional behavior as docs (it shares `NavBar` site-mode), but no other bench changes.
- No changes to drawer open/close transitions, the streaming demo, or hero grid.

## Testing

- Vitest: update `HowItWorks.test.tsx` for new heading + callout. Verify `useDrawer` writes/clears flag on open/close. Verify drawer-mode `NavBar` brand calls `onClose`. Verify site-mode `NavBar` brand href flips with flag.
- Playwright smoke: open drawer → navigate to `/docs` → click brand → expect drawer open on `/`. Cold load `/docs` → click brand → expect drawer closed on `/`.
- Manual: visual check of the new handle on the home page (rounded corners, grab bar, opaque), and the new "Why it works" copy in browser.
