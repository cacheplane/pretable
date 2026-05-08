import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { MuiAdapter } from "../mui-adapter";

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

describe("MuiAdapter", () => {
  test("mounts and renders MUI DataGrid public selectors", async () => {
    const { container } = render(
      <MuiAdapter dataset={dataset as never} runKey={0} />,
    );

    // Asserts on .MuiDataGrid-virtualScroller — the same selector the
    // bench-runtime profile uses as the viewport — to catch class-name
    // drift on minor MUI bumps. If a future MUI release stops mounting
    // the virtual scroller in jsdom (no real layout), fall back to
    // .MuiDataGrid-root and document the limitation. As of @mui/x-data-grid@7
    // the scroller node is present even without layout.
    await waitFor(() => {
      expect(
        container.querySelector(".MuiDataGrid-virtualScroller"),
      ).not.toBeNull();
      expect(container.querySelector(".MuiDataGrid-root")).not.toBeNull();
    });
  });
});
