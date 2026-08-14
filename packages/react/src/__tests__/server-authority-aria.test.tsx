import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type {
  PretableMatchingTotal,
  PretableProcessingOptions,
} from "@pretable/core";

afterEach(cleanup);

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
