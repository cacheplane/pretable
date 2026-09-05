import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Replacing a component",
  description:
    "The grid's own tool panel and filter dialog, with every Button replaced by the app's — one slot, applied everywhere, branching on site for the one place it treats differently.",
  files: [
    "ComponentsGrid.tsx",
    "BrandButton.tsx",
    "brand-button.css",
    "columns.ts",
    "data.ts",
  ],
});
