import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Anchor, tile, and clip",
  description:
    "A 2x2 clipboard block writes once at a single cell, tiles across an exact-multiple selection, and clips with a reported, appended overflow past the last row.",
  files: ["PasteGeometryGrid.tsx", "columns.ts", "data.ts"],
  height: 360,
});
