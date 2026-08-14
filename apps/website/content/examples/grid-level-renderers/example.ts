import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Grid-level cell and header renderers",
  description:
    "A support-ticket grid where renderBodyCell and renderHeaderCell on PretableSurface itself pick the presentation per column, the pattern a design-system wrapper reaches for instead of per-column render hooks.",
  files: ["TicketGrid.tsx", "columns.ts", "data.ts"],
});
