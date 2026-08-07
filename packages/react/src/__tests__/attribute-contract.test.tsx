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
  });
});
