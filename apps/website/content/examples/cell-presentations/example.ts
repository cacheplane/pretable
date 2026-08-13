import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Cell presentations",
  description:
    "A positions grid using all four presentation components together — PretableEntity for the symbol and name, PretableDelta for day P&L, PretableStatus for settlement, and PretableBadge for a risk or watch flag.",
  files: ["CellPresentationsGrid.tsx", "columns.tsx", "data.ts"],
});
