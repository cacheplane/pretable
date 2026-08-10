import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { resolveColumnAlign } from "../column-align";
import { PretableSurface } from "../public_api";
import type { PretableColumn } from "../public_api";

describe("resolveColumnAlign", () => {
  test("number columns default to end", () => {
    expect(resolveColumnAlign({ type: "number" })).toBe("end");
  });

  test("text columns get no alignment attribute", () => {
    expect(resolveColumnAlign({ type: "text" })).toBeUndefined();
  });

  test("an untyped column gets no alignment attribute", () => {
    expect(resolveColumnAlign({})).toBeUndefined();
  });

  test("an explicit align always wins over the type default", () => {
    expect(resolveColumnAlign({ type: "number", align: "start" })).toBe(
      "start",
    );
    expect(resolveColumnAlign({ type: "text", align: "center" })).toBe(
      "center",
    );
  });
});

type Row = { id: string; name: string; amount: number };

const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", type: "text" },
  { id: "amount", header: "Amount", type: "number" },
];
const rows: Row[] = [
  { id: "r1", name: "Alpha", amount: 1 },
  { id: "r2", name: "Beta", amount: 2 },
];

describe("rendered alignment attributes", () => {
  test("cells and headers carry the column's type and resolved alignment", () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="Align grid"
        columns={columns}
        rows={rows}
        getRowId={(r: Row) => r.id}
        viewportHeight={300}
      />,
    );

    const numericCell = container.querySelector(
      '[data-pretable-cell][data-pretable-column-id="amount"]',
    );
    expect(numericCell?.getAttribute("data-pretable-column-type")).toBe(
      "number",
    );
    expect(numericCell?.getAttribute("data-pretable-column-align")).toBe("end");

    const textCell = container.querySelector(
      '[data-pretable-cell][data-pretable-column-id="name"]',
    );
    expect(textCell?.getAttribute("data-pretable-column-type")).toBe("text");
    expect(textCell?.getAttribute("data-pretable-column-align")).toBeNull();

    const numericHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="amount"]',
    );
    expect(numericHeader?.getAttribute("data-pretable-column-type")).toBe(
      "number",
    );
    expect(numericHeader?.getAttribute("data-pretable-column-align")).toBe(
      "end",
    );

    const textHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="name"]',
    );
    expect(textHeader?.getAttribute("data-pretable-column-type")).toBe("text");
    expect(textHeader?.getAttribute("data-pretable-column-align")).toBeNull();
  });
});
