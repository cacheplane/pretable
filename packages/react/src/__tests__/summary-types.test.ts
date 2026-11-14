import { createColumnHelper } from "@pretable/core";
import { expectTypeOf, it } from "vitest";
import type {} from "../types";
it("infers aggregate outputs for core and React summary callbacks", () => {
  const helper = createColumnHelper<{
    id: string;
    amount: number;
    date: string;
  }>();
  helper.accessor("amount", {
    type: "number",
    aggregate: "sum",
    formatSummary: ({ value, summary }) => {
      expectTypeOf(value).toEqualTypeOf<number | null>();
      expectTypeOf(summary.state).toEqualTypeOf<"ready" | "stale">();
      return String(value);
    },
  });
  helper.accessor("computed", (row) => row.date, {
    type: "date",
    aggregate: "min",
    formatSummary: ({ value }) => {
      expectTypeOf(value).toEqualTypeOf<string | null>();
      return String(value);
    },
  });
  helper.accessor("amount", {
    type: "number",
    aggregate: "sum",
    header: null,
    formatSummary: ({ value }) => {
      expectTypeOf(value).toEqualTypeOf<number | null>();
      return String(value);
    },
  });
});
