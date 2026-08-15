# Windowed scroll coordinates — implementation plan

**Goal:** A windowed grid at a nonzero dataset offset shows its loaded rows on screen, and reports them in telemetry.

**Approach:** Publish one coordinate system — global. Keep `RowHeightIndex` local, reached through a single named conversion.

**Spec:** `window-coordinates-spec.md`

---

## Task 0: A failing browser test, FIRST

**File:** `apps/bench/tests/windowed-data.spec.ts` (extend) — do **not** start in `renderer-dom`.

The bug is invisible to every existing assertion, so the first job is an assertion that can see it. Write it before touching any production code and watch it fail.

At `?windowed=1&windowStart=5000`, assert that at least one `[data-pretable-row]`'s `getBoundingClientRect()` **intersects** the `[data-pretable-scroll-viewport]` rect.

```
const r = row.getBoundingClientRect(), v = viewport.getBoundingClientRect();
const intersects = r.bottom > v.top && r.top < v.bottom;
```

**Do not use `toBeVisible()`.** It is DOM visibility — not `display:none`, non-zero box — and it passes on a grid whose rows sit 240,000px below the fold. That is exactly how this shipped.

Expected: **fails today.** If it passes, stop and report — the diagnosis is wrong and everything below is built on it.

Add a second failing assertion in the same run: `onTelemetryChange`'s `viewportRows` is non-empty. Both come from one cause and both must go green together.

## Task 1: Clamp against the global extent

`clampScrollTop` (`packages/renderer-dom/src/row-layout-controller.ts:619`) clamps to `root.getTotalHeight() - viewportHeight`, where `root` covers **loaded rows only** — a ~2,000px ceiling against a ~480,000px content div.

It must clamp against the global extent: `leadingHeight + root.getTotalHeight() + trailingHeight`. Note it currently takes `root` and derives the height itself; it will need the spacer heights, which `prepareWindow` already computes at `:650-657`.

## Task 2: Publish a global `scrollTop`

`prepareWindow` returns `scrollTop: clampedScrollTop` (`:741`) — local. Every consumer of `snapshot.viewport.scrollTop` compares it against global row tops.

Publish global. Then **audit every reader** and confirm each one wants global:

- `pretable-surface.tsx:2538, 2543` — telemetry `viewportRows`. Wants global. Currently broken.
- `pretable-surface.tsx:2720` — reveal math. Check.
- `pretable-surface.tsx:2510, 3939` — writes to `el.scrollTop`. The DOM is global, so a global value is now correct directly.
- `pretable-surface.tsx:3921, 4348` — reads of `el.scrollTop` into the controller. Global in, global consumed. Correct once the controller is global.
- `pretable-model.ts:756, 803` — check.

The internal uses that must stay **local**, because `state.rowHeights` only knows loaded rows:

- `captureAnchor` (`:797-798`) — `getIndexForOffset(state.scrollTop)` and `captureAnchor(index, state.scrollTop)`
- anything else indexing `state.rowHeights` by offset

Introduce one named helper for the crossing — e.g. `toLocalOffset(globalScrollTop)` / `toGlobalScrollTop(localOffset)` — and route every conversion through it. **No bare `± leadingHeight` at a call site.** That is the pattern that produced this bug and the point of choosing this approach over patching the boundary.

## Task 3: `planViewport` no longer needs the pre-shift

With the controller global, `scrollTop: clampedScrollTop + leadingHeight` at `:672` becomes `scrollTop: clampedScrollTop`, and the comment at `:665-671` — which asserts the now-false invariant that the controller stays local — must be rewritten to describe what is actually true.

Leave `planViewport` itself alone. It is correct and `layout-core`'s tests pin it.

## Task 4: Prove it discriminates

Revert Task 1's clamp alone and confirm the intersection test reddens. Then revert Task 2 alone and confirm the telemetry assertion reddens. Report both verbatim.

Two separate mutations because they are two separate user-visible failures; a single mutation that reddens both would not show that each fix carries its own weight.

## Task 5: Regression surface

- `windowStart = 0` must be unchanged — the case that already worked, and the control proving the fix is about the offset rather than about windowing generally.
- `packages/layout-core/src/__tests__/eviction-anchor.test.ts` must stay green **unmodified**. If anchoring breaks, the conversion is in the wrong place.
- Baselines: grid-core 87, layout-core 93, react 1140/75, bench 12.
- Full `playwright test`, not just the one spec — scroll geometry is shared.

## Task 6: Restore the real pointer

`apps/bench/tests/eviction.spec.ts` drives `dispatchEvent("click")` because a pointer cannot reach the rows today. Revert to `locator.click()`.

This is a **verification step, not cleanup**: a real click can only land if the coordinates are right, so it is an independent confirmation of the fix. If it flakes or times out, the fix is incomplete — investigate rather than reverting to synthetic events.

## Task 7: Changeset + API check

`pnpm build && pnpm api` (in that order — a stale `dist/` silently strips exports), then `pnpm api:check`. Patch-level unless the published `viewport.scrollTop` meaning is judged a breaking contract change for telemetry consumers — decide deliberately and say which.
