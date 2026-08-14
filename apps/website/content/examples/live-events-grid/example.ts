import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Declarative rows mode",
  description:
    "A live-events grid in the default rows mode — pass rows and columns, and PretableSurface reconciles later rows props into one long-lived local row model for you.",
  files: ["EventGrid.tsx", "columns.ts", "data.ts"],
});
