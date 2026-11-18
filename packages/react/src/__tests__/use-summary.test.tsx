import { act } from "@testing-library/react";
import { createColumnHelper } from "@pretable/core";
import { usePretable } from "../use-pretable";
import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useSummary } from "../use-summary";
import type { PretableSummaries } from "../summary";
it("acquires replacements before release, survives two strict consumers, and releases on model change/unmount", () => {
  const events: string[] = [];
  let active = 0;
  const model = {
    acquireSummaryScopes: vi.fn((scopes: readonly string[]) => {
      active++;
      events.push(`acquire:${scopes.join()}`);
      return () => {
        active--;
        events.push("release");
      };
    }),
  };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <StrictMode>{children}</StrictMode>
  );
  const initial: PretableSummaries = { all: { authority: "engine" } };
  const a = renderHook(
    ({ summaries, owner }) =>
      useSummary({ model: owner, snapshot: {}, columns: [], summaries }),
    { initialProps: { summaries: initial, owner: model }, wrapper },
  );
  const b = renderHook(
    () => useSummary({ model, snapshot: {}, columns: [], summaries: initial }),
    { wrapper },
  );
  expect(active).toBe(2);
  events.length = 0;
  a.rerender({
    summaries: { filtered: { authority: "engine" } },
    owner: model,
  });
  expect(events).toEqual(["acquire:filtered", "release"]);
  expect(active).toBe(2);
  const replacement = { acquireSummaryScopes: vi.fn(() => () => {}) };
  a.rerender({ summaries: initial, owner: replacement });
  expect(active).toBe(1);
  a.unmount();
  b.unmount();
  expect(active).toBe(0);
});
it("resolves a supplied committed snapshot and supports server-only models without leases", () => {
  const snapshot = {
    getSummary: vi.fn(() => ({ scope: "all" as const, values: { amount: 2 } })),
  };
  const { result } = renderHook(() =>
    useSummary({
      model: {},
      snapshot,
      columns: [{ id: "amount" }],
      summaries: {
        all: {
          authority: "server",
          requestKey: "q",
          aggregateDefinitionKey: "a",
          result: {
            state: "ready",
            requestKey: "q",
            aggregateDefinitionKey: "a",
            completeness: "complete",
            values: { amount: 7 },
          },
        },
      },
    }),
  );
  expect(result.current.all).toMatchObject({
    state: "ready",
    values: { amount: 7 },
  });
  expect(snapshot.getSummary).not.toHaveBeenCalled();
});

it("preserves actual grid selection and edit state when summary demand changes", () => {
  const helper = createColumnHelper<{ id: string; amount: number }>();
  const columns = [
    helper.accessor("amount", { type: "number", aggregate: "sum" }),
  ] as const;
  const rows = [{ id: "a", amount: 4 }];
  const { result, rerender, unmount } = renderHook(
    ({ summaries }: { summaries: PretableSummaries }) => {
      const table = usePretable({ rows, columns, viewportHeight: 200 });
      useSummary({
        model: table.rowModel,
        snapshot: table.rowModelSnapshot,
        columns,
        summaries,
      });
      return table;
    },
    { initialProps: { summaries: { all: { authority: "engine" } } } },
  );
  const grid = result.current.grid;
  act(() => {
    grid.toggleRowSelection("a");
    grid.beginEdit({ rowId: "a", columnId: "amount", value: 9 });
  });
  const state = grid.getState();
  expect(state.editing).not.toBeNull();
  rerender({ summaries: { filtered: { authority: "engine" } } });
  expect(result.current.grid).toBe(grid);
  expect(grid.getState().selection).toEqual(state.selection);
  expect(grid.getState().editing).toEqual(state.editing);
  unmount();
});
