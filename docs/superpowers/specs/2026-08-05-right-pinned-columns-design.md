# Right-pinned columns — design (P1 sub-project 2 of 3)

**Date:** 2026-08-05
**Branch:** `claude/right-pin` (off `main` after #197)
**Status:** approved (design confirmed in-session)

## Context

Pinning is left-only, end to end: `pinned?: "left"` on `PretableColumn`
(`grid-core/src/types.ts`), `setColumnPinned(columnId, "left" | null)`, controlled
`columnPinned: Record<string, "left" | null>`, `planColumns` splitting columns into a
pinned bucket + a virtualized scrollable bucket (`layout-core/src/column-plan.ts`),
`pinnedLeft`/`pinnedLeftWidth` in the renderer (`renderer-dom/src/create-renderer.ts`),
~26 sticky-left sites in `pretable-surface.tsx`, and one
`[data-pretable-pinned="left"]` CSS rule.

Right-pinning is the second P1 gap (order: multi-sort ✅ #196 → right-pin → paste).
This is a **widening**, not a replacement: `"left"` keeps working unchanged.

## Decision (locked in brainstorm)

**Config/API-only.** Extend `pinned` to `"left" | "right"` across the same surface
left-pin already has. **No interactive pin/unpin affordance** — that belongs with a
future general header menu / advanced panel, not invented ad hoc here.

## Goal

`pinned: "right"` columns stick to the right edge of the viewport, mirroring left-pin:
always rendered (never virtualized away), correct offsets under horizontal scroll,
correct z-index layering, and identical behavior for cells, header buttons, resize
handles, and filter-funnel slots.

## Model

- `PretableColumn.pinned?: "left" | "right"` (widen).
- `setColumnPinned(columnId: string, pinned: "left" | "right" | null): void`.
- `PretableSurfaceState.columnPinned?: Record<string, "left" | "right" | null>`.
- `PlannedColumn` gains `right?: number` — the offset from the viewport's right edge,
  set only for right-pinned columns (left-pinned/scrollable keep using `left`).
- `ColumnPlan` gains `pinnedRightWidth: number`.

Ordering: right-pinned columns render as a group at the **end** of the visual order,
in their relative column order (mirror of left-pinned at the start). `totalWidth`
is unchanged in meaning (sum of all column widths).

## Layout (`layout-core/src/column-plan.ts` — the load-bearing change)

`planColumns` currently buckets into `pinned` (left) + `scrollable`, then binary-searches
the scrollable window against `scrollLeft`/`viewportWidth`. Changes:

1. Three buckets: `pinnedLeft`, `scrollable`, `pinnedRight`. Accumulate
   `pinnedLeftWidth` and `pinnedRightWidth`; scrollable `left` offsets are unaffected
   by right-pinned columns (they're removed from the scroll flow, exactly like
   left-pinned ones are today).
2. Right-pinned entries get `right` = accumulated width of right-pinned columns that
   come _after_ them (so the last right-pinned column sits flush at `right: 0`), and
   `pinned: "right"`. They are always emitted, never virtualized.
3. The visible scrollable window shrinks by **both** pinned widths: the effective
   viewport for the binary search is `viewportWidth - pinnedLeftWidth - pinnedRightWidth`
   (today it only accounts for left). This is the subtle correctness fix — without it,
   columns hidden behind the right-pinned group would be considered visible.
4. Returned column order: `[...pinnedLeft, ...visibleScrollable, ...pinnedRight]`.
5. Degenerate cases: all columns pinned (scrollable empty) → return left + right groups;
   pinned widths exceeding the viewport → clamp the scrollable window to zero rather
   than producing negative widths.

`renderer-dom/src/create-renderer.ts`: pass right-pinned columns into the viewport plan
where it passes `pinnedLeft` today (if row planning needs it), forward
`pinnedRightWidth`, and preserve `pinned` on the no-viewportWidth fallback path.

## Surface (`react/src/pretable-surface.tsx`)

Every existing sticky-left site gets a mirrored right branch (grep `pinnedOffset`):
body cells, header buttons, resize handles, and filter-funnel slots. Where today it
computes `{ position: "sticky", left: pinnedOffset + …, zIndex: … }`, right-pinned
columns compute `{ position: "sticky", right: plannedCol.right + …, zIndex: … }` with
the same z-index tier. `data-pretable-pinned="right"` is emitted on those elements.

Resize/reorder interplay: match whatever left-pin does today (the implementer verifies
and mirrors — e.g. the resize handle's sticky offset and the reorder drop-index
boundary). No new interaction rules are invented.

## Styling (`@pretable/ui/grid.css`)

Mirror the single existing rule:

```css
:where([data-pretable-cell][data-pretable-pinned="right"]) { … }
```

same background/z-index treatment as the left rule (opposite border side). No new tokens.

## Demo + docs

- **Showcase**: the column-layout showcase grid (`apps/website/app/components/showcase/
columnLayoutData.ts`) pins one column right (config-only) so the feature is visible on
  the canonical demo; its RTL test asserts the pinned attribute.
- **Docs**: `/docs/grid/column-layout` gains a right-pin section; both api-reference
  pages update `pinned`, `setColumnPinned`, and the controlled `columnPinned` slice.

## Testing

- **layout-core** (`column-plan` tests): right bucket ordering + `right` offsets;
  `pinnedRightWidth`; right-pinned always present regardless of `scrollLeft`; the
  shrunken scrollable window (a column that would be visible without right-pin is
  excluded when it's behind the pinned group); all-pinned and overflowing-pinned cases.
- **grid-core**: `setColumnPinned(id, "right")` / re-pin left↔right / clear; controlled
  `columnPinned` apply.
- **renderer-dom**: plan carries `pinned: "right"` + `pinnedRightWidth`.
- **react RTL**: a right-pinned column renders with `data-pretable-pinned="right"` and a
  sticky `right` offset; its header/resize-handle/funnel overlays carry the same;
  two right-pinned columns stack in order; left+right pinned coexist.
- **website**: showcase test.
- Full sweep: `pnpm -r typecheck`/`lint`/`test`, `pnpm format`, website build, smoke,
  `pnpm api` (regen — `pinned` widening changes the reports — then second-run no-op).

## Risks

- **Virtualization math** (item 3 above) is the easy thing to get wrong and the reason
  layout-core tests lead. A regression here shows as columns missing near the right edge.
- **Sticky-site coverage**: missing one of the ~26 sites yields a visually detached
  overlay (e.g. a funnel that scrolls away from its header). Mitigated by grepping
  `pinnedOffset` exhaustively and an RTL test per overlay kind.
- **`pnpm api`** is a required gate; the `pinned` widening touches core + react reports.

## Out of scope

Any pin/unpin UI affordance; pinning rows; `pinned` on the row-selection column beyond
what it already does; paste (next sub-project).
