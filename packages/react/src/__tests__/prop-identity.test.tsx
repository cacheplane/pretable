import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";

/**
 * `rows` is already reconciled in place (grid.setRows). `columns` was not: a
 * new array identity recreated the grid and took every slice it owns with it.
 * An inline `columns={[...]}` is a new identity on every render, so the advice
 * to "keep columns a stable reference" was load-bearing rather than an
 * optimisation — forget it and sorting silently stops working.
 */

interface DemoRow {
  id: string;
  name: string;
  status: string;
}

function seed(): DemoRow[] {
  return [
    { id: "a", name: "Zulu", status: "open" },
    { id: "b", name: "Alpha", status: "open" },
    { id: "c", name: "Bravo", status: "closed" },
  ];
}

/** Fresh column objects each call — what an inline `columns` prop produces. */
function freshColumns() {
  return [
    { id: "name", header: "Name", value: (row: DemoRow) => row.name },
    { id: "status", header: "Status", value: (row: DemoRow) => row.status },
  ];
}

function Grid({
  columns,
  rows,
}: {
  columns: ReturnType<typeof freshColumns>;
  rows: DemoRow[];
}) {
  return (
    <PretableSurface<DemoRow>
      ariaLabel="Demo"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
    />
  );
}

function renderedOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-pretable-row]")].map(
    (row) => row.getAttribute("data-pretable-row-id") ?? "",
  );
}

function header(container: HTMLElement, label: string): HTMLElement {
  const match = [
    ...container.querySelectorAll("[data-pretable-header-cell]"),
  ].find((el) => el.getAttribute("aria-label")?.includes(label));
  if (!match) throw new Error(`no header for ${label}`);
  return match as HTMLElement;
}

afterEach(cleanup);

describe("columns prop identity", () => {
  it("keeps the sort when the columns array identity changes", () => {
    const rows = seed();
    const { container, rerender } = render(
      <Grid columns={freshColumns()} rows={rows} />,
    );

    fireEvent.click(header(container, "Name"));
    const sorted = renderedOrder(container);
    expect(sorted).not.toEqual(["a", "b", "c"]);

    rerender(<Grid columns={freshColumns()} rows={rows} />);

    expect(renderedOrder(container)).toEqual(sorted);
  });

  it("keeps focus when the columns array identity changes", () => {
    const rows = seed();
    const { container, rerender } = render(
      <Grid columns={freshColumns()} rows={rows} />,
    );

    fireEvent.pointerDown(
      container.querySelector(
        '[data-pretable-cell][data-pretable-column-id="name"]',
      ) as HTMLElement,
    );

    rerender(<Grid columns={freshColumns()} rows={rows} />);

    expect(
      container.querySelector(
        '[data-pretable-cell][data-pretable-focused="true"]',
      ),
    ).not.toBeNull();
  });

  it("still picks up a changed header label", () => {
    const rows = seed();
    const { container, rerender } = render(
      <Grid columns={freshColumns()} rows={rows} />,
    );

    const renamed = freshColumns();
    renamed[0]!.header = "Renamed";
    rerender(<Grid columns={renamed} rows={rows} />);

    expect(container.textContent).toContain("Renamed");
  });

  it("still picks up added and removed columns", () => {
    const rows = seed();
    const { container, rerender } = render(
      <Grid columns={freshColumns()} rows={rows} />,
    );

    rerender(
      <Grid
        columns={[
          { id: "name", header: "Name", value: (row: DemoRow) => row.name },
        ]}
        rows={rows}
      />,
    );

    expect(
      container.querySelectorAll("[data-pretable-header-cell]"),
    ).toHaveLength(1);
  });
});
