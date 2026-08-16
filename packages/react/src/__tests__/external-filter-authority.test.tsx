import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createColumnHelper, createLocalRowModel } from "@pretable/core";
import type {
  PretableProcessingOptions,
  PretableQueryFor,
} from "@pretable/core";

import { resetDevWarnings } from "../dev-warn";
import { PretableSurface } from "../pretable-surface";

afterEach(cleanup);

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDevWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

type Row = { id: string; customer: string; amount: number };

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("customer", { type: "text", widthPx: 160 }),
  column.accessor("amount", { type: "number", widthPx: 120 }),
] as const;

/**
 * The window the server returned for query A. Not one `customer` contains the
 * substring the grid is about to hold in query B, so an engine that re-applies
 * the published filter empties the body outright — which is exactly the
 * disagreement `dataState.phase === "stale"` guarantees.
 */
const LOADED: readonly Row[] = [
  { id: "r1", customer: "Northwind", amount: 10 },
  { id: "r2", customer: "Contoso", amount: 20 },
  { id: "r3", customer: "Fabrikam", amount: 30 },
  { id: "r4", customer: "Tailspin", amount: 40 },
  { id: "r5", customer: "Litware", amount: 50 },
  { id: "r6", customer: "Proseware", amount: 60 },
];

const EXTERNAL: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};

/** Query B: what the grid holds while `LOADED` still answers query A. */
const NARROWING_QUERY: PretableQueryFor<typeof columns> = {
  filters: [{ columnId: "customer", operator: "contains", value: "fail" }],
  sort: [],
  rowGroups: [],
};

/** The same query with a sort, for the assertions about what is REPORTED. */
const NARROWING_AND_SORTED: PretableQueryFor<typeof columns> = {
  filters: NARROWING_QUERY.filters,
  sort: [{ columnId: "customer", direction: "asc" }],
  rowGroups: [],
};

/** The rows a consumer-owned model itself holds, independent of the viewport. */
function modelRowIds(model: {
  getState: () => {
    snapshot: {
      range: (
        start: number,
        end: number,
      ) => readonly { kind: string; rowId?: unknown }[];
    };
  };
}): string[] {
  return model
    .getState()
    .snapshot.range(0, 100)
    .flatMap((row) => (row.kind === "data" ? [String(row.rowId)] : []));
}

/** Lets any pending cooperative rebuild land before the next assertion. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** Every data row currently drawn, by row id — never a count. */
function renderedRowIds(): string[] {
  return Array.from(
    document.querySelectorAll("[data-pretable-row][data-pretable-row-id]"),
  ).map((node) => node.getAttribute("data-pretable-row-id") ?? "");
}

function surface(
  processing: PretableProcessingOptions | undefined,
  query: PretableQueryFor<typeof columns> = NARROWING_QUERY,
) {
  return (
    <PretableSurface<Row, string, typeof columns>
      ariaLabel="Orders"
      columns={columns}
      rows={LOADED}
      getRowId={(row) => row.id}
      viewportHeight={2000}
      processing={processing}
      query={query}
      onQueryChange={() => undefined}
    />
  );
}

function renderSurface(processing: PretableProcessingOptions | undefined) {
  return render(surface(processing));
}

/** What the header row publishes about the query, independent of the body. */
function reportedHeaderState(): {
  ariaSort: string | null;
  filterActive: string | null;
} {
  const header = document.querySelector("[aria-sort]");
  const funnel = document.querySelector(
    '[data-pretable-filter-funnel][data-pretable-column-id="customer"]',
  );
  return {
    ariaSort: header?.getAttribute("aria-sort") ?? null,
    filterActive: funnel?.getAttribute("data-pretable-filter-active") ?? null,
  };
}

describe("external filter authority suppresses local filtering", () => {
  it("renders every row the server returned when rows and query disagree", () => {
    renderSurface(EXTERNAL);
    expect(renderedRowIds()).toEqual(LOADED.map((row) => row.id));
  });

  it("still filters locally when the engine holds filter authority", () => {
    renderSurface({ filter: "engine", sort: "engine" });
    expect(renderedRowIds()).toEqual([]);
  });

  it("still filters locally when no processing authority is declared", () => {
    renderSurface(undefined);
    expect(renderedRowIds()).toEqual([]);
  });

  it("follows a processing flip after mount, in both directions", async () => {
    const view = render(surface({ filter: "engine", sort: "engine" }));
    expect(renderedRowIds()).toEqual([]);

    view.rerender(surface(EXTERNAL));
    await expect
      .poll(() => renderedRowIds())
      .toEqual(LOADED.map((row) => row.id));

    view.rerender(surface({ filter: "engine", sort: "engine" }));
    await expect.poll(() => renderedRowIds()).toEqual([]);
  });

  it("reports the filter and sort it stopped applying", () => {
    const engine = render(surface(undefined, NARROWING_AND_SORTED));
    const reportedByEngine = reportedHeaderState();
    engine.unmount();

    render(surface(EXTERNAL, NARROWING_AND_SORTED));
    const reportedByExternal = reportedHeaderState();

    // The positive twin: these would match just as well if both were null.
    expect(reportedByExternal).toEqual({
      ariaSort: "ascending",
      filterActive: "true",
    });
    expect(reportedByExternal).toEqual(reportedByEngine);
  });

  it("publishes a query change through onQueryChange unchanged", async () => {
    const seen: PretableQueryFor<typeof columns>[] = [];
    let grid: {
      setQuery: (q: PretableQueryFor<typeof columns>) => void;
    } | null = null;
    render(
      <PretableSurface<Row, string, typeof columns>
        ariaLabel="Orders"
        columns={columns}
        rows={LOADED}
        getRowId={(row) => row.id}
        viewportHeight={2000}
        processing={EXTERNAL}
        onGridReady={(next) => {
          grid = next as unknown as typeof grid;
        }}
        onQueryChange={(next) => seen.push(next)}
      />,
    );
    await expect.poll(() => grid).not.toBeNull();
    act(() => grid!.setQuery(NARROWING_AND_SORTED));

    await expect.poll(() => seen.at(-1)).toEqual(NARROWING_AND_SORTED);
    // Uncontrolled, so the engine really applied it — and still drew the rows.
    await expect
      .poll(() => renderedRowIds())
      .toEqual(["r2", "r3", "r5", "r1", "r6", "r4"]);
    expect(reportedHeaderState()).toEqual({
      ariaSort: "ascending",
      filterActive: "true",
    });
  });

  it("leaves an explicitly-owned model filtering locally", async () => {
    const model = createLocalRowModel({
      rows: [...LOADED],
      columns,
      getRowId: (row: Row) => row.id,
      query: NARROWING_QUERY,
    });
    render(
      <PretableSurface
        ariaLabel="Orders"
        model={model}
        viewportHeight={2000}
        processing={EXTERNAL}
      />,
    );
    expect(renderedRowIds()).toEqual([]);
    // A leak would arrive on a cooperative transition, not in this commit, so
    // the empty body has to survive a settle to mean anything — and the claim
    // is about the model's own selection, which the viewport only reflects.
    await settle();
    expect(modelRowIds(model)).toEqual([]);
    expect(renderedRowIds()).toEqual([]);
  });

  it("draws the rows an explicitly-owned model does match", async () => {
    // The positive twin for the test above: model mode really can paint a body
    // here, so the empty one is the filter and not the harness.
    const model = createLocalRowModel({
      rows: [...LOADED],
      columns,
      getRowId: (row: Row) => row.id,
      query: {
        filters: [{ columnId: "customer", operator: "contains", value: "war" }],
        sort: [],
        rowGroups: [],
      },
    });
    render(
      <PretableSurface
        ariaLabel="Orders"
        model={model}
        viewportHeight={2000}
        processing={EXTERNAL}
      />,
    );
    await settle();
    expect(modelRowIds(model)).toEqual(["r5", "r6"]);
    expect(renderedRowIds()).toEqual(["r5", "r6"]);
  });
});
