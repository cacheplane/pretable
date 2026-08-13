import type { PretableCellAddress } from "@pretable/core";

/**
 * Resolves which cell the pointer is physically over during a marquee
 * cell-range drag.
 *
 * Two earlier designs both kept `setPointerCapture` on the anchor cell and
 * tried to work around what capture does to event targeting:
 *
 * 1. The original wired range extension to `pointerenter` on each cell.
 *    Capture retargets every subsequent pointer event to the capturing
 *    element, so `pointerenter` never fires on any cell but the anchor in a
 *    real browser — the range never grew past the start cell.
 * 2. The first fix kept capture but resolved the hovered cell via
 *    `pointermove` + `document.elementFromPoint(event.clientX, event.clientY)`
 *    instead of trusting `event.target`. That passed locally and in CI's
 *    Chromium, but CI's Linux WebKit still failed identically — selecting
 *    only the anchor cell. Local WebKit (macOS) could not reproduce the
 *    failure either before or after that fix, so it never validated the
 *    change; only CI's Linux WebKit exercises the failure at all.
 *
 * That second failure means the bug is not (only) about which API resolves
 * the hovered cell — it is that this code depended on `setPointerCapture`
 * behaving the same way across engines and platforms in the first place.
 * Coordinate-based hit-testing still requires capture to have engaged the
 * way Chromium engages it, and CI's headless Linux WebKit is the one
 * environment available that disagrees. Rather than add a third
 * capture-based theory with no way to verify it against that environment
 * locally, this drops `setPointerCapture` for the multi-cell range drag
 * entirely and uses the engine-agnostic pattern for drags that cross
 * element boundaries: attach `pointermove`/`pointerup`/`pointercancel`
 * listeners to `window` on `pointerdown`, and remove them when the drag
 * ends (see the cell's `onPointerDown` in `pretable-surface.tsx`).
 *
 * Two things fall out of that:
 *
 * - `window` listeners receive pointer events regardless of capture, so a
 *   drag that ends outside the grid (the original reason capture was
 *   introduced) still delivers `pointerup` — arguably more reliably, since
 *   it fires even outside the document body.
 * - With no capture in play, `event.target` on those listeners is the real,
 *   normally-hit-tested element under the pointer. `cellAddressFromElement`
 *   below can walk it directly with `closest`; there is no need to ask the
 *   DOM what is at a coordinate via `document.elementFromPoint`, and no
 *   engine-specific capture-engagement behavior to depend on.
 *
 * `event.target` bubbling to `window` the normal way is also why this is
 * exercisable in jsdom: `packages/react/src/__tests__/row-activation.test.tsx`
 * fires a real `pointermove` on the target cell and lets it bubble, no
 * `elementFromPoint` stub required. The claim jsdom cannot make — that this
 * resolves correctly under a real browser's actual hit-testing, in both
 * Chromium and Linux WebKit — is `apps/website/e2e/range-selection.spec.ts`.
 *
 * @internal
 */

/**
 * Maps a hit-tested DOM element to the cell address it belongs to, or `null`
 * if it is not inside a body cell.
 *
 * Walks up to the nearest `[data-pretable-cell]` for the column id, then up
 * again to the nearest `[data-pretable-row-id]` for the row id — the same two
 * data attributes `apps/website/e2e/helpers.ts`'s `columnSelectors` already
 * uses to address cells from Playwright, so this reads the DOM the same way
 * the test suite does rather than inventing a parallel addressing scheme.
 */
export function cellAddressFromElement(
  el: Element | null,
): PretableCellAddress | null {
  const cell = el?.closest("[data-pretable-cell]");
  if (!cell) return null;

  const columnId = cell.getAttribute("data-pretable-column-id");
  if (!columnId) return null;

  const row = cell.closest("[data-pretable-row-id]");
  const rowId = row?.getAttribute("data-pretable-row-id");
  if (!rowId) return null;

  return { rowId, columnId };
}
