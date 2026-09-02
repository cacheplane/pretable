# Homepage section: when the data goes bad

Date: 2026-09-02
Status: approved, ready for planning

## Purpose

Demo the rejected-writes API (PR #564) on the homepage: a bad server page no
longer blanks the grid — the grid keeps the last good rows, stays interactive,
and tells the consumer's code so it can render its own banner and retry. The
banner in the demo is consumer UI built on `onRejectedWriteChange`, not
something pretable ships, and the section says so.

## Decisions (each confirmed with the user)

1. **Visitor-triggered fault injection** — a "corrupt the next server page"
   button, not an auto-loop or a with/without split screen. Agency proves the
   demo is real; auto-heal keeps it self-resetting.
2. **Trust/data-integrity framing with a small code payoff** — headline "A bad
   server page shouldn't blank your grid. *Or lie to you.*"; a ~10-line code
   strip showing the callback prop + banner conditional, lifted from the real
   component.
3. **Retry button + auto-heal fallback** — the banner carries "Refetch
   positions" (immediate clean page); an ~6s timer heals anyway so passive
   scrollers see the full transition and the section resets itself.
4. **Scenario** (settled without objection): a small portfolio-positions grid
   with streaming price ticks — consistent with the hero cockpit and the
   changelog's motivating line. Injected fault: `duplicate-row-id`.

## Placement and structure

Section `10 · when the data goes bad`, in `apps/website/app/page.tsx` between
`ColumnLayoutShowcase` and `CtaSection`, wrapped in `ScrollReveal`.

Files, following the ScaleShowcase/ScaleGrid split:

- `apps/website/app/components/RejectedWritesShowcase.tsx` — server
  component: section shell, eyebrow, headline, prose (one bad row used to
  unmount the subtree; now the grid keeps the last good rows and tells your
  code), the code strip, and the grid.
- `apps/website/app/components/showcase/RejectedWritesGrid.tsx` —
  `"use client"`, `useInView` lazy mount with a fixed-height placeholder
  (sibling pattern), then the live demo.
- `apps/website/app/components/showcase/rejectedWritesData.ts` — positions
  fixture and page generators (clean tick, corrupted page).

Code strip (shown, and matching the real wiring):

```tsx
<StaleBanner fault={rejected?.rows} onRetry={refetch} />
<PretableSurface
  rows={positions}
  onRejectedWriteChange={setRejected}
  …
/>
```

## Demo mechanics

State machine local to `RejectedWritesGrid`: `streaming → diverged →
streaming`.

- **Streaming:** ~12 position rows; a tick every ~1.5s builds a NEW rows
  array (fresh identities, drifting prices). A counter increments per SENT
  page.
- **Corrupt:** the button arms the next tick to carry a duplicate position
  id. The page is sent, the rows write rejects, `onRejectedWriteChange` fires
  with `rows: {code: "duplicate-row-id", …}`, the banner renders. The clean
  stream PAUSES while diverged — otherwise the next tick heals before the
  visitor can read anything.
- **Legibility:** a mono status line above the grid — `server sent tick 42 ·
  grid shows tick 39`. "Grid shows" is the last tick whose write LANDED
  (record null after the send), not a parallel guess. The numbers split at
  corruption and re-converge on recovery.
- **Recover:** "Refetch positions" sends a clean page immediately; an ~6s
  auto-heal timer does the same if unclicked (the button disarms the timer —
  no double send). The record clears, the banner dismisses — banner
  visibility is DRIVEN BY the record (`rejected?.rows`), never separate
  state — and the stream resumes.
- **Banner:** consumer-styled (Tailwind, site palette, subtle warning tone),
  fault code + shortened message, `role="status"`.
- **Repeat-proofing:** the corrupt button stays enabled; a second corruption
  uses a DIFFERENT duplicate id, quietly exercising "nothing latches".
- Interval cleared on unmount; `useInView` gates mount as in the sibling
  showcases. No StrictMode hazard: rows-mode `PretableSurface` owns its model
  internally.

## Testing

- **Component test**
  `apps/website/app/components/__tests__/rejected-writes-showcase.test.tsx`
  (jsdom + fake timers): corrupt → banner with `duplicate-row-id` AND the
  grid still shows pre-corruption rows (row count + one cell value pinned);
  tick counters split; Refetch → banner gone, counters re-converge; auto-heal
  path via timer advance; second corruption re-banners (no latch); and the
  banner is absent while streaming clean even as ticks advance (pins that the
  record, not the stream, drives it).
- **E2E:** extend the homepage e2e only if an existing spec already walks
  drawer sections (checked at plan time); otherwise the component test
  carries it, per the sibling precedent.
- **Code-strip drift guard:** the strip is prose-adjacent, not a docs fence
  (the docs guard does not reach homepage components); the component test
  asserts the section's rendered strip contains `onRejectedWriteChange` so
  the key line cannot silently vanish.

## Constraints

- `apps/*` may use Tailwind (packages must stay vanilla CSS — not relevant
  here).
- Homepage e2e/flake context: SSR'd controls are inert until
  `data-pretable-hydrated`; any e2e added must gate on it.
- Website tests: `pnpm test` in `apps/website`; e2e needs the built server
  and `--workers=1` locally.
