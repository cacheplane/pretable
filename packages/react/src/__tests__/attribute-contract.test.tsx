import { render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { PretableSurface } from "../public_api";
import type { PretableColumn, RowSelectionColumnConfig } from "../public_api";

type Row = { id: string; name: string; amount: number };

const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", pinned: "left" },
  { id: "amount", header: "Amount" },
];
const rows: Row[] = [
  { id: "r1", name: "Alpha", amount: 1 },
  { id: "r2", name: "Beta", amount: 2 },
];
const rowSelectionColumn: RowSelectionColumnConfig = { enabled: true };

function renderGrid(ariaLabel: string) {
  return render(
    <PretableSurface
      ariaLabel={ariaLabel}
      columns={columns}
      rows={rows}
      getRowId={(r: Row) => r.id}
      rowSelectionColumn={rowSelectionColumn}
      viewportHeight={300}
    />,
  );
}

describe("attribute contract", () => {
  test("every Pretable-emitted data-* attribute is in the data-pretable-* namespace", () => {
    const { container } = renderGrid("Contract grid");
    // Verify the row-select attributes are actually present so the guard is not
    // vacuous for that slice.
    expect(
      container.querySelector("[data-pretable-row-select-cell]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-pretable-row-select-header]"),
    ).not.toBeNull();
    // The tool panel is on by default, so its rail attributes are part of what
    // this sweep walks — assert they are actually mounted so the guard covers
    // them non-vacuously.
    expect(container.querySelector("[data-pretable-tool-rail]")).not.toBeNull();
    expect(container.querySelector("[data-pretable-tool-tab]")).not.toBeNull();

    const ALLOWED = new Set(["data-testid"]);
    const offenders = new Set<string>();
    for (const el of container.querySelectorAll("*")) {
      for (const attr of el.getAttributeNames()) {
        if (
          attr.startsWith("data-") &&
          !attr.startsWith("data-pretable-") &&
          !ALLOWED.has(attr)
        ) {
          offenders.add(attr);
        }
      }
    }
    expect([...offenders].sort()).toEqual([]);
  });

  test("the grouping section's attributes stay in the namespace when its pane is open", () => {
    // The sweep above renders with the pane CLOSED, so section-internal
    // attributes never mount there. This renders the grouping pane open and
    // re-runs the same sweep over it, with the container attribute asserted
    // present so the guard is not vacuous for this slice.
    //
    // The group-by block's attributes are rendered (and asserted) since
    // Task 5: data-pretable-tool-group-row (NOT data-pretable-group-row —
    // that name already belongs to the grid body's group rows,
    // group-row.tsx) and data-pretable-add-group. The expansion buttons and
    // the hide-grouped switch (Task 6) render unconditionally, so their
    // attributes are asserted below. Still pending, landing with its block
    // in the SAME commit that renders it: data-pretable-aggregate-row.
    //
    // Grouped by `name` so the group-by list actually renders a row — an
    // ungrouped pane would leave the row attributes unasserted (vacuous).
    const { container } = render(
      <PretableSurface
        ariaLabel="Grouping contract grid"
        columns={columns}
        rows={rows}
        getRowId={(r: Row) => r.id}
        onQueryChange={() => {}}
        query={{
          filters: [],
          sort: [],
          rowGroups: [{ columnId: "name" }],
        }}
        toolPanel={{ defaultActiveSection: "grouping" }}
        viewportHeight={300}
      />,
    );
    expect(
      container.querySelector("[data-pretable-tool-grouping]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-pretable-tool-group-row]"),
    ).not.toBeNull();
    expect(container.querySelector("[data-pretable-add-group]")).not.toBeNull();
    expect(
      container.querySelector("button[data-pretable-expand-all]"),
    ).not.toBeNull();
    expect(
      container.querySelector("button[data-pretable-collapse-all]"),
    ).not.toBeNull();
    expect(
      container.querySelector("input[data-pretable-hide-grouped]"),
    ).not.toBeNull();
    const ALLOWED = new Set(["data-testid"]);
    const offenders = new Set<string>();
    for (const el of container.querySelectorAll("*")) {
      for (const attr of el.getAttributeNames()) {
        if (
          attr.startsWith("data-") &&
          !attr.startsWith("data-pretable-") &&
          !ALLOWED.has(attr)
        ) {
          offenders.add(attr);
        }
      }
    }
    expect([...offenders].sort()).toEqual([]);
  });

  test("header cells expose data-pretable-column-id", () => {
    const { container } = renderGrid("Header id grid");
    const amountHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="amount"]',
    );
    expect(amountHeader).not.toBeNull();
  });

  test("a left-pinned column's header carries data-pretable-pinned=left", () => {
    const { container } = renderGrid("Pinned grid");
    const nameHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="name"]',
    );
    expect(nameHeader?.getAttribute("data-pretable-pinned")).toBe("left");
  });

  test("the grid root reports data-pretable-hydrated=true once mounted on the client", () => {
    const { container } = renderGrid("Hydrated grid");
    const viewport = container.querySelector("[data-pretable-scroll-viewport]");
    expect(viewport?.getAttribute("data-pretable-hydrated")).toBe("true");
  });

  test("server-rendered markup reports data-pretable-hydrated=false", () => {
    // The grid's header buttons, funnels and checkboxes are all in the SSR
    // output, so they paint (and accept clicks that go nowhere) before React
    // attaches any handler. This attribute is the one signal in the markup that
    // discriminates "painted" from "live", so it must be false in the string
    // React sends — otherwise a consumer gating on it would still click dead
    // controls, and flipping it client-side would be a hydration mismatch.
    const html = renderToString(
      <PretableSurface
        ariaLabel="SSR grid"
        columns={columns}
        rows={rows}
        getRowId={(r: Row) => r.id}
        rowSelectionColumn={rowSelectionColumn}
        viewportHeight={300}
      />,
    );
    expect(html).toContain('data-pretable-hydrated="false"');
    expect(html).not.toContain('data-pretable-hydrated="true"');
    // Guard against the assertion going vacuous: the controls this gate exists
    // for really are in the server output.
    expect(html).toContain("data-pretable-filter-funnel");
    // The rail tabs are in the SSR output too — painted, clickable, and inert
    // until hydration attaches their handlers, exactly like the funnels. The
    // hydration attribute above is the signal that covers them.
    expect(html).toContain("data-pretable-tool-tab");
  });
});
