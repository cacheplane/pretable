/** Id of the synthetic visual column that carries grouped row labels. @public */
export const GROUP_COLUMN_ID = "__pretable_group__";

/** Presentation options for the synthetic grouped-row column. @public */
export interface PretableGroupColumnOptions {
  /** Header text. Defaults to the first grouped column's header. */
  header?: string;
  /** Column width. Defaults to 200 pixels. */
  widthPx?: number;
  /** Pin the group column to the left. */
  pinned?: "left";
}
