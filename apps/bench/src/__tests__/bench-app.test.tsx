import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { BENCH_RESULT_KEY } from "../bench-runtime";
import { BenchApp } from "../bench-app";

describe("BenchApp", () => {
  test("renders selected scenario metadata and publishes a terminal result", async () => {
    render(<BenchApp search="?scenario=S2" browserVersion="123.0" />);

    expect(screen.getAllByText("wrap-auto-height")).toHaveLength(2);
    expect(screen.getAllByText("Primary wedge benchmark.")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Run Initial" }));

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "completed",
        adapterId: "pretable",
        scenarioId: "S2",
        profile: "default",
        scriptName: "initial",
      });
    });
  });
});
