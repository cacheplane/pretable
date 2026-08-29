// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../public_api";
import type {
  PretableColumn,
  PretableToolPanelConfig,
  PretableToolPanelSection,
  PretableToolPanelSectionId,
} from "../public_api";

afterEach(() => {
  cleanup();
});

/* SP4: the `sections` roster on the surface's toolPanel config — consumer
   sections through the real surface, not the shell harness (that half lives
   in `tool-panel.test.tsx`). The resolver's own validation matrix is in
   `tool-panel-roster.test.ts`; here the roster rides the surface. */

type Row = { id: string; name: string; amount: number };

const rows: Row[] = [
  { id: "r1", name: "Alpha", amount: 1 },
  { id: "r2", name: "Beta", amount: 2 },
];
const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name" },
  { id: "amount", header: "Amount" },
];

const CustomIcon = ({ className }: { className?: string }) => (
  <svg className={className} data-pretable-icon="" />
);

const customSection: PretableToolPanelSection = {
  id: "my-section",
  icon: CustomIcon,
  label: "My section",
  render: () => <div data-testid="custom-pane-content">consumer content</div>,
};

function renderSurface(toolPanel: boolean | PretableToolPanelConfig) {
  return render(
    <PretableSurface
      ariaLabel="Composable tool panel grid"
      columns={columns}
      rows={rows}
      getRowId={(r: Row) => r.id}
      toolPanel={toolPanel}
      viewportHeight={300}
    />,
  );
}

const tabOrder = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("[data-pretable-tool-tab]")).map((el) =>
    el.getAttribute("data-pretable-section"),
  );

describe("toolPanel.sections — the composable roster on the surface", () => {
  it("renders the roster's tabs in roster order and the custom pane on activation", () => {
    const { container, getByRole, getByTestId } = renderSurface({
      sections: ["grouping", customSection, "columns"],
    });
    expect(tabOrder(container)).toEqual(["grouping", "my-section", "columns"]);

    fireEvent.click(getByRole("tab", { name: "My section" }));
    const section = container.querySelector("[data-pretable-tool-section]");
    expect(section).not.toBeNull();
    expect(getByTestId("custom-pane-content")).toBeInTheDocument();
    expect(section?.contains(getByTestId("custom-pane-content"))).toBe(true);
  });

  it("hides an omitted built-in, and the remaining built-ins still function", () => {
    const { container, getByRole } = renderSurface({
      sections: ["columns", "filters"],
    });
    expect(tabOrder(container)).toEqual(["columns", "filters"]);

    // Positive twin: the surviving built-in is not just a tab, it opens.
    fireEvent.click(getByRole("tab", { name: "Columns" }));
    expect(
      container.querySelector("[data-pretable-tool-column-row]"),
    ).not.toBeNull();
  });

  it("defaultActiveSection and controlled activeSection accept a custom id", () => {
    const { getByTestId, unmount } = renderSurface({
      sections: ["columns", customSection],
      defaultActiveSection: "my-section",
    });
    expect(getByTestId("custom-pane-content")).toBeInTheDocument();
    unmount();

    // Controlled, with the callback typed over the OPEN id vocabulary — the
    // annotation is the compile-time half of this assertion.
    const onActiveSectionChange =
      vi.fn<(next: PretableToolPanelSectionId | null) => void>();
    const controlled = renderSurface({
      sections: ["columns", customSection],
      activeSection: "my-section",
      onActiveSectionChange,
    });
    expect(controlled.getByTestId("custom-pane-content")).toBeInTheDocument();

    fireEvent.click(controlled.getByRole("tab", { name: "My section" }));
    expect(onActiveSectionChange).toHaveBeenLastCalledWith(null);
    // Controlled: the DOM holds until the prop moves.
    expect(controlled.getByTestId("custom-pane-content")).toBeInTheDocument();
  });

  it("an active id not in the roster renders rail-only without throwing (decision 5)", () => {
    const { container } = renderSurface({
      sections: ["columns", "filters"],
      activeSection: "not-in-roster",
    });
    expect(container.querySelector("[data-pretable-tool-rail]")).not.toBeNull();
    expect(container.querySelector("[data-pretable-tool-pane]")).toBeNull();
  });

  it("sections: [] renders no rail and no pane — the panel effectively off", () => {
    const { container } = renderSurface({ sections: [] });
    expect(container.querySelector("[data-pretable-tool-rail]")).toBeNull();
    expect(container.querySelector("[data-pretable-tool-pane]")).toBeNull();
    // The empty-roster skip reuses toolPanel={false}'s path: no tool layout.
    expect(container.querySelector("[data-pretable-tool-layout]")).toBeNull();
  });

  it("an absent roster keeps today's three built-ins, in shipped order", () => {
    const { container } = renderSurface({});
    expect(tabOrder(container)).toEqual(["columns", "filters", "grouping"]);
  });

  it("a colliding roster throws the resolver's error out of render", () => {
    expect(() =>
      renderSurface({
        sections: ["columns", { ...customSection, id: "columns" }],
      }),
    ).toThrow(/toolPanel\.sections.*"columns".*replacing/i);
  });
});
