import { useId, useRef } from "react";

import { focusTab } from "./focus";
import { Rail } from "./Rail";
import type {
  ToolPanelSectionDescriptor,
  ToolPanelSectionId,
} from "./sections";

export interface ToolPanelProps {
  sections: readonly ToolPanelSectionDescriptor[];
  /**
   * Which section is open, or `null` for rail-only. Fully controlled: the
   * shell holds no open/close state, so the surface (Task 6) can offer both
   * controlled and uncontrolled forms without this component knowing which.
   */
  activeSection: ToolPanelSectionId | null;
  onActiveSectionChange: (next: ToolPanelSectionId | null) => void;
}

/**
 * The tool panel shell: a pane and its rail, rendered as siblings in visual
 * order (pane, then rail at the outermost edge) for the parent's flex row to
 * dock against the grid's right side. No wrapper element — the surface owns
 * the layout, and a wrapper here would force it to style through one.
 *
 * The pane exists in the DOM only while open. `display:none` would keep a
 * closed section's state alive, but these sections are projections of engine
 * state, not owners of it — remount is free, and an unmounted pane can never
 * hold a stale focus trap or a hidden tabpanel that screen readers still
 * enumerate.
 */
export function ToolPanel({
  sections,
  activeSection,
  onActiveSectionChange,
}: ToolPanelProps) {
  const baseId = useId();
  const paneId = `${baseId}-pane`;
  const tabId = (id: ToolPanelSectionId) => `${baseId}-tab-${id}`;
  const railRef = useRef<HTMLDivElement | null>(null);

  const active =
    activeSection == null
      ? undefined
      : sections.find((s) => s.id === activeSection);

  return (
    <>
      {active !== undefined ? (
        <div
          id={paneId}
          role="tabpanel"
          aria-labelledby={tabId(active.id)}
          data-pretable-tool-pane=""
          // Escape hands focus back to the pane's rail tab — a keydown
          // listener on the container so it works from any control inside,
          // including ones Task 7 has not built yet. It does not close the
          // pane: dismissal is a decision, focus return is a courtesy.
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.stopPropagation();
              focusTab(railRef.current, tabId(active.id));
            }
          }}
        >
          <div data-pretable-tool-section="">{active.render()}</div>
        </div>
      ) : null}
      <Rail
        sections={sections}
        activeSection={activeSection}
        paneId={paneId}
        tabId={tabId}
        onActiveSectionChange={onActiveSectionChange}
        railRef={railRef}
      />
    </>
  );
}
