import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "A complete custom theme",
  description:
    "brand.css defines all 50 pretable tokens plus a dark block and density tiers, scoped to a wrapper class so this one demo can run its own theme alongside the rest of the docs site.",
  files: ["brand.css", "CustomThemeGrid.tsx", "columns.ts", "data.ts"],
});
