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
import type { PretableColumn, PretableSurfaceProps } from "@pretable/react";
import type { ScenarioRow } from "@pretable-internal/scenario-data";

import { createBenchInteractionPlan } from "../interaction-plan";
import { PretableAdapter } from "../pretable-adapter";

type SurfaceProps = PretableSurfaceProps<
  ScenarioRow,
  string,
  readonly PretableColumn<ScenarioRow>[]
>;

describe("PretableAdapter", () => {
  afterEach(() => {
    cleanup();
  });

  test("keeps the shared renderer contract with raw body values and label-only headers", async () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const firstRowValue = String(dataset.rows[0]?.col_0 ?? "");

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    const adapter = screen
      .getByRole("grid", { name: "Pretable React adapter" })
      .closest("[data-benchmark-adapter]");
    const headerButton = screen.getByRole("columnheader", {
      name: "Sort Message 1",
    });
    const firstRow = (await screen.findAllByTestId("pretable-row"))[0]!;

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

  test("marks wrapped benchmark cells so row-height measurement can stay scoped", async () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });

    render(<PretableAdapter dataset={dataset} runKey={1} />);

    const firstWrappedCell = (
      await screen.findAllByTestId("pretable-row")
    )[0]?.querySelector('[data-pretable-cell][data-pretable-wrap="true"]');

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

  test("configures grouping and aggregation only for grouped updates without mutating the dataset", () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const originalColumns = dataset.columns.map((column) => ({ ...column }));
    const surfaceSpy = vi.spyOn(pretableReactInternal, "PretableSurface");

    render(
      <PretableAdapter
        dataset={dataset}
        runKey={1}
        scriptName="updates-grouped"
      />,
    );

    const groupedProps = surfaceSpy.mock.calls.at(-1)?.[0] as
      SurfaceProps | undefined;
    const groupedModel =
      groupedProps && "model" in groupedProps ? groupedProps.model : undefined;
    expect("model" in (groupedProps ?? {})).toBe(true);
    expect(groupedModel).toBeTruthy();
    expect(groupedModel!.getState().snapshot.query.rowGroups).toEqual([
      { columnId: "col_1" },
    ]);
    expect(groupedModel!.getState().snapshot.expansion.default).toEqual({
      kind: "expanded",
    });
    expect(
      groupedProps?.columns?.find((column) => column.id === "col_3"),
    ).toMatchObject({ aggregate: "sum" });
    expect(groupedProps?.groupPanel).toBeUndefined();

    cleanup();
    surfaceSpy.mockClear();

    render(
      <PretableAdapter dataset={dataset} runKey={2} scriptName="updates" />,
    );

    const updatesProps = surfaceSpy.mock.calls.at(-1)?.[0] as
      SurfaceProps | undefined;
    const updatesModel =
      updatesProps && "model" in updatesProps ? updatesProps.model : undefined;
    expect(updatesModel!.getState().snapshot.query.rowGroups).toEqual([]);
    expect(
      updatesProps?.columns?.find((column) => column.id === "col_3"),
    ).not.toHaveProperty("aggregate");
    expect(updatesProps?.groupPanel).toBeUndefined();
    expect(dataset.columns).toEqual(originalColumns);

    surfaceSpy.mockRestore();
  });

  test("installs the internal diagnostics controller only for explicit diagnostic runs and removes it on unmount", async () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const { unmount } = render(
      <PretableAdapter
        dataset={dataset}
        diagnostics
        runKey={1}
        scriptName="updates-grouped"
        seed={91_337}
      />,
    );

    await waitFor(() => {
      expect(window.__PRETABLE_ROW_MODEL_BENCH__).toBeDefined();
    });
    expect(window.__PRETABLE_ROW_MODEL_BENCH__?.read().diagnosticsEnabled).toBe(
      true,
    );

    unmount();
    expect(window.__PRETABLE_ROW_MODEL_BENCH__).toBeUndefined();

    render(
      <PretableAdapter
        dataset={dataset}
        diagnostics={false}
        runKey={2}
        seed={91_337}
      />,
    );
    expect(window.__PRETABLE_ROW_MODEL_BENCH__).toBeUndefined();
  });

  test("derives interaction preservation markers from actual telemetry instead of the requested plan", async () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const interactionPlan = createBenchInteractionPlan(dataset, "sort");
    const surfaceSpy = vi
      .spyOn(pretableReactInternal, "PretableSurface")
      .mockImplementation((props: SurfaceProps) => {
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
      .mockImplementation((props: SurfaceProps) => {
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
