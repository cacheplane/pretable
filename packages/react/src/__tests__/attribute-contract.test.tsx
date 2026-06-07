import { render } from "@testing-library/react";
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
});
