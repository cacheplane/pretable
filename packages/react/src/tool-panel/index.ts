/** Internal barrel for the tool panel shell. Nothing here is public API —
 * Task 6 wires the surface's config types through `public_api.ts`. */
export { ToolPanel, type ToolPanelProps } from "./ToolPanel";
export {
  ColumnsSection,
  type ColumnsSectionGrid,
  type ColumnsSectionProps,
} from "./ColumnsSection";
export { Rail, type ToolPanelRailProps } from "./Rail";
export type {
  ToolPanelSectionDescriptor,
  ToolPanelSectionId,
} from "./sections";
