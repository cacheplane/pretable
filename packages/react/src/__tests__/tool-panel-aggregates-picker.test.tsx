// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableQueryFor,
} from "@pretable/core";

import { defaultMessages } from "../messages";
import { PretableSurface } from "../pretable-surface";
import { GroupingSection } from "../tool-panel/grouping";
import type { GroupingSectionColumn } from "../tool-panel/grouping";

afterEach(cleanup);

/*
 * The tool panel's grouping section: the aggregates block — the per-column
 * aggregate picker (SP3b Task 7).
 *
 * jsdom budget note (canonical write-up: grouping-state-engine.test.tsx, the
 * header comment): a grouped grid stops re-deriving once a jsdom module has
 * changed derivations enough times — around the fourth change on ONE grid,
 * and around the seventh CUMULATIVE change across a module however many
 * grids share it. It is MODULE-CUMULATIVE, not per-grid, so any test added
 * to any of these files can tip a later one over, and the symptom is an
 * unexplained `waitFor` timeout that points nowhere near the cause.
 *
 * These tests genuinely FLIP DERIVATIONS: every aggregate override the pane
 * writes re-derives the grouped rows. The budget is live here, so the ledger
 * is explicit — each surface-backed test states its flip count in a comment,
 * and the file's cumulative total is THREE (1 + 2), with the structural-fake
 * tests and the explicit-model smoke contributing zero. Anything pushing the
 * module past ~7 splits into a second file carrying this same header.
 */

type Holding = {
  id: string;
  sector: string;
  qty: number;
};

const helper = createColumnHelper<Holding>();

/**
 * `qty` declares `avg`. Over the Tech rows avg is 15 and sum is 30, so an
 * override to `"sum"` changes the RESULT and not merely the label — a
 * fixture where the two agree could pass whether or not the override
 * reached the row model (the choose-data-that-can-disprove rule).
 */
const COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "avg" }),
] as const;

const ROWS: readonly Holding[] = [
  { id: "h1", sector: "Tech", qty: 10 },
  { id: "h2", sector: "Tech", qty: 20 },
  { id: "h3", sector: "Energy", qty: 5 },
];

const GROUPED_QUERY: PretableQueryFor<typeof COLUMNS> = {
  filters: [],
  sort: [],
  rowGroups: [{ columnId: "sector" }],
};

const getRowId = (row: Holding) => row.id;

function mountGrouped() {
  return render(
    <PretableSurface<Holding, string, typeof COLUMNS>
      ariaLabel="aggregate picker grid"
      columns={COLUMNS}
      getRowId={getRowId}
      onQueryChange={() => {}}
      overscan={0}
      query={GROUPED_QUERY}
      rows={ROWS}
      toolPanel={{ defaultActiveSection: "grouping" }}
      viewportHeight={400}
    />,
  );
}

/** The Tech group row's rendered aggregate cell for `qty`. */
function techAggregateText(container: HTMLElement): string {
  const techGroup = [
    ...container.querySelectorAll("[data-pretable-group-row]"),
  ].find((row) => row.textContent?.includes("Tech"));
  return (
    techGroup?.querySelector('[data-pretable-column-id="qty"]')?.textContent ??
    ""
  );
}

function pickerFor(
  container: HTMLElement,
  columnId: string,
): HTMLSelectElement {
  const select = container.querySelector(
    `[data-pretable-aggregate-row][data-pretable-column-id="${columnId}"] select`,
  );
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`No aggregate picker rendered for ${columnId}`);
  }
  return select;
}

function optionValues(select: HTMLSelectElement): string[] {
  return [...select.options].map((option) => option.value);
}

function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.options].map((option) => option.textContent ?? "");
}

/**
 * Structural fakes for the pure select-state tests — no grid, no derivation
 * flips, same shape the group-by tests use. Stable state objects:
 * `useSyncExternalStore` demands a cached snapshot.
 */
function makeFakes(columnAggregates: Record<string, unknown> = {}) {
  const calls: [string, unknown][] = [];
  const gridState = { columnAggregates };
  const grid = {
    subscribe: () => () => {},
    getState: () => gridState,
    setHideGroupedColumns: () => {},
    setColumnAggregate: (columnId: string, aggregate: unknown) => {
      calls.push([columnId, aggregate]);
    },
  };
  const rowModelState = {
    snapshot: { query: { rowGroups: [] as { columnId: string }[] } },
  };
  const rowModel = {
    subscribe: () => () => {},
    getState: () => rowModelState,
    expandAll: () => {},
    collapseAll: () => {},
  };
  return { grid, rowModel, calls };
}

function renderSection(options: {
  columns: readonly GroupingSectionColumn[];
  columnAggregates?: Record<string, unknown>;
  aggregatesEnabled?: boolean;
}) {
  const fakes = makeFakes(options.columnAggregates ?? {});
  const view = render(
    <GroupingSection
      grid={fakes.grid}
      rowModel={fakes.rowModel}
      applyRowGroups={() => {}}
      columns={options.columns}
      aggregatesEnabled={options.aggregatesEnabled ?? true}
      messages={defaultMessages}
    />,
  );
  return { ...fakes, ...view };
}

const QTY_COLUMN: GroupingSectionColumn = {
  id: "qty",
  label: "Qty",
  type: "number",
  declaredAggregate: "sum",
};

describe("aggregate picker over a real grouped grid", () => {
  it("an override to Sum changes the group row's computed aggregate", async () => {
    // Derivation flips: 1 (the single override write below).
    const { container } = mountGrouped();
    await waitFor(() => {
      expect(techAggregateText(container)).toBe("15"); // declared avg
    });
    const picker = pickerFor(container, "qty");
    // No override yet: the picker shows the explicit Default face, carrying
    // the declared aggregate's display name (spec decision 4).
    expect(picker.value).toBe("default");
    expect(
      [...picker.options].find((option) => option.value === "default")
        ?.textContent,
    ).toBe("Default (Average)");

    fireEvent.change(picker, { target: { value: "sum" } });
    await waitFor(() => {
      expect(techAggregateText(container)).toBe("30"); // sum ≠ avg: 10 + 20
    });
    expect(picker.value).toBe("sum");
  });

  it("None strips the declared aggregate; Default restores it", async () => {
    // Derivation flips: 2 (the null-sentinel write, then the clear).
    const { container } = mountGrouped();
    await waitFor(() => {
      expect(techAggregateText(container)).toBe("15");
    });
    const picker = pickerFor(container, "qty");

    fireEvent.change(picker, { target: { value: "none" } });
    await waitFor(() => {
      expect(techAggregateText(container)).toBe(""); // no aggregate at all
    });
    expect(picker.value).toBe("none");

    fireEvent.change(picker, { target: { value: "default" } });
    await waitFor(() => {
      expect(techAggregateText(container)).toBe("15"); // declared avg again
    });
    expect(picker.value).toBe("default");
  });
});

describe("aggregate picker select state (structural fakes, zero flips)", () => {
  it("an override equal to the declared value shows the CONCRETE option, never Default", () => {
    // Spec decision 4's core: key presence is the signal, so "no override"
    // and "overridden to the prop's own value" must not look alike.
    const overridden = renderSection({
      columns: [QTY_COLUMN],
      columnAggregates: { qty: "sum" },
    });
    const overriddenPicker = pickerFor(overridden.container, "qty");
    expect(overriddenPicker.value).toBe("sum");
    cleanup();

    const clean = renderSection({ columns: [QTY_COLUMN] });
    const cleanPicker = pickerFor(clean.container, "qty");
    expect(cleanPicker.value).toBe("default");
    // Both faces exist side by side in one vocabulary: the Default option
    // names the declared value it would restore.
    expect(
      [...cleanPicker.options].find((option) => option.value === "default")
        ?.textContent,
    ).toBe("Default (Sum)");
  });

  it("an override to a consumer-written aggregator OBJECT shows a Custom option", () => {
    // The pane never writes an object, but the handle allows one; the picker
    // reflects it honestly with a selected Custom entry rather than lying
    // with Default.
    const { container } = renderSection({
      columns: [QTY_COLUMN],
      columnAggregates: { qty: { init: () => 0 } },
    });
    const picker = pickerFor(container, "qty");
    expect(picker.value).toBe("custom");
    expect(
      [...picker.options].find((option) => option.value === "custom")
        ?.textContent,
    ).toBe("Custom");
  });

  it("stays rendered while ungrouped, and the block is ABSENT when aggregates are disabled", () => {
    // Rows mode, no grouping: aggregates are per-column config, so the block
    // stays (spec behavior bullet) — the fakes' rowGroups are empty.
    const enabled = renderSection({ columns: [QTY_COLUMN] });
    expect(
      enabled.container.querySelector("[data-pretable-aggregate-row]"),
    ).not.toBeNull();
    expect(enabled.container.textContent).toContain("Aggregates");
    cleanup();

    // Explicit-model mode's flag: no rows, no heading, no disabled ghost.
    const disabled = renderSection({
      columns: [QTY_COLUMN],
      aggregatesEnabled: false,
    });
    expect(
      disabled.container.querySelector("[data-pretable-aggregate-row]"),
    ).toBeNull();
    expect(disabled.container.textContent).not.toContain("Aggregates");
  });

  it("a non-number column offers exactly Default, None, Count", () => {
    const { container } = renderSection({
      columns: [{ id: "sector", label: "Sector", type: "text" }],
    });
    const picker = pickerFor(container, "sector");
    expect(optionValues(picker)).toEqual(["default", "none", "count"]);
    // Nothing declared, so the Default face resolves to the None label.
    expect(optionLabels(picker)).toEqual(["Default (None)", "None", "Count"]);
    // Accessible name comes from the column-label message.
    expect(picker.getAttribute("aria-label")).toBe("Sector aggregate");
  });

  it("onChange emits exactly undefined / null / the builtin NAME — never a label", () => {
    // The destroys-the-grid guard: the engine stores aggregates
    // uninterpreted and an invalid one throws inside a React commit, so the
    // recorded arguments are asserted EXACTLY.
    const { container, calls } = renderSection({ columns: [QTY_COLUMN] });
    const picker = pickerFor(container, "qty");

    fireEvent.change(picker, { target: { value: "avg" } });
    fireEvent.change(picker, { target: { value: "none" } });
    fireEvent.change(picker, { target: { value: "default" } });
    expect(calls).toEqual([
      ["qty", "avg"],
      ["qty", null],
      ["qty", undefined],
    ]);
  });
});

describe("aggregate picker mode gating on the real surface", () => {
  it("explicit-model mode renders no aggregate rows (zero flips: mount only)", async () => {
    // The real prop wiring: `model !== undefined` must reach the section as
    // `aggregatesEnabled: false`. The rest of the grouping pane still
    // renders — group-by, expansion and hide-grouped work in both modes.
    const model = createLocalRowModel({
      rows: ROWS,
      columns: COLUMNS,
      getRowId,
      query: GROUPED_QUERY,
    });
    const { container } = render(
      <PretableSurface
        ariaLabel="model mode aggregate gating"
        model={model}
        overscan={0}
        toolPanel={{ defaultActiveSection: "grouping" }}
        viewportHeight={400}
      />,
    );
    await waitFor(() => {
      expect(
        container.querySelector("[data-pretable-tool-grouping]"),
      ).not.toBeNull();
    });
    expect(
      container.querySelector("[data-pretable-aggregate-row]"),
    ).toBeNull();
  });
});
