/**
 * Pure list surgery behind the group panel.
 *
 * Both the pointer paths (drag a header in, drag a chip along) and the
 * keyboard paths (Shift+arrow, Delete) reduce to exactly one of these
 * functions followed by a single `grid.setRowGroups`. They live apart from the
 * component so the two never drift and so they can be tested without a DOM —
 * jsdom would add nothing to a question about arrays.
 *
 * Every helper returns the ORIGINAL array reference when the operation changes
 * nothing. `setRowGroups` is change-guarded anyway, but an identity result lets
 * a caller skip the call — and lets a test say "this was a no-op" precisely.
 *
 * @internal
 */

/** Default for `groupPanel.emptyMessage`. */
export const DEFAULT_GROUP_PANEL_EMPTY_MESSAGE =
  "Drag a column here to group by it";

/**
 * Move the level at `from` to `to`.
 *
 * An out-of-range index on EITHER end is a no-op rather than a clamp. `to`
 * comes from the keyboard model — `Shift+ArrowLeft` on the first chip asks for
 * index -1 — where "there is nowhere further to go" must mean stay put, not
 * wrap around and not pile up at the end.
 */
export function moveGroupLevel(
  rowGroups: readonly string[],
  from: number,
  to: number,
): readonly string[] {
  if (!inRange(from, rowGroups.length) || !inRange(to, rowGroups.length)) {
    return rowGroups;
  }
  if (from === to) return rowGroups;

  const next = [...rowGroups];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Drop the level at `index`. Out of range is a no-op. */
export function removeGroupLevel(
  rowGroups: readonly string[],
  index: number,
): readonly string[] {
  if (!inRange(index, rowGroups.length)) return rowGroups;

  return rowGroups.filter((_, i) => i !== index);
}

/**
 * Put `columnId` at grouping level `index`.
 *
 * Unlike {@link moveGroupLevel} the index is CLAMPED, because it comes from a
 * drop position: releasing past the last chip legitimately means "append", and
 * refusing that would make the far half of the panel a dead zone.
 *
 * A column already in the list is moved rather than duplicated — with
 * `hideGroupedColumns: false` a grouped column still has a draggable header,
 * and the engine would silently dedupe a second copy (`sanitizeRowGroups`),
 * leaving the panel showing something the user did not ask for.
 */
export function insertGroupLevel(
  rowGroups: readonly string[],
  columnId: string,
  index: number,
): readonly string[] {
  const without = rowGroups.filter((id) => id !== columnId);
  const at = Math.max(0, Math.min(index, without.length));
  const next = [...without.slice(0, at), columnId, ...without.slice(at)];

  return listsEqual(next, rowGroups) ? rowGroups : next;
}

/**
 * The chip's accessible name: the column, where it sits in the grouping order,
 * and what the keyboard can do to it.
 *
 * The chip's visible text is `aria-hidden` and this name carries it instead, so
 * a screen reader reads the column once — and reaches the key hints at all,
 * which a name assembled from the visible content could never include.
 */
export function composeChipAccessibleName(
  label: string,
  position: number,
  total: number,
): string {
  return (
    `${label}, grouping level ${position} of ${total}. ` +
    "Left and Right arrow move focus, Shift with an arrow reorders, " +
    "Delete removes."
  );
}

function inRange(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

function listsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
