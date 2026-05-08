import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { AgGridAdapter } from "../ag-grid-adapter";

const dataset = {
  columns: [
    { id: "id", header: "ID", wrap: false, widthPx: 80 },
    { id: "name", header: "Name", wrap: false, widthPx: 160 },
  ],
  rows: [
    { id: "1", name: "Alpha" },
    { id: "2", name: "Beta" },
  ],
};

describe("AgGridAdapter", () => {
  test("mounts and renders AG Grid public selectors", async () => {
    const { container } = render(
      <AgGridAdapter dataset={dataset as never} runKey={0} />,
    );

    // AG Grid v33 in jsdom doesn't fully populate the virtualized
    // .ag-body-viewport / .ag-row tree (no real layout). The smoke test
    // here just confirms the grid mounts to its root wrapper — full
    // selector coverage is exercised by the matrix run in Chromium.
    await waitFor(() => {
      expect(container.querySelector(".ag-root-wrapper")).not.toBeNull();
    });
  });
});
