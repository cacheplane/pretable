/**
 * The tool panel's section contract — the seam between the shell (rail +
 * pane, this directory) and the sections that live inside it (columns today;
 * SP2 and SP3 add theirs by appending a descriptor, not by touching the
 * shell).
 *
 * Internal on purpose: consumers configure the panel through the surface's
 * config types, and the surface constructs these descriptors. The eventual
 * composable story — consumer-supplied sections — will widen this contract,
 * which is exactly why the shell must already treat it as data it does not
 * understand.
 */
import type { ComponentType, ReactNode } from "react";

/**
 * Section ids are a closed union today; SP3 completed it with "grouping".
 * Nothing in the shell may assume the union is closed at runtime — the
 * future composable story widens this to consumer-supplied ids.
 *
 * The one public export of this directory: {@link PretableToolPanelConfig}
 * addresses sections by id, so the id vocabulary is API even while the
 * descriptor machinery stays internal.
 *
 * @public
 */
export type ToolPanelSectionId = "columns" | "filters" | "grouping";

export interface ToolPanelSectionDescriptor {
  readonly id: ToolPanelSectionId;
  readonly icon: ComponentType<{ className?: string }>;
  readonly label: string;
  /** Props are baked in by the surface when it constructs descriptors —
   * the shell renders sections without knowing what they need. */
  readonly render: () => ReactNode;
}
