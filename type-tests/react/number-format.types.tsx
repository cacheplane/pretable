import { createColumnHelper, numberFormats } from "@pretable/core";
import { usePretable, type PretableColumn } from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";

interface Order {
  id: string;
  region: string;
  revenue: number;
}

const column = createColumnHelper<Order>();

/**
 * `render` forces the React-augmented helper overload, so this pins the option
 * on the overload a `@pretable/react` consumer actually resolves to.
 */
const orderColumns = [
  column.accessor("region", { type: "text", header: "Region" }),
  column.accessor("revenue", {
    type: "number",
    header: "Revenue",
    aggregate: "sum",
    numberFormat: numberFormats.money({ currency: "USD" }),
    render: ({ formattedValue }) => formattedValue,
  }),
] as const;

type _ReactNumberFormat = Expect<
  Equal<
    (typeof orderColumns)[1]["numberFormat"],
    Intl.NumberFormatOptions | undefined
  >
>;

usePretable({
  rows: [{ id: "o1", region: "West", revenue: 1234.5 }],
  columns: orderColumns,
  viewportHeight: 320,
});

column.accessor("revenue", {
  type: "number",
  // @ts-expect-error numberFormat takes native Intl options, not a preset name
  numberFormat: "money",
  render: ({ formattedValue }) => formattedValue,
});

/** Hand-declared React columns keep accepting the same option. */
const plainColumn: PretableColumn<Order> = {
  id: "revenue",
  type: "number",
  numberFormat: numberFormats.accounting({ currency: "USD" }),
};
void plainColumn;

void (null as unknown as _ReactNumberFormat);
