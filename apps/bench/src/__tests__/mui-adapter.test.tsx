import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { createScenarioDataset } from "@pretable-internal/scenario-data";

import { MuiAdapter } from "../mui-adapter";

describe("MuiAdapter", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the expected DOM structure for bench scroll measurement", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });

    render(<MuiAdapter dataset={dataset} runKey={0} />);

    const section = screen
      .getByText("MUI Data Grid Community adapter")
      .closest("section");

    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-benchmark-adapter")).toBe("mui");
    expect(section?.getAttribute("data-bench-result-row-count")).toBe(
      String(dataset.rows.length),
    );
    expect(screen.getByText(`Rows: ${dataset.rows.length}`)).toBeTruthy();
    expect(screen.getByText(`Columns: ${dataset.columns.length}`)).toBeTruthy();
  });
});
