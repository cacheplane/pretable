/**
 * The width a column draws at when nothing declares one — the single source
 * of truth for every layer that needs a fallback width.
 *
 * DECIDED 2026-08-30 (auto-width cleanup): these numbers used to live in two
 * places that disagreed — renderer-dom drew undeclared columns at 140px
 * (220px wrapped) while grid-core STORED 160px for the same columns — so
 * turning auto width off on a never-resized column visibly jumped 140→160.
 * 140 won because it is the number every undeclared-width column has always
 * actually painted at (the renderer's fallback); moving the renderer to 160
 * instead would have re-painted every example, bench scenario, and docs
 * fixture that leaves widths undeclared. grid-core imports
 * {@link DEFAULT_COLUMN_WIDTH_PX} for its stored default, renderer-dom
 * resolves both through `resolveColumnWidth`, and @pretable/react seeds the
 * engine through that same resolver — one home, three consumers, no jump.
 */
export const DEFAULT_COLUMN_WIDTH_PX = 140;

/**
 * The undeclared-width fallback for a `wrap: "text"` column. Wrapped cells
 * trade height for width, so their default is wider than
 * {@link DEFAULT_COLUMN_WIDTH_PX} — see that constant's decision note for
 * why these two numbers are the only copies.
 */
export const DEFAULT_WRAPPED_COLUMN_WIDTH_PX = 220;
