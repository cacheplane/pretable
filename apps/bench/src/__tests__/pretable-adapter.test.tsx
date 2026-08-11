import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createScenarioDataset,
  type ScenarioRow,
} from "@pretable-internal/scenario-data";
import * as pretableReactInternal from "@pretable/react";

import { readBenchGridInstanceId } from "../bench-runtime";
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
    const headerButton = screen.getByRole("columnheader", {
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

  test("presents no instance id until a grid publishes one", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    // A surface that never publishes a grid. `onGridReady` is what hands out the id,
    // so this is the state every run passes through before the engine exists — and
    // the state the reconstruction probe must be able to tell apart from a real id.
    const surfaceSpy = vi
      .spyOn(pretableReactInternal, "PretableSurface")
      .mockImplementation((props) => (
        <div
          aria-label={props.ariaLabel}
          data-pretable-scroll-viewport=""
          role="grid"
        />
      ));

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    const adapter = screen
      .getByRole("grid", { name: "Pretable React adapter" })
      .closest("[data-benchmark-adapter]");

    expect(adapter).not.toHaveAttribute("data-bench-grid-instance-id");
    // The seam, end to end: what the adapter leaves in the DOM before readiness must
    // read as unavailable to the runtime probe, not as instance 0.
    expect(readBenchGridInstanceId(adapter?.parentElement ?? null)).toBeNull();

    // The file's other spies restore in-test; without this one doing the same, a
    // stub PretableSurface leaks into every test declared after it and the suite
    // passes only because two later tests happen to call mockRestore().
    surfaceSpy.mockRestore();
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
              loadedRowCount: 1,
              matchingTotal: { kind: "exact", count: 1 },
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
              loadedRowCount: dataset.rows.length,
              matchingTotal: { kind: "exact", count: dataset.rows.length },
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

  test("swaps the row array through the data api without rebuilding the grid", async () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const initialRows = dataset.rows.slice(0, 3);
    const nextRows = initialRows.map((row) => ({
      ...row,
      col_0: `${String(row.col_0 ?? "")} refreshed`,
    }));
    let apply: ((rows: readonly ScenarioRow[]) => void) | null = null;

    render(
      <PretableAdapter
        dataset={dataset}
        initialRows={initialRows}
        onDataApiReady={(next) => {
          apply = next;
        }}
        runKey={1}
      />,
    );

    const adapter = screen
      .getByRole("grid", { name: "Pretable React adapter" })
      .closest("[data-benchmark-adapter]");

    // `initialRows` wins over the dataset's own 120 rows.
    expect(screen.getAllByTestId("pretable-row")).toHaveLength(3);
    // Waited for through the runtime's own reader, not for the attribute to exist:
    // a placeholder would satisfy presence and leave the comparison below running
    // against a value no engine ever published.
    await waitFor(() => {
      expect(
        readBenchGridInstanceId(adapter?.parentElement ?? null),
      ).not.toBeNull();
    });

    const instanceIdBefore = readBenchGridInstanceId(
      adapter?.parentElement ?? null,
    );

    expect(apply).not.toBeNull();
    await act(async () => {
      apply?.(nextRows);
    });

    await waitFor(() => {
      expect(
        screen.getByText(String(nextRows[0]?.col_0 ?? "")),
      ).toBeInTheDocument();
    });
    // Same engine absorbed the new array — this is the property
    // `grid_instance_reconstructed` reads.
    expect(readBenchGridInstanceId(adapter?.parentElement ?? null)).toBe(
      instanceIdBefore,
    );
  });
});
