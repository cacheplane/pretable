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
import type { PretableColumn, PretableSurfaceProps } from "@pretable/react";

import { readBenchGridInstanceId } from "../bench-runtime";
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

  test("the collapse handle collapses exactly the group the plan names", async () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    const plan = createBenchInteractionPlan(dataset, "group-expand")!;
    expect(plan.collapsedGroupKey).not.toBeNull();
    expect(plan.collapsedGroupRowCount).toBeGreaterThan(0);

    const surfaceSpy = vi.spyOn(pretableReactInternal, "PretableSurface");
    let collapse: ((groupKey: string) => void) | null = null;

    render(
      <PretableAdapter
        dataset={dataset}
        runKey={1}
        scriptName="group-expand"
        interactionPlan={plan}
        onGroupToggleReady={(fn) => {
          collapse = fn;
        }}
      />,
    );

    const model = (surfaceSpy.mock.calls.at(-1)?.[0] as unknown as SurfaceProps)
      .model;
    expect(model).toBeTruthy();
    expect(collapse).not.toBeNull();

    // The grouped SETUP settles cooperatively post-#321 — poll the snapshot,
    // never assert synchronously.
    const groupedRowCount =
      dataset.rows.length +
      new Set(dataset.rows.map((row) => String(row[plan.rowGroups[0]!] ?? "")))
        .size;
    await waitFor(() => {
      expect(model!.getState().snapshot.visibleRowCount).toBe(groupedRowCount);
    });

    act(() => collapse!(plan.collapsedGroupKey!));

    // Every group row survives; the collapsed group's data rows do not — a
    // wrong-group collapse changes this delta.
    await waitFor(() => {
      expect(model!.getState().snapshot.visibleRowCount).toBe(
        groupedRowCount - plan.collapsedGroupRowCount,
      );
    });

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

  test("presents no instance id until a grid publishes one", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });
    // A surface that never publishes a grid. `onGridReady` is what hands out the id,
    // so this is the state every run passes through before the engine exists — and
    // the state the reconstruction probe must be able to tell apart from a real id.
    const surfaceSpy = vi
      .spyOn(pretableReactInternal, "PretableSurface")
      .mockImplementation((props: SurfaceProps) => (
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
      .mockImplementation((props: SurfaceProps) => {
        function MockSurface() {
          useEffect(() => {
            props.onTelemetryChange?.({
              focusedRowId: "different-row",
              rowModelRowCount: 1,
              renderedRowCount: 1,
              selectedRowId: null,
              loadedRowCount: 1,
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
              loadedRowCount: dataset.rows.length,
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
