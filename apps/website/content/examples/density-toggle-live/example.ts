import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Density toggle",
  description:
    "Three buttons set data-density on a wrapper div; the caption below shows cell padding and the rendered row height moving together, because the engine resolves its JS-read density tokens against the grid's own element rather than document.documentElement.",
  files: ["DensityToggleGrid.tsx", "columns.ts", "data.ts"],
});
