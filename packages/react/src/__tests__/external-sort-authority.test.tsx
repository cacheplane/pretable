import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createColumnHelper } from "@pretable/core";
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
 * A window the server returned, deliberately NOT in `customer` order. The
 * server ranked these six out of a population of 480 — they are the answer to
 * "top 6 by whatever the server was asked for", and their order carries that
 * ranking. Re-sorting them locally does not reorder the population; it reorders
 * a sample, and the result is six rows that are not the top six of anything.
 */
const LOADED: readonly Row[] = [
  { id: "r1", customer: "Northwind", amount: 60 },
  { id: "r2", customer: "Contoso", amount: 50 },
  { id: "r3", customer: "Fabrikam", amount: 40 },
  { id: "r4", customer: "Tailspin", amount: 30 },
  { id: "r5", customer: "Litware", amount: 20 },
  { id: "r6", customer: "Proseware", amount: 10 },
];

const SERVER_ORDER = LOADED.map((row) => row.id);
/** What a local ascending sort on `customer` would produce instead. */
const LOCAL_SORT_ORDER = ["r2", "r3", "r5", "r1", "r6", "r4"];

const EXTERNAL: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};
const ENGINE: PretableProcessingOptions = {
  filter: "external",
  sort: "engine",
};

const SORTED_QUERY: PretableQueryFor<typeof columns> = {
  filters: [],
  sort: [{ columnId: "customer", direction: "asc" }],
  rowGroups: [],
};

/** Every data row currently drawn, by row id — never a count. */
function renderedRowIds(): string[] {
  return Array.from(
    document.querySelectorAll("[data-pretable-row][data-pretable-row-id]"),
  ).map((node) => node.getAttribute("data-pretable-row-id") ?? "");
}

/** 6 loaded of 480 matching: a partial window by construction. */
function surface(processing: PretableProcessingOptions) {
  return (
    <PretableSurface<Row, string, typeof columns>
      ariaLabel="Orders"
      columns={columns}
      rows={LOADED}
      getRowId={(row) => row.id}
      viewportHeight={2000}
      processing={processing}
      query={SORTED_QUERY}
      resultMeta={{ total: { kind: "exact", count: 480 } }}
      onQueryChange={() => undefined}
    />
  );
}

function warnings(): string[] {
  return warn.mock.calls.map((call: unknown[]) => String(call[0]));
}

describe("the fixture can tell the two orders apart", () => {
  it("server order and local-sort order are different sequences", () => {
    // Without this, every assertion below could pass by coincidence.
    expect(LOCAL_SORT_ORDER).not.toEqual(SERVER_ORDER);
    expect([...LOCAL_SORT_ORDER].sort()).toEqual([...SERVER_ORDER].sort());
  });

  it("engine sort authority really does reorder this fixture", () => {
    render(surface(ENGINE));
    expect(renderedRowIds()).toEqual(LOCAL_SORT_ORDER);
  });
});

describe('sort: "external" suppresses local sorting', () => {
  it("keeps the order the server returned", () => {
    render(surface(EXTERNAL));
    expect(renderedRowIds()).toEqual(SERVER_ORDER);
  });

  it("follows a processing flip after mount, in both directions", async () => {
    // `processing` is a render-time read, never a memo dependency, so a
    // consumer really can flip it while one model lives.
    const view = render(surface(ENGINE));
    expect(renderedRowIds()).toEqual(LOCAL_SORT_ORDER);

    view.rerender(surface(EXTERNAL));
    await expect.poll(() => renderedRowIds()).toEqual(SERVER_ORDER);

    view.rerender(surface(ENGINE));
    await expect.poll(() => renderedRowIds()).toEqual(LOCAL_SORT_ORDER);
  });

  it("still REPORTS the sort it stopped applying", () => {
    render(surface(EXTERNAL));
    // Suppression changes what is APPLIED, never what is REPORTED.
    expect(
      screen.getByRole("columnheader", { name: /customer/i }),
    ).toHaveAttribute("aria-sort", "ascending");
  });
});

describe("the two claims the declaration unlocks are now earned", () => {
  /**
   * These two behaviours predate suppression, and before it they were the
   * argument FOR it: declaring `sort: "external"` silenced the partial-window
   * warning and published the population count, while the local sort it
   * silenced the warning about went on running. Both are now truthful, and
   * both are pinned here so that pairing cannot quietly come apart again.
   *
   * The warning still fires under engine sort authority, where it is still the
   * right thing to say.
   */
  it("the partial-window warning fires for engine sort, and not for external", () => {
    render(surface(ENGINE));
    expect(warnings().join("\n")).toMatch(/wrong SAMPLE/);

    cleanup();
    resetDevWarnings();
    warn.mockClear();

    render(surface(EXTERNAL));
    expect(warnings().join("\n")).not.toMatch(/wrong SAMPLE/);
  });

  /**
   * `aria-rowcount` claims every loaded row sits at its true dataset position.
   * That claim is only honest because the rows were not reordered locally —
   * which is what the first block in this file proves.
   */
  it("declaring external sort publishes the full population as aria-rowcount", () => {
    render(surface(EXTERNAL));
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "481");
  });
});
