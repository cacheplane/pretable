import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Deep CSS override",
  description:
    "Plain selectors recolor the selected cell and the header and the resize handle with no !important, and a computed-style readout proves an attempted resize-handle width override does nothing because the surface writes width inline.",
  files: [
    "DeepCssOverrideGrid.tsx",
    "deep-override.css",
    "columns.ts",
    "data.ts",
  ],
});
