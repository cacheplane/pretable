import type { PretableCellAddress } from "@pretable/core";

/**
 * Resolves which cell the pointer is physically over during a marquee
 * cell-range drag, without trusting event targeting.
 *
 * The anchor cell (where the drag started) calls `setPointerCapture` on
 * `pointerdown` so a drag that ends outside the grid still delivers
 * `pointerup`. Per the Pointer Events spec, capture retargets subsequent
 * pointer events to the capturing element — confirmed by instrumenting a real
 * drag, which showed `pointermove.target` reporting the anchor 10/10 times
 * while the cursor was physically over other rows. A handler wired to
 * `pointerenter` on the hovered cell therefore never fires in a real browser;
 * it only ever worked in jsdom, which does not implement capture retargeting
 * at all (see `packages/react/src/__tests__/row-activation.test.tsx`).
 *
 * The fix keeps capture — dropping it would trade "range never grows" for
 * "drag never ends when released outside the grid" — and instead asks the DOM
 * what is under the pointer on every `pointermove`, via
 * `document.elementFromPoint`. That call is split from the address mapping on
 * purpose: jsdom's `document` has no `elementFromPoint` at all (not even a
 * stubbed one), so it stays a one-line, deliberately untestable wrapper
 * ({@link cellAddressFromPoint}), while the part that IS pure DOM
 * traversal — mapping a hit-tested element back to a `{ rowId, columnId }`
 * pair — lives in {@link cellAddressFromElement} where a jsdom-built tree can
 * exercise it directly. The real cross-browser proof that this resolves
 * correctly under actual pointer capture is
 * `apps/website/e2e/range-selection.spec.ts`, driven with real
 * `page.mouse` events in both Chromium and WebKit.
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

/**
 * The cell address under `(clientX, clientY)`, or `null` if the point is not
 * over a body cell (including "not over the document at all", which happens
 * when a drag runs past the window edge — auto-scroll on that condition does
 * not exist yet).
 *
 * Deliberately not unit-tested: jsdom's `document` has no `elementFromPoint`
 * at all, so a test of this function would have to fabricate the one thing it
 * exists to call. See the module doc for where the real coverage lives.
 */
export function cellAddressFromPoint(
  clientX: number,
  clientY: number,
): PretableCellAddress | null {
  return cellAddressFromElement(document.elementFromPoint(clientX, clientY));
}
