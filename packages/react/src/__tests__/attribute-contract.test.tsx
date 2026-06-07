import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { PretableSurface } from "../public_api";
import type { PretableColumn } from "../types";

type Row = { id: string; name: string; amount: number };

const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", pinned: "left" },
  { id: "amount", header: "Amount" },
];
const rows: Row[] = [
  { id: "r1", name: "Alpha", amount: 1 },
  { id: "r2", name: "Beta", amount: 2 },
];

describe("attribute contract", () => {
  test("every Pretable-emitted data-* attribute is in the data-pretable-* namespace", () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="Contract grid"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
      />,
    );
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
    const { container } = render(
      <PretableSurface
        ariaLabel="Header id grid"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
      />,
    );
    const amountHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="amount"]',
    );
    expect(amountHeader).not.toBeNull();
  });

  test("a left-pinned column's header carries data-pretable-pinned=left", () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="Pinned grid"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
      />,
    );
    const nameHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="name"]',
    );
    expect(nameHeader?.getAttribute("data-pretable-pinned")).toBe("left");
  });
});
