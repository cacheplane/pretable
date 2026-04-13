import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { BENCH_RESULT_KEY } from "../bench-runtime";
import * as benchRuntime from "../bench-runtime";
import { BenchApp } from "../bench-app";

describe("BenchApp", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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
        scale: "dev",
        scriptName: "initial",
      });
    });
  });

  test("autorun completes without a lifecycle flushSync warning", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <BenchApp
        search="?scenario=S1&script=initial&autorun=1"
        browserVersion="123.0"
      />,
    );

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "completed",
        scenarioId: "S1",
        scale: "dev",
        scriptName: "initial",
      });
    });

    expect(
      consoleError.mock.calls.some((call) =>
        call
          .map((value) => String(value))
          .join(" ")
          .includes("flushSync was called from inside a lifecycle method"),
      ),
    ).toBe(false);
  });

  test("renders the requested competitor surface instead of relabeling Pretable", async () => {
    render(
      <BenchApp search="?adapter=ag-grid&scenario=S2" browserVersion="123.0" />,
    );

    expect(screen.getByText("AG Grid harness")).toBeTruthy();
    expect(screen.getByText("AG Grid Community adapter")).toBeTruthy();
    expect(screen.queryAllByText("Pretable harness")).toHaveLength(0);
  });

  test("renders the requested tanstack competitor surface", async () => {
    render(
      <BenchApp
        search="?adapter=tanstack&scenario=S2"
        browserVersion="123.0"
      />,
    );

    expect(screen.getByText("TanStack Virtual harness")).toBeTruthy();
    expect(screen.getByText("TanStack Virtual adapter")).toBeTruthy();
    expect(screen.queryAllByText("Pretable harness")).toHaveLength(0);
  });

  test("keeps the Pretable benchmark wrapper distinct while exposing the shared renderer markers", async () => {
    render(
      <BenchApp search="?adapter=pretable&scenario=S2" browserVersion="123.0" />,
    );

    const adapter = screen.getByRole("grid", {
      name: "Pretable React adapter",
    }).closest("[data-benchmark-adapter]");

    expect(adapter?.getAttribute("data-benchmark-adapter")).toBe("pretable");
    expect(
      adapter?.querySelector("[data-pretable-scroll-viewport]"),
    ).toBeTruthy();
    expect(adapter?.querySelector("[data-pretable-row]")).toBeTruthy();
  });

  test("publishes a failed terminal result when scroll measurement throws", async () => {
    vi.spyOn(benchRuntime, "measureBenchScrollRun").mockRejectedValueOnce(
      new Error("scroll probe exploded"),
    );

    render(
      <BenchApp search="?scenario=S2&script=scroll" browserVersion="123.0" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run Scroll" }));

    await waitFor(() => {
      expect(window[BENCH_RESULT_KEY]).toMatchObject({
        status: "failed",
        adapterId: "pretable",
        scenarioId: "S2",
        scriptName: "scroll",
        error: {
          name: "Error",
          message: "scroll probe exploded",
        },
      });
    });
  });
});
