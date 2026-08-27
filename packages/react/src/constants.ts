import { GROUP_COLUMN_ID } from "@pretable/core";

/**
 * Reserved column id for the synthetic row-select checkbox column.
 * Internal — surface authors shouldn't reference this directly.
 *
 * @internal
 */
export const ROW_SELECT_COLUMN_ID = "__pretable_row_select__";

/**
 * Height of the drag-to-group panel when the theme does not resolve
 * `--pretable-group-panel-height`. The panel's height is layout math the
 * surface has to know in JS (it is subtracted from `viewportHeight`), so it is
 * read from the token and falls back here, exactly like the header height.
 *
 * @internal
 */
export const GROUP_PANEL_HEIGHT = 36;

/**
 * True for a column the grid draws but the clipboard must not carry: the
 * synthetic row-select checkbox and the derived group column.
 *
 * The clipboard is a *spreadsheet interchange* format. Excel and Google Sheets
 * hand us N values for the N data columns a user can see; a synthetic column
 * occupying a paste slot tiles those N values across N+1 targets, so the first
 * value lands in a column nothing can be written to and every other value
 * shifts one column right.
 *
 * Copy, CSV and paste must agree on this predicate exactly. They span the same
 * column space in opposite directions, so a column dropped from one side alone
 * shifts every value by one on the way back through the other.
 *
 * @internal
 */
export function isSyntheticColumnId(id: string): boolean {
  return id === ROW_SELECT_COLUMN_ID || id === GROUP_COLUMN_ID;
}
