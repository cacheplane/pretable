# Website Redesign: Grid-as-Hero with Alpenglow Drawer

## Goal

Redesign the pretable marketing landing page (`apps/website`) so the live data grid IS the hero — full-bleed at first paint, with a bottom drawer that reveals the rest of the marketing content on demand. The page has personality drawn from Bend, OR and skiing without sacrificing technical credibility. Light mode by default. Content is always in the DOM (SEO-first); JS upgrades the experience to a theatrical overlay drawer.

## Decisions

| Q | Decision | Rationale |
| --- | --- | --- |
| Layout | **A** — full-bleed grid + bottom drawer | Boldest of the three; demonstrates the product instantly; sets the tone for "technical taste" |
| Palette | **Alpenglow** (warm cream paper · dusk peach `#ea580c` · cobalt `#1d4ed8`) | Mt. Bachelor at sunset; warm + confident; distinctive without being earthy or precious |
| Default mode | **Light** | Honest signal that the product is welcoming, not a niche tool for dark-room hackers |
| Drawer interaction | **B (overlay)** + **DOM-first via CSS upgrade** | Theatrical drawer feel with no SEO penalty; identical experience for crawlers, no-JS users, and reduced-motion |
| Motifs | **B** (trail markers) · **C** (alpine type + gradient) · **D** (mountain silhouette + chairlift) | Lean into the ski metaphor explicitly; trail markers give difficulty gradient for docs/use-cases; mountain silhouette is a deliberate page-foot moment |
| Grid behavior | **1** — live streaming feed | 1k events/sec with alpenglow flash on new rows; the wedge demonstrates itself in the first 2 seconds |
| Mobile | **A** — drawer is desktop-only | Mobile gets the natural DOM scroll page (== no-JS fallback); avoids gesture-handling code on Android variants |

## Architecture

### Page structure

DOM order, server-rendered, semantically meaningful:

```
<body>
  <header role="banner">              <!-- top bar with logo, nav, drawer-state-aware affordance -->
  <main role="main">
    <section id="grid" class="hero">  <!-- streaming grid, 100vh -->
    <button class="drawer-handle">    <!-- "↑ Learn more" -->
    <section id="receipts">           <!-- marketing sections, in DOM order, after the grid -->
    <section id="compare">
    <section id="how-it-works">
    <section id="code">
    <section id="features">
    <section id="cta">
  </main>
  <footer>                            <!-- mountain silhouette + chairlift detail -->
</body>
```

Default CSS (no JS): everything flows naturally. The hero takes `100vh`, drawer handle sits below it as a regular link to `#receipts`, marketing sections are normal block-level sections, footer at the bottom. Crawlers, no-JS users, screen readers, and `prefers-reduced-motion` users see this. SEO-equivalent to today's long-scroll site.

### Drawer mechanism (JS upgrade)

DOM shape:

```html
<main>
  <section class="hero">…streaming grid…</section>
  <div class="drawer-wrap">
    <button class="drawer-handle">↑ Learn more</button>
    <div class="drawer-content">
      <section id="receipts">…</section>
      <section id="compare">…</section>
      …
    </div>
  </div>
</main>
```

**Default CSS (no JS / `prefers-reduced-motion`):** `.drawer-wrap` is `position: static`; everything inside flows naturally. The handle is just an in-page anchor link to `#receipts`. Crawlers, no-JS users, and reduced-motion users see this — a normal long-scroll page.

**Hydrated CSS (JS adds `data-drawer="closed"` to `<html>`):**

```css
[data-drawer] .drawer-wrap {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 75vh;
  transform: translateY(calc(100% - var(--drawer-handle-height, 56px)));
  transition: transform 360ms cubic-bezier(0.32, 0.72, 0, 1);
}
[data-drawer="open"] .drawer-wrap {
  transform: translateY(0);
}
[data-drawer="open"] .hero {
  filter: brightness(0.85);  /* dim the grid behind the open drawer */
}
@media (prefers-reduced-motion: reduce) {
  [data-drawer] .drawer-wrap { transition: none; }
  [data-drawer="open"] .hero { filter: none; }
}
```

Same DOM, two presentations.

### Drawer dismiss

Three ways to close:

1. **Close button** in the drawer header (X, top-right)
2. **Browser back button** — `history.pushState({drawer:"open"}, "")` on open; popstate handler closes drawer
3. **Esc key** — keyboard accessibility

Anchor link behavior: navigating to `#compare` (e.g., from a shared link) → JS reads `location.hash` on mount → opens drawer + scrolls to `#compare` inside `.drawer-content`.

### Mobile / responsive

Below `768px`, JS does NOT add `data-drawer`. Page renders as the default CSS — natural scroll, drawer handle is just an in-page anchor link. Same DOM, different presentation.

`prefers-reduced-motion: reduce` → JS still adds `data-drawer="closed"`, but CSS `transition` is `none` and `transform` is computed without animation. Drawer toggles via display/transform but instantaneously.

## Hero — the grid

### Behavior

Live streaming feed:

- Canned event log dataset (~3,000 rows total at peak), looping every ~30s
- 1,000 events/sec sustained insert rate via `@cacheplane/json-stream` + `@pretable/stream-adapter`
- Each new row briefly highlights with an alpenglow tint (`#fef3e2` background fade, 600ms ease-out)
- 60fps scroll throughout (the wedge demonstrates itself)
- **Pauses on hover** so visitors can read individual rows
- **Pauses on `prefers-reduced-motion: reduce`** — shows a static snapshot instead

### Top bar (above the grid)

Single-line bar, 44px tall:

```
●  pretable.ai  ·  events.stream  ·  3,000 rows · 9.3ms p95          /docs   GitHub →
```

- Left: logo dot (alpenglow `#ea580c`) + brand + dataset label + tiny live-metric readout
- Right: `/docs` link, GitHub icon link
- Background: `rgba(255, 248, 241, 0.85)` with `backdrop-filter: blur(8px)` — sits over the grid

### Drawer handle (bottom of hero)

```
↑ LEARN MORE
```

- Dark slab (`#1e293b`) with amber text (`#fbbf24`), centered horizontally
- 56px tall on desktop, 64px on tablet
- Subtle bounce on idle every 8s (chevron up/down by 2px) to suggest interactivity
- On hover: lifts 4px, gradient strengthens
- On focus: 2px alpenglow ring

## Drawer content

The marketing sections that currently live below the hero, curated and ordered to a tighter narrative arc. Six sections total (down from today's 11):

1. **Receipts** (`#receipts`) — the headline numbers: 4× scroll vs AG Grid, zero row-height-error, H15 satisfied. Same ReceiptsBand we have today, pruned.
2. **Compare** (`#compare`) — the comparative table (`<ComparisonTable>` from today). Trail-map difficulty markers next to each adapter row.
3. **How it works** (`#how-it-works`) — `<HowItWorks>` component (the deterministic pipeline section). Reused.
4. **Code** (`#code`) — `<CodeExample>`. Reused.
5. **Features** (`#features`) — `<FeatureGrid>` reduced to four cards (down from six). Trail markers on each (green / blue / black-diamond) for difficulty / depth.
6. **Get started** (`#cta`) — `<CtaSection>`, sharpened. Single primary CTA: install command. Secondary: GitHub link.

Sections **dropped** (or merged into Receipts):

- `<Hero>` — replaced by the streaming grid
- `<PositioningStrip>` — merged into Receipts as a 4-card sub-row
- `<PlaygroundSection>` — IS the streaming grid hero now
- `<Problem>` — merged into Receipts (single line: "AG Grid clips wrapped content to one line at hypothesis scale")
- `<UseCases>` — merged into Features
- `<TrustStrip>` — drop (the receipts speak for themselves)

Drawer header (sticky inside the drawer):

```
[Why pretable]                                                    [✕ close]
```

- Drawer-open URL state: `?drawer=open` or `#receipts` etc.; `history.pushState` on toggle.

## Palette + design tokens

Alpenglow values:

```css
:root {
  --pt-bg-page:        #fefcf9;  /* warm cream paper */
  --pt-bg-card:        #fff8f1;  /* slightly warmer card surface */
  --pt-bg-raised:      #fef3e2;  /* gradient mid-tone */
  --pt-text-primary:   #0c0a09;  /* near-black */
  --pt-text-secondary: #44403c;  /* warm gray */
  --pt-text-muted:     #78716c;  /* warmer muted */
  --pt-text-dim:       #a8a29e;  /* dim warm gray */
  --pt-accent:         #ea580c;  /* dusk peach (primary) */
  --pt-accent-deep:    #b45309;  /* terracotta — hover, links */
  --pt-accent-soft:    #fef3e2;  /* alpenglow tint for backgrounds */
  --pt-cool:           #1d4ed8;  /* cobalt — cool data, never accent */
  --pt-sev-info:       #1d4ed8;
  --pt-sev-warn:       #b45309;
  --pt-sev-err:        #b91c1c;
  --pt-sev-ok:         #15803d;  /* juniper green */
  --pt-rule:           #f5e6d3;  /* warm rule */
  --pt-rule-soft:      #faf3eb;  /* lightest rule */
  --pt-grid-bg:        #ffffff;  /* grid surface — slightly cleaner than page */
  --pt-grid-rule:      #f5e6d3;
  --pt-grid-text:      #1c1917;
  --pt-grid-dim:       #a8a29e;
  --pt-drawer-bg:      #1e293b;  /* drawer slab — dark counterpoint */
  --pt-drawer-text:    #fbbf24;  /* warm amber on slab */
}
```

Tokens replace the current `@pretable/ui` token set. CSS variable names preserved where possible to minimize component churn.

Dark mode is **out of scope** for this redesign. Light mode is the default and only mode shipped now; dark mode can be a follow-up after the redesign lands.

## Motifs

### B · Trail-map difficulty markers

Used on:

- **Comparison table** — each adapter row gets a trail marker. `pretable` = green-circle (recommended path), `ag-grid` = blue-square (familiar but slower), `tanstack` = black-diamond (powerful but DIY), `mui-x` = double-black-diamond with caution chevron (broken at scale)
- **Features cards** — green / blue / black-diamond by complexity
- **/docs** sections — same convention as `apps/website/app/docs/`

Markers as inline SVG:

```jsx
<TrailMarker variant="green" />     /* circle */
<TrailMarker variant="blue" />      /* square */
<TrailMarker variant="black" />     /* diamond, single */
<TrailMarker variant="double-black" /> /* diamond, double */
```

### C · Alpine type + alpenglow gradient

Type stack stays where it is (Fraunces / Inter / JetBrains Mono — already loaded), but used more deliberately:

- **H1 hero text overlay**: **off by default in this redesign**. The streaming grid + top-bar metadata + drawer handle do the heavy lifting. If we later decide the cold-open feels too sparse, we can add a Fraunces line (italic accent on the wedge word) above the top bar; for now it's deliberately absent so the grid is the sole headline.
- **Section headings** in drawer: Fraunces 36-44px, italic accent words in `--pt-accent`
- **Body copy**: Inter, 17px, line-height 1.55
- **Code + data + eyebrow labels**: JetBrains Mono Variable

Alpenglow gradient: subtle warm-to-peach gradient (`linear-gradient(135deg, #fff8f1 0%, #fef3e2 50%, #fde0c0 100%)`) used on:

- The drawer-open background (so the drawer reads warmer than the cool grid)
- Hover states on CTAs
- Dividers between drawer sections

### D · Mountain silhouette + chairlift

Single hero-of-the-footer composition. Layered Cascade silhouette (Mt. Bachelor / Three Sisters style — abstract, not literal) with a thin chairlift cable suspended above carrying two amber chairs. Used:

- **Page footer only** — once per page, deliberate
- Hand-drawn SVG, not photo. Two-tone fill (`#fde0c0` + `#f5e6d3`) on the alpenglow gradient.
- Small caption: "Built in Bend, OR." centered below the silhouette in JetBrains Mono 11px.

NOT used:

- No mountain or ski elements anywhere else. The silhouette is a once-per-page moment, not a repeating decoration.

## Components touched

```
apps/website/app/page.tsx                       — restructured to new layout
apps/website/app/components/Hero.tsx            — DELETE (replaced by streaming grid)
apps/website/app/components/PlaygroundSection.tsx — REPLACED by HeroGrid (new)
apps/website/app/components/HeroGrid.tsx        — NEW (streaming demo)
apps/website/app/components/Drawer.tsx          — NEW (drawer mechanism)
apps/website/app/components/DrawerHandle.tsx    — NEW (button at bottom of hero)
apps/website/app/components/TrailMarker.tsx     — NEW (SVG marker, 4 variants)
apps/website/app/components/MountainFooter.tsx  — NEW (Cascade silhouette + chairlift)
apps/website/app/components/PositioningStrip.tsx — DELETE (merged into ReceiptsBand)
apps/website/app/components/Problem.tsx         — DELETE (merged into ReceiptsBand)
apps/website/app/components/UseCases.tsx        — DELETE (merged into FeatureGrid)
apps/website/app/components/TrustStrip.tsx      — DELETE
apps/website/app/components/ReceiptsBand.tsx    — UPDATE (consolidate positioning + problem into 4 stat cards + 1 problem callout)
apps/website/app/components/ComparisonTable.tsx — UPDATE (add trail markers per adapter row)
apps/website/app/components/FeatureGrid.tsx     — UPDATE (reduce to 4 cards, add trail markers)
apps/website/app/components/HowItWorks.tsx      — minor visual update for new palette
apps/website/app/components/CodeExample.tsx     — minor visual update for new palette
apps/website/app/components/CtaSection.tsx      — sharpen to single primary CTA
apps/website/app/components/RouteAwareNav.tsx   — UPDATE (top-bar shape over hero)
apps/website/app/components/LandingAmbient.tsx  — DELETE (ambient blob system replaced by alpenglow gradient)
apps/website/app/components/AmbientBlob.tsx     — DELETE
apps/website/app/components/ScrollReveal.tsx    — REUSE (still applies to drawer-internal sections)
apps/website/app/globals.css                    — REWRITE token block to Alpenglow values
packages/ui/src/tokens.css                      — UPDATE source-of-truth token values
apps/website/e2e/smoke.spec.ts                  — UPDATE selectors that depend on Hero / removed components
apps/website/__tests__/                         — UPDATE removed-component tests, add HeroGrid + Drawer tests
```

Net: 5 components deleted, 4 created, 6 updated, 2 reused as-is.

## Hero grid implementation notes

Reuses the existing `@pretable-internal/react-surface` package — same `<PretableSurface>` plus telemetry hooks the bench depends on. No engine changes; this is pure consumer-side composition.

Streaming source: a static JSON event log (~30s loop, baked into the bundle as a JSON asset) replayed at 1,000 events/sec. The replay engine already exists at `packages/stream-adapter/src/replay.ts` (or similar — confirm during plan phase). If we don't have a replay primitive, write a small one in `apps/website/app/components/heroGrid/replay.ts` that schedules `applyTransaction({ insert })` calls via RAF.

Pausing: a single boolean state in the HeroGrid component. `useHover()` reads pointer events on the grid container; `useReducedMotion()` reads media query.

## Accessibility

- Drawer handle has `aria-expanded` reflecting state, `aria-controls="drawer-content"`
- Drawer content has `role="region"` and `aria-label="More about pretable"`
- Drawer close button has `aria-label="Close"`
- Esc closes drawer (keyboard parity with click-outside)
- Focus management: opening drawer moves focus to drawer header; closing returns focus to handle
- All animations respect `prefers-reduced-motion: reduce`
- Streaming grid pauses on focus-within so screen readers can read rows

## SEO / Progressive enhancement

- All marketing content is server-rendered (Next.js RSC) and visible to crawlers without JS
- `<title>` and `<meta>` unchanged from today
- OG image regenerates from a static screenshot of the grid hero — separate task, not in this redesign
- `prefers-reduced-motion`: drawer toggles instantly (no slide), grid shows a static snapshot (no streaming)
- `prefers-color-scheme: dark` is **ignored** for now (light-only); document this as a known limitation

## Out of scope

- Dark mode (light-only initially; dark mode is a follow-up)
- Mobile-specific drawer overlay (option B mobile path) — additive enhancement later if needed
- "Bring your own data" hero (option 4 from grid behavior) — phase 2
- /docs redesign — uses the same palette + trail markers but is its own scoped redesign
- Footer beyond the mountain silhouette + Built-in-Bend caption (no link grid, no copyright bar — yet)
- Internationalization — copy is English-only; i18n is a future concern
- Newsletter signup, blog, changelog page — separate routes, separate work
