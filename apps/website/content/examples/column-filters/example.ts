import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Column filters",
  description:
    "One filterable column per type — text, number, enum, date, and boolean — reaching each operator family through the built-in funnel menu, with the enum column declaring no options so its checklist loads distinct values from the rows instead.",
  files: ["ColumnFiltersGrid.tsx", "columns.ts", "data.ts"],
});
