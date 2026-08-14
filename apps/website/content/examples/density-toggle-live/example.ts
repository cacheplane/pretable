import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Density toggle",
  description:
    "Three buttons set data-density on a wrapper div; the caption below shows cell padding updating live from plain CSS while rendered row height stays fixed, because the engine reads row height off document.documentElement, not off the wrapper.",
  files: ["DensityToggleGrid.tsx", "columns.ts", "data.ts"],
});
