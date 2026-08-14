import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Composition order",
  description:
    "Independent dark-mode and accent-override toggles on the same wrapper prove the layer order: the override wins in both light and dark because it resolves after the theme, not because of where it sits relative to the dark block.",
  files: ["CompositionOrderGrid.tsx", "columns.ts", "data.ts"],
});
