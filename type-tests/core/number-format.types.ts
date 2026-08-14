import {
  createColumnHelper,
  numberFormats,
  type PretableColumn,
} from "@pretable/core";
import type { Equal, Expect } from "../shared/assert";

interface Product {
  id: string;
  name: string;
  price: number;
}

const column = createColumnHelper<Product>();

/** The idiom the number-formatting and API-reference docs publish. */
export const productColumns = [
  column.accessor("name", { type: "text" }),
  column.accessor("price", {
    type: "number",
    aggregate: "sum",
    numberFormat: numberFormats.money({ currency: "USD" }),
  }),
  column.accessor("marginPct", (row) => row.price / 100, {
    type: "number",
    numberFormat: { style: "percent", maximumFractionDigits: 1 },
  }),
] as const;

type _DirectNumberFormat = Expect<
  Equal<
    (typeof productColumns)[1]["numberFormat"],
    Intl.NumberFormatOptions | undefined
  >
>;
type _ComputedNumberFormat = Expect<
  Equal<
    (typeof productColumns)[2]["numberFormat"],
    Intl.NumberFormatOptions | undefined
  >
>;

/** `numberFormat` coexists with the callback formatters it is outranked by. */
column.accessor("price", {
  type: "number",
  aggregate: "sum",
  numberFormat: numberFormats.accounting({ currency: "USD" }),
  format: ({ value }) => value.toFixed(2),
  formatAggregate: ({ value }) => `${value ?? 0}`,
});

column.accessor("price", {
  type: "number",
  // @ts-expect-error numberFormat takes native Intl options, not a preset name
  numberFormat: "money",
});

/** Hand-declared engine columns keep accepting the same option. */
const plainColumn: PretableColumn<Product> = {
  id: "price",
  type: "number",
  numberFormat: numberFormats.money({ currency: "USD" }),
};
void plainColumn;

void (null as unknown as _DirectNumberFormat);
void (null as unknown as _ComputedNumberFormat);
