/** Barrel for the tool panel shell. Mostly internal; the exceptions are the
 * `Pretable`-prefixed section types (public since SP4, re-exported through
 * `public_api.ts` beside `ToolPanelSectionId`). */
export { ToolPanel, type ToolPanelProps } from "./ToolPanel";
export {
  ColumnsSection,
  type ColumnsSectionGrid,
  type ColumnsSectionProps,
} from "./ColumnsSection";
export { Rail, type ToolPanelRailProps } from "./Rail";
export type {
  PretableToolPanelSection,
  PretableToolPanelSectionId,
  ToolPanelSectionDescriptor,
  ToolPanelSectionId,
} from "./sections";
export { resolveToolPanelRoster } from "./roster";
