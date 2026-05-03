# Website Bucket B — Hero restoration + grid framing

Date: 2026-05-03
Status: design (pre-implementation)

## Background

Bucket A (PR #68 + PR #70) shipped concrete fixes. Bucket B is the biggest IA decision in the landing-page review: restore the text-heavy positioning hero from before PR #62 (grid-as-hero), but keep the current drawer-takeover architecture. The streaming grid stays the visible product showcase outside the drawer; the restored hero becomes the opening read once the drawer opens.

Bucket B also re-frames the grid section itself. The current full-bleed rounded grid feels uncomfortable; the user wants a centered, framed, "window-style" treatment that fills the viewport vertically when the drawer is closed.

## Goals

1. Restore the old positioning hero — text + headline + subhead + CTAs — as the first section inside the drawer, in the current Alpenglow palette.
2. Re-order the in-drawer marketing arc so credibility cards (Performance / AI-native / Wrapped / Ecosystem) sit between the new hero and the trimmed Receipts band.
3. Re-frame the streaming grid as a window/bezel-style centered showcase that fills the viewport vertically when the drawer is closed, leaving room for a future sidebar.

## Non-goals

- Receipts visual boldness, pipeline visual treatment, code-section VS-Code tabs — Bucket C, separate spec.
- Streaming-story page + stream-adapter audit — Bucket D, separate spec.
- Drawer mechanics changes — the existing DrawerShell + DrawerHandle + useDrawer continue to drive open/closed state, hash deep-links, Esc/back, and the close behavior introduced by PR #68.

## Architecture (delta from current `main`)

### Outside the drawer (page.tsx top-level)

Unchanged shell:
```
<ControlStateProvider>
  <main>
    <HomeStreamHeader />
    <HeroGrid />            ← reframed (see Grid framing below)
  </main>
  <DrawerHandle />
  <DrawerShell>
    {drawer children — see new order}
  </DrawerShell>
</ControlStateProvider>
```

### Inside the drawer (new order)

```
<DrawerNavSlot />
<DrawerHero />              ← NEW
<CredibilityCards />        ← extracted from current ReceiptsBand
<ReceiptsBand />            ← trimmed to just the 4-stat band + methodology link
<ScrollReveal><ComparisonTable /></ScrollReveal>
<ScrollReveal><HowItWorks /></ScrollReveal>
<ScrollReveal><CodeExample /></ScrollReveal>
<ScrollReveal><FeatureGrid /></ScrollReveal>
<ScrollReveal><CtaSection /></ScrollReveal>
<MountainFooter />
```

## Components

### `<DrawerHero />` (new — `apps/website/app/components/DrawerHero.tsx`)

Restored from `Hero.tsx` at commit parent of `e0bb4f3`. Restyled to the current Alpenglow palette and updated CTA shape.

Content (verbatim from git for now; revisit in Bucket D):

- Eyebrow (mono, accent): `$ pretable — vol. 2 · no. 1`
- H1 (display, accent italic on "fastest"): *The fastest data grid for React. Built for the AI era.*
- Subhead: 60fps under streaming load. Zero row drift. A deterministic engine designed for live data, agent output, and real-time telemetry — not retrofitted from a batch-era grid.
- CTA cluster (replaces old `[See the receipts ↓] [Try it live ↓]` pair):
  - **`<CopyPromptButton />`** — copies a static AI-agent setup prompt to clipboard (see Prompt content below). Uses the same copy/copied affordance pattern as `<CopyCommand>`.
  - **`<CopyCommand command="npm install @pretable/react" />`** — existing component reused.
  - **`Read the docs →`** — text link to `/docs`.
- Footer line (mono, muted, small): `MIT licensed · open source`

Layout: centered text block, `max-w-[860px]` inside `mx-auto`, horizontal padding `px-7 md:px-10` matching adjacent drawer sections, vertical padding `py-16 md:py-24`. Sits as the first content section inside DrawerShell, below DrawerNavSlot. No AmbientBlob (the original Hero used one) — the drawer surface is already enough visual context.

#### Prompt content (copied by `<CopyPromptButton />`)

```
Help me integrate @pretable/react — a high-performance streaming data
grid — into this React app.

Before writing code, ask me:
  1. Where should the grid live? (file path, route, or component name)
  2. What's the data source? (static array, REST, streaming, LLM tokens)
  3. What columns and row shape do you expect?

Then write a step-by-step implementation plan covering: install,
columns + getRowId setup, data wiring, and any streaming adapter
(use @pretable-internal/stream-adapter for LLM / SSE sources). Wait
for my approval before implementing each step.

Docs: https://pretable.ai/docs
```

The prompt is a module-level string constant in `DrawerHero.tsx` (or a sibling `drawerHeroPrompt.ts` if it grows). No build-time generation — it's static text.

### `<CopyPromptButton />` (new — `apps/website/app/components/CopyPromptButton.tsx`)

Mirrors `CopyCommand`'s ergonomics:

- Visible label: `[ Copy prompt ]` (font-mono, accent border, transparent bg).
- On click: `navigator.clipboard.writeText(PROMPT)`, swap label to `✓ copied` for ~1.2s, then revert.
- Failure path silent (clipboard API can fail in insecure contexts).
- `cursor-pointer`, focus ring matching `CopyCommand`.
- `aria-label="Copy AI agent setup prompt"`.

Test (vitest + jsdom): renders the label, click toggles label to `✓ copied`, clipboard receives the expected first-line.

### `<CredibilityCards />` (new — `apps/website/app/components/CredibilityCards.tsx`)

Currently rendered as the second `<ul>` inside `ReceiptsBand`. Extract verbatim:

- Section eyebrow: `02 · why it works` (numbering update; current Receipts is `01`-implied, ComparisonTable is `03`).
- Same 4-card grid (Performance / AI-native / Wrapped / Ecosystem) with the existing card chrome.
- Lives between the new `<DrawerHero />` and the trimmed `<ReceiptsBand />`.

### `<ReceiptsBand />` (modified)

Removes the now-extracted credibility cards. Keeps:
- Heading (*Receipts, not claims.*)
- 4-stat band (4× / 16ms / 0 / 25k/s)
- "See them re-run in the bench →" link

Visual boldness/contrast (user comment) is **deferred to Bucket C**; this PR only does the structural extraction.

### `<HeroGrid />` (modified — reframing only, streaming logic untouched)

New framing: window/bezel container.

- Outer container: full-viewport-width band, Alpenglow gradient backdrop.
- Padding around the bezel: `px-6 md:px-10 lg:px-14`. Leaves space for a future sidebar/companion column without re-flow.
- Inner bezel: `max-w-[1400px]`, mx-auto, cream-toned chrome with rounded corners (`rounded-[14px]`), 1px outer rule (`border-rule-strong`), drop-shadow `0 12px 36px rgba(28,25,23,0.08)`. The bezel is the visible "window frame."
- Inside the bezel: the existing `PretableSurface` (no API change), with the existing `data-paused` hover behavior preserved.
- Vertical sizing: when the drawer is closed, the grid fills `calc(100vh − HomeStreamHeader.h − drawer-peek.h)` so the showcase is full-experience. When the drawer is open, the grid is dimmed (existing `html[data-drawer="open"] .hero` filter rule) and its height becomes whatever the layout flow allows.
- Implementation note: `viewportHeight` prop on `<PretableSurface>` is currently fixed at `520`. New behavior reads it from a CSS-based clamp on the wrapper rather than hard-coding the prop, OR we measure the wrapper with a `ResizeObserver` and pass the measured height in. Pick during writing-plans; the simpler clamp-via-CSS path is preferred if it works with the existing virtualization.

The existing `HomeStreamHeader` (LIGHT/PROD/HEAVY/EXTREME presets, ev/s readout) stays as a thin top strip above the grid section.

## Visual treatment / palette

All Alpenglow tokens (`packages/ui/src/tokens.css`). No new tokens added.

- Bezel chrome: `bg-bg-card` with `border-rule-strong`.
- Backdrop gradient: existing `--pt-bg-page` to `--pt-cream` linear-gradient (define a small utility class if not already present).
- DrawerHero text: `text-text-primary` for H1, `text-text-secondary` for subhead, `text-accent` for accent words.

## Tests

- Snapshot/DOM tests:
  - `DrawerHero.test.tsx` — renders eyebrow, H1, subhead, three CTAs (CopyPromptButton + CopyCommand + docs link), MIT footer line.
  - `CopyPromptButton.test.tsx` — click writes to clipboard, label toggles, accessible name correct.
  - `CredibilityCards.test.tsx` — renders all four positioning cards.
  - `ReceiptsBand.test.tsx` — updated: positioning cards no longer asserted (moved to CredibilityCards). Stats and headline still asserted.
- HeroGrid framing: existing `HeroGrid.test.tsx` covers streaming behavior; add a structural test that the wrapper has the bezel + max-width classes.
- Page-level: `page.test.tsx` (if one exists) — assert section order: HomeStreamHeader → HeroGrid → DrawerHandle → DrawerShell containing [DrawerNavSlot, DrawerHero, CredibilityCards, ReceiptsBand, ComparisonTable, HowItWorks, CodeExample, FeatureGrid, CtaSection, MountainFooter].

## Migration / breaking-change risk

None for consumers. Internal-only changes to `apps/website`. No public package APIs touched.

## Open follow-ups (out of scope this PR)

- Receipts boldness/contrast — Bucket C.
- Pipeline (HowItWorks) visual treatment — Bucket C.
- VS-Code-tab CodeExample — Bucket C.
- Streaming-story page + stream-adapter `internal` audit — Bucket D.
- DrawerHero copy revisit (lean harder on AI-era differentiator) — Bucket D as part of the streaming-story positioning pass.

## Implementation order (preview, formalized in writing-plans)

1. Add `CopyPromptButton` component + test.
2. Add `DrawerHero` component using `CopyPromptButton` + existing `CopyCommand` + `Read the docs →` link, plus tests.
3. Extract `CredibilityCards` from `ReceiptsBand` (move JSX block, add test, update ReceiptsBand test).
4. Insert `DrawerHero` and `CredibilityCards` into `page.tsx` in the new order.
5. Reframe `HeroGrid` with bezel + dynamic vertical sizing.
6. Manual Chrome smoke + viewport check.
7. Open PR.
