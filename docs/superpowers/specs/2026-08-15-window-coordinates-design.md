# Windowed scroll coordinates — design

**Status:** drafted 2026-08-14, pending #412 merging.

## The defect

A windowed grid at any nonzero dataset offset renders **blank**, and its telemetry reports **zero visible rows**. Both from one cause.

`row-layout-controller.ts` keeps its `scrollTop` in **loaded-window-local** coordinates. `planViewport` returns **global** values — `totalHeight = leading + loaded + trailing`, and each row's `top = leading + offset`. The controller bridges these by adding `leadingHeight` on the way into `planViewport` (line ~672) so that function's internal subtraction cancels out.

That bridge is correct _inside_ `prepareWindow`. It is wrong everywhere the two systems meet outside it:

| Crossing  | File                                 | What happens                                                                      |
| --------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| DOM read  | `pretable-surface.tsx:3921`, `:4348` | `el.scrollTop` is **global**; consumed as local                                   |
| DOM write | `pretable-surface.tsx:2510`, `:3939` | a **local** value written to a global `el.scrollTop`                              |
| Clamp     | `row-layout-controller.ts:619`       | clamps to the **loaded** rows' height (~2,000px) against a ~480,000px content div |
| Telemetry | `pretable-surface.tsx:2538`, `:2543` | compares **local** `viewport.scrollTop` against **global** `row.top`              |
| Reveal    | `pretable-surface.tsx:2720`          | same mixing                                                                       |

Measured at `?windowed=1&windowStart=5000`: first row `top: 240000px`, viewport at y≈16–416, and no scroll position puts any row inside the viewport rect. `viewportRows` filters to empty, so telemetry reports nothing visible.

At `windowStart = 0`, `leadingHeight` is 0 and the two systems coincide — which is why every existing test passes.

## Decision

**One published coordinate system: global.**

The controller's _published_ `viewport.scrollTop` must be in the same space as its _published_ row `top` values. Consumers compare those two constantly; a snapshot that mixes them is not a thing a caller can use correctly, and the telemetry bug proves callers already get it wrong.

Internally, `state.rowHeights` is a `RowHeightIndex` over the **loaded rows only** — `getIndexForOffset`, `captureAnchor` and `restoreAnchor` all take local offsets. That stays. The controller keeps exactly **one** named conversion where it indexes into that structure, rather than an implicit assumption spread across boundaries.

Rejected alternatives:

- **Convert only at the DOM boundary, keep publishing local.** Fixes the paint, leaves telemetry broken, and preserves the implicit split that caused this. It treats the symptom that was noticed.
- **Real spacer elements.** Conceptually cleanest — rows stay local inside offset containers and the browser does the arithmetic — but the largest structural change, and it needs checking against pinned columns and the existing `contain:content` constraints. Not warranted for a bug fix.

## What must be true afterwards

1. `clampScrollTop` clamps against the **global** extent, so the whole dataset is reachable.
2. A row's client rect **intersects** the scroll viewport's rect at representative scroll positions, for a window at a nonzero offset.
3. `viewportRows` is non-empty and names the rows actually on screen.
4. `windowStart = 0` behaviour is unchanged — it is the case that already worked.
5. Anchoring still holds a row's on-screen position across a rebuild (`eviction-anchor.test.ts` must stay green unmodified).

## Why the existing gate missed it

`windowed-data.spec.ts` asserts `aria-rowindex`, `scrollHeight`, and which rows are mounted. All are true of rows that exist but sit outside the viewport. It used `toBeVisible()` — **DOM** visibility, not viewport intersection.

Every new assertion here must be geometric: compare `getBoundingClientRect()` against the scroll viewport's rect. A test that only reads attributes or `style.top` reproduces the original blind spot.

## Follow-on

`apps/bench/tests/eviction.spec.ts` drives `dispatchEvent("click")` because a real pointer cannot reach the rows today. Once this lands, revert it to `locator.click()` — that restores it to testing what a user actually does, and it becomes a second, independent check that the fix worked.
