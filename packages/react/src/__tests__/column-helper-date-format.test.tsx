import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createColumnHelper, createLocalRowModel } from "@pretable/core";

import { PretableSurface } from "../pretable-surface";

afterEach(cleanup);

type DatedRow = {
  id: string;
  region: string;
  due: string | null;
};

const rows: DatedRow[] = [
  { id: "r1", region: "West", due: "2026-08-11" },
  { id: "r2", region: "West", due: "2025-01-02" },
];
const dateFormat = { dateStyle: "medium" } as const;
const helper = createColumnHelper<DatedRow>();

function texts(container: HTMLElement, columnId: string): string[] {
  return Array.from(
    container.querySelectorAll(`[data-pretable-column-id="${columnId}"]`),
  ).map((node) => node.textContent ?? "");
}

describe("createColumnHelper dateFormat", () => {
  it("formats rows-mode data and inherited date extrema", () => {
    const columns = [
      helper.accessor("region", { type: "text", header: "Region" }),
      helper.accessor("due", {
        type: "date",
        header: "Due",
        aggregate: "min",
        dateFormat,
      }),
    ] as const;

    const view = render(
      <PretableSurface
        ariaLabel="dated rows"
        columns={columns}
        getRowId={(row) => row.id}
        initialExpansion={{ kind: "expanded" }}
        locale="en-US"
        onQueryChange={() => {}}
        query={{
          filters: [],
          sort: [],
          rowGroups: [{ columnId: "region" }],
        }}
        rows={rows}
        viewportHeight={240}
      />,
    );

    expect(texts(view.container, "due")).toContain("Jan 2, 2025");
    expect(texts(view.container, "due")).toContain("Aug 11, 2026");
  });

  it("formats the schema-owned dateFormat in explicit-model mode", () => {
    const columns = [
      helper.accessor("due", {
        type: "date",
        header: "Due",
        dateFormat,
      }),
    ] as const;
    const model = createLocalRowModel({ rows, columns });

    const view = render(
      <PretableSurface
        ariaLabel="explicit dated rows"
        locale="en-US"
        model={model}
        viewportHeight={240}
      />,
    );

    expect(texts(view.container, "due")).toContain("Aug 11, 2026");
    expect(texts(view.container, "due")).toContain("Jan 2, 2025");
    model.dispose();
  });
});
