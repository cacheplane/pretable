import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";

/**
 * D1-GRID-04, React half: with none of the server-authority props supplied the
 * surface's DOM, ARIA and labels are byte-identical to shipped 0.0.9. Every
 * assertion here is expected to survive the whole slice untouched.
 */

afterEach(cleanup);

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bob" },
];

const columns = [{ id: "name", header: "Name", widthPx: 120 }];

function renderSurface() {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      rowSelectionColumn={{ enabled: true }}
    />,
  );
}

describe("local mode baseline (surface)", () => {
  it("aria-rowcount counts the loaded model plus the header", () => {
    renderSurface();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("data rows start at aria-rowindex 2", () => {
    renderSurface();
    const gridRows = screen.getAllByRole("row");
    expect(gridRows[gridRows.length - 1]).toHaveAttribute("aria-rowindex", "3");
  });

  it("never sets aria-busy on the grid", () => {
    renderSurface();
    expect(screen.getByRole("grid")).not.toHaveAttribute("aria-busy");
  });

  it("does not set a data-phase attribute", () => {
    renderSurface();
    expect(screen.getByRole("grid")).not.toHaveAttribute(
      "data-pretable-data-phase",
    );
  });

  it("renders no body-state block", () => {
    const view = renderSurface();
    expect(
      view.container.querySelector("[data-pretable-body-state]"),
    ).toBeNull();
  });

  it("does not add a data-state wrapper around the viewport", () => {
    const view = renderSurface();
    expect(
      view.container.querySelector("[data-pretable-data-state-wrapper]"),
    ).toBeNull();
  });

  it('labels the header checkbox "Select all rows"', () => {
    renderSurface();
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toBeInTheDocument();
  });
});
