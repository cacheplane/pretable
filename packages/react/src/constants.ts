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
