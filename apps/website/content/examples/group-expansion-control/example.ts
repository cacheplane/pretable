import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Expansion policy: through-depth",
  description:
    "Two group levels seeded from the start, with sector groups collapsed by initialExpansion — click a twisty or use the arrow keys to expand one and reveal its positions.",
  files: ["GroupExpansionGrid.tsx", "columns.ts", "data.ts"],
});
