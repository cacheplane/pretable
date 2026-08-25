import { type RefObject, useState } from "react";

import { focusTab } from "./focus";
import type {
  ToolPanelSectionDescriptor,
  ToolPanelSectionId,
} from "./sections";

export interface ToolPanelRailProps {
  /** Accessible name for the tablist — supplied by the surface's messages
   * layer, never hardcoded here (see {@link ToolPanelProps.railLabel}). */
  label: string;
  sections: readonly ToolPanelSectionDescriptor[];
  activeSection: ToolPanelSectionId | null;
  /** The pane element's id — every tab points its `aria-controls` here,
   * because there is one pane and the tabs swap what fills it. */
  paneId: string;
  /** `${baseId}-tab-${sectionId}`, shared with the pane's `aria-labelledby`. */
  tabId: (id: ToolPanelSectionId) => string;
  onActiveSectionChange: (next: ToolPanelSectionId | null) => void;
  railRef: RefObject<HTMLDivElement | null>;
}

/**
 * The vertical icon strip at the grid's right edge. A tablist whose tabs
 * TOGGLE rather than select: activating the open section's tab closes the
 * pane, which real tablists never do — but a panel with no "none" affordance
 * would permanently cost the grid 264px.
 *
 * Roving tabindex, so the whole rail is one Tab stop. ArrowUp/ArrowDown move
 * focus without activating (activation-follows-focus would open and close the
 * pane on every keystroke of a browse); Enter/Space activate via the buttons'
 * native click synthesis. The rover is local state, reset when focus leaves
 * the rail so a returning Tab always lands on the active (or first) tab
 * rather than wherever a browse was abandoned.
 */
export function Rail({
  label,
  sections,
  activeSection,
  paneId,
  tabId,
  onActiveSectionChange,
  railRef,
}: ToolPanelRailProps) {
  const [roverId, setRoverId] = useState<ToolPanelSectionId | null>(null);
  const tabStopId =
    (roverId != null && sections.some((s) => s.id === roverId)
      ? roverId
      : null) ??
    (activeSection != null && sections.some((s) => s.id === activeSection)
      ? activeSection
      : null) ??
    sections[0]?.id ??
    null;

  const moveFocus = (from: ToolPanelSectionId, delta: 1 | -1) => {
    const index = sections.findIndex((s) => s.id === from);
    if (index === -1) return;
    const next = sections[(index + delta + sections.length) % sections.length];
    if (next === undefined) return;
    // No setRoverId here: the .focus() fires the tab's onFocus, which sets
    // the rover — a second write would only diverge in the failure case,
    // moving the tab stop to a tab that never actually received focus.
    focusTab(railRef.current, tabId(next.id));
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="vertical"
      data-pretable-tool-rail=""
      ref={railRef}
      onBlur={(event) => {
        if (!railRef.current?.contains(event.relatedTarget as Node | null)) {
          setRoverId(null);
        }
      }}
    >
      {sections.map((section) => {
        const selected = section.id === activeSection;
        const Icon = section.icon;
        return (
          <button
            key={section.id}
            type="button"
            id={tabId(section.id)}
            role="tab"
            aria-selected={selected}
            aria-controls={paneId}
            aria-label={section.label}
            tabIndex={section.id === tabStopId ? 0 : -1}
            data-pretable-tool-tab=""
            data-pretable-section={section.id}
            onClick={() => {
              onActiveSectionChange(selected ? null : section.id);
            }}
            onFocus={() => {
              setRoverId(section.id);
            }}
            onKeyDown={(event) => {
              // Deliberately no Home/End: the rail holds 2-4 sections,
              // so arrows already reach everything in one or two presses.
              // Revisit if SP3 grows the rail.
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(section.id, event.key === "ArrowDown" ? 1 : -1);
              }
            }}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
