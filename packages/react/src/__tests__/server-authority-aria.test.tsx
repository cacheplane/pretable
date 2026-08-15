import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createColumnHelper, createLocalRowModel } from "@pretable/core";

import { resetDevWarnings } from "../dev-warn";
import { PretableSurface } from "../pretable-surface";
import type { SerializeCsvArgs } from "../csv";
import type { PretableSurfaceGrid } from "../pretable-surface";
import type {
  PretableMatchingTotal,
  PretableProcessingOptions,
} from "@pretable/core";

afterEach(cleanup);

// The honesty rules warn once per process, so a latch set by one test would
// silence the next one asserting the same message. Spied rather than left to
// print, because several tests here render configurations that warn on purpose.
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDevWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

/** Every `console.warn` message this test's render produced, joined. */
function warnings(): string {
  return warn.mock.calls
    .map((call: readonly unknown[]) => String(call[0]))
    .join("\n");
}

type Row = { id: string; name: string; team: string };

const rows: Row[] = [
  { id: "a", name: "Ada", team: "x" },
  { id: "b", name: "Bob", team: "y" },
];

const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "team", header: "Team", widthPx: 120 },
];

function renderSurface(opts: {
  processing?: PretableProcessingOptions;
  total?: PretableMatchingTotal;
  rowGroups?: string[];
}) {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      processing={opts.processing}
      resultMeta={opts.total ? { total: opts.total } : undefined}
      query={{
        filters: [],
        sort: [],
        rowGroups: (opts.rowGroups ?? []).map((columnId) => ({ columnId })),
      }}
      onQueryChange={() => undefined}
    />,
  );
}

const EXTERNAL: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};

describe("aria-rowcount honesty rules", () => {
  it("publishes the exact population under full external authority", () => {
    renderSurface({
      processing: EXTERNAL,
      total: { kind: "exact", count: 5432 },
    });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "5433");
  });

  it("keeps global aria-rowindex arithmetic (model index + 2)", () => {
    renderSurface({
      processing: EXTERNAL,
      total: { kind: "exact", count: 5432 },
    });
    const gridRows = screen.getAllByRole("row");
    expect(gridRows[gridRows.length - 1]).toHaveAttribute("aria-rowindex", "3");
  });

  it("downgrades to the loaded model count when sort authority is engine", () => {
    renderSurface({
      processing: { filter: "external", sort: "engine" },
      total: { kind: "exact", count: 5432 },
    });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("downgrades to the loaded model count while grouping is active", () => {
    renderSurface({
      processing: EXTERNAL,
      total: { kind: "exact", count: 5432 },
      rowGroups: ["team"],
    });
    // Two team groups, both rows drawn under them (grouping defaults to
    // expanded), plus the header row. The rule under test is unchanged: the
    // external total of 5432 is NOT published while grouping is active.
    expect(screen.getByRole("treegrid")).toHaveAttribute("aria-rowcount", "5");
  });

  it("reports -1 for an estimate total", () => {
    renderSurface({
      processing: EXTERNAL,
      total: { kind: "estimate", count: 5000 },
    });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "-1");
  });

  it("reports -1 for an unknown total", () => {
    renderSurface({ processing: EXTERNAL, total: { kind: "unknown" } });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "-1");
  });

  it("downgrades when more records are loaded than the total claims", () => {
    renderSurface({ processing: EXTERNAL, total: { kind: "exact", count: 1 } });
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("is unchanged in local mode", () => {
    renderSurface({});
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
  });

  it("never sets aria-busy, in any configuration", () => {
    const configurations: Parameters<typeof renderSurface>[0][] = [
      {},
      { processing: EXTERNAL, total: { kind: "exact", count: 5432 } },
      { processing: EXTERNAL, total: { kind: "estimate", count: 5000 } },
      { processing: EXTERNAL, total: { kind: "unknown" } },
      {
        processing: { filter: "external", sort: "engine" },
        total: { kind: "exact", count: 5432 },
      },
      {
        processing: EXTERNAL,
        total: { kind: "exact", count: 5432 },
        rowGroups: ["team"],
      },
    ];
    for (const configuration of configurations) {
      renderSurface(configuration);
      expect(
        screen.getByRole(configuration.rowGroups ? "treegrid" : "grid"),
      ).not.toHaveAttribute("aria-busy");
      cleanup();
    }
  });

  it("reports the dataset position in aria-rowindex under a window", () => {
    render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={rows.concat({ id: "c", name: "Cara", team: "z" })}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={EXTERNAL}
        resultMeta={{
          total: { kind: "exact", count: 100_000 },
          window: { start: 40_000, hasMore: true },
        }}
        query={{ filters: [], sort: [], rowGroups: [] }}
        onQueryChange={() => undefined}
      />,
    );
    const gridRows = screen.getAllByRole("row");
    // Header row first, then the three data rows: [0] is the header.
    expect(gridRows[1]).toHaveAttribute("aria-rowindex", "40002");
  });

  it("forwards ariaDescribedBy to the grid element", () => {
    render(
      <PretableSurface<Row>
        ariaLabel="People"
        ariaDescribedBy="notice-1"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={400}
      />,
    );
    expect(screen.getByRole("grid")).toHaveAttribute(
      "aria-describedby",
      "notice-1",
    );
  });
});

const THIRD_ROW: Row = { id: "c", name: "Cara", team: "z" };
const ALL_ROWS: Row[] = [...rows, THIRD_ROW];

/**
 * `rows` and `resultMeta.total` arrive on the same commit, but the row model
 * only ingests rows in a layout effect — after the render that already read the
 * new total. Every honesty input has to be read from the SAME commit, or the
 * checks compare a new total against the previous query's row count and report
 * a contradiction the consumer never committed.
 */
describe("honesty inputs come from one commit", () => {
  it("stays silent when a narrowing query commits rows and total together", () => {
    const view = render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={ALL_ROWS}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={EXTERNAL}
        resultMeta={{ total: { kind: "exact", count: 3 } }}
      />,
    );
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "4");

    view.rerender(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={[ALL_ROWS[0]!]}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={EXTERNAL}
        resultMeta={{ total: { kind: "exact", count: 1 } }}
      />,
    );

    expect(warnings()).not.toContain("fewer matching records");
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
  });

  it("stays silent when a widening query commits rows under the fallback total", () => {
    // No `resultMeta.total`: the surface falls back to "the population is
    // whatever you handed me", which has to be the SAME count the contiguity
    // check measures the window against.
    const view = render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={[ALL_ROWS[0]!]}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={EXTERNAL}
      />,
    );

    view.rerender(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={ALL_ROWS}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={EXTERNAL}
      />,
    );

    expect(warnings()).not.toContain("fewer matching records");
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "4");
  });

  it('keeps an explicit model\'s scope "all" when its total covers the model', () => {
    // The `rows` prop is `[]` — not `undefined` — in explicit-model mode, so a
    // loaded count read off it would report zero records and answer "loaded"
    // for a grid that demonstrably holds everything.
    const helper = createColumnHelper<Row>();
    const model = createLocalRowModel({
      rows: ALL_ROWS,
      columns: [
        helper.accessor("name", { type: "text" }),
        helper.accessor("team", { type: "text" }),
      ] as const,
      getRowId: (row: Row) => row.id,
    });
    const seen: SerializeCsvArgs<Row, string, never>[] = [];
    let grid: PretableSurfaceGrid<Row, string, never> | null = null;

    render(
      <PretableSurface
        ariaLabel="People"
        model={model as never}
        viewportHeight={400}
        processing={EXTERNAL}
        resultMeta={{ total: { kind: "exact", count: 3 } }}
        onExport={(args) => {
          seen.push(args as never);
          return null;
        }}
        saveFile={() => undefined}
        onGridReady={(ready) => {
          grid = ready as never;
        }}
      />,
    );

    act(() => {
      (grid as unknown as PretableSurfaceGrid<Row, string, never>).exportCsv();
    });

    expect(seen[0]?.scope).toBe("all");
    model.dispose();
  });
});

/**
 * Engine sort over a window the server chose reorders a SAMPLE and labels it
 * with an ordinary `aria-sort`. The rule has to fire from a real render — it
 * sat fully unit-tested and entirely unwired for months precisely because
 * nothing rendered it.
 */
describe("engine sort over a partial window", () => {
  it("warns from a real render when the window is provably partial", () => {
    render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={ALL_ROWS}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={{ filter: "external", sort: "engine" }}
        resultMeta={{ total: { kind: "exact", count: 100 } }}
      />,
    );

    expect(warnings()).toContain('sort authority is "engine"');
  });

  it("stays silent when the loaded rows are the whole population", () => {
    render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={ALL_ROWS}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={{ filter: "external", sort: "engine" }}
        resultMeta={{ total: { kind: "exact", count: 3 } }}
      />,
    );

    expect(warnings()).not.toContain('sort authority is "engine"');
  });

  it("stays silent when a widening query commits rows and total together", () => {
    // The shape of the lifecycle docs example: external filter, engine sort,
    // and an exact total that always equals the delivered row count. A search
    // that widens must not make the loaded window look partial for one render.
    const view = render(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={[ALL_ROWS[0]!]}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={{ filter: "external" }}
        resultMeta={{ total: { kind: "exact", count: 1 } }}
      />,
    );

    view.rerender(
      <PretableSurface<Row>
        ariaLabel="People"
        columns={columns}
        rows={ALL_ROWS}
        getRowId={(row) => row.id}
        viewportHeight={400}
        processing={{ filter: "external" }}
        resultMeta={{ total: { kind: "exact", count: 3 } }}
      />,
    );

    expect(warnings()).not.toContain('sort authority is "engine"');
  });
});
