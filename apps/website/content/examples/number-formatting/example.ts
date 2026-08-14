import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Money, accounting, and percent formats",
  description:
    "A regional sales grid using numberFormats.money, numberFormats.accounting, and a raw percent numberFormat, grouped by region so each aggregate row inherits its column's format with no formatAggregate callback.",
  files: ["RegionalSalesGrid.tsx", "columns.ts", "data.ts"],
});
