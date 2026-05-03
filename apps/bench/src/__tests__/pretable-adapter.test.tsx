import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";
import * as pretableReactInternal from "@pretable/react";

import { createBenchInteractionPlan } from "../interaction-plan";
import { PretableAdapter } from "../pretable-adapter";

describe("PretableAdapter", () => {
  afterEach(() => {
    cleanup();
  });

  test("keeps the shared renderer contract with raw body values and label-only headers", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const firstRowValue = String(dataset.rows[0]?.col_0 ?? "");

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    const adapter = screen
      .getByRole("grid", { name: "Pretable React adapter" })
      .closest("[data-benchmark-adapter]");
    const headerButton = screen.getByRole("button", {
      name: "Sort Message 1",
    });
    const firstRow = screen.getAllByTestId("pretable-row")[0];

    expect(adapter).toHaveAttribute("data-benchmark-adapter", "pretable");
    expect(
      adapter?.querySelector("[data-pretable-scroll-viewport]"),
    ).toBeTruthy();
    expect(adapter?.querySelector("[data-pretable-row]")).toBeTruthy();
    expect(headerButton).toHaveTextContent("Message 1");
    expect(headerButton).not.toHaveTextContent("Sort");
    expect(within(firstRow).queryByText("Message 1")).not.toBeInTheDocument();
    expect(within(firstRow).queryByText("Owner 1")).not.toBeInTheDocument();
    expect(within(firstRow).getByText(firstRowValue)).toBeInTheDocument();
  });

  test("marks wrapped benchmark cells so row-height measurement can stay scoped", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    const firstWrappedCell = screen
      .getAllByTestId("pretable-row")[0]
      ?.querySelector('[data-pretable-cell][data-pretable-wrap="true"]');

    expect(firstWrappedCell).toBeTruthy();
  });

  test("uses a tighter benchmark overscan than the playground-oriented default", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const surfaceSpy = vi.spyOn(pretableReactInternal, "PretableSurface");

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    expect(surfaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        overscan: 4,
      }),
      undefined,
    );
  });

  test("derives interaction preservation markers from actual telemetry instead of the requested plan", async () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const interactionPlan = createBenchInteractionPlan(dataset, "sort");
    const surfaceSpy = vi
      .spyOn(pretableReactInternal, "PretableSurface")
      .mockImplementation((props) => {
        function MockSurface() {
          useEffect(() => {
            props.onTelemetryChange?.({
              focusedRowId: "different-row",
              rowModelRowCount: 1,
              renderedRowCount: 1,
              selectedRowId: null,
              totalRowCount: 1,
              totalHeight: 48,
              visibleRowCount: 1,
              visibleRowRange: { start: 0, end: 0 },
            });
          }, []);

          return (
            <div
              aria-label={props.ariaLabel}
              data-pretable-scroll-viewport=""
              role="grid"
            >
              <div data-pretable-row="" data-testid="pretable-row">
                <div data-pretable-cell="" data-pretable-wrap="true">
                  x
                </div>
              </div>
            </div>
          );
        }

        return <MockSurface />;
      });

    render(
      <PretableAdapter
        dataset={dataset}
        interactionPlan={interactionPlan}
        runKey={1}
      />,
    );

    const adapter = screen
      .getByRole("grid", { name: "Pretable React adapter" })
      .closest("[data-benchmark-adapter]");

    await waitFor(() => {
      expect(adapter).toHaveAttribute("data-bench-result-row-count", "1");
    });

    expect(adapter).toHaveAttribute("data-bench-selected-row-id", "");
    expect(adapter).toHaveAttribute(
      "data-bench-focused-row-id",
      "different-row",
    );
    expect(adapter).toHaveAttribute(
      "data-bench-selected-row-preserved",
      "false",
    );
    expect(adapter).toHaveAttribute(
      "data-bench-focused-row-preserved",
      "false",
    );

    surfaceSpy.mockRestore();
  });

  test("does not rerender the surface in response to telemetry changes", async () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const surfaceSpy = vi
      .spyOn(pretableReactInternal, "PretableSurface")
      .mockImplementation((props) => {
        function MockSurface() {
          useEffect(() => {
            props.onTelemetryChange?.({
              focusedRowId: "S2-row-1",
              rowModelRowCount: 125,
              renderedRowCount: 6,
              selectedRowId: "S2-row-1",
              totalRowCount: dataset.rows.length,
              totalHeight: 20334,
              visibleRowCount: 2,
              visibleRowRange: { start: 0, end: 2 },
            });
          }, []);

          return (
            <div
              aria-label={props.ariaLabel}
              data-pretable-scroll-viewport=""
              role="grid"
            >
              <div data-pretable-row="" data-testid="pretable-row">
                <div data-pretable-cell="" data-pretable-wrap="true">
                  x
                </div>
              </div>
            </div>
          );
        }

        return <MockSurface />;
      });

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    await waitFor(() => {
      expect(surfaceSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(surfaceSpy.mock.calls.length).toBe(1);

    surfaceSpy.mockRestore();
  });
});
