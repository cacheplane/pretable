import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Live token override",
  description:
    "Two buttons redefine --pretable-accent and --pretable-radius on a wrapper div at runtime, the same cascade a :root override in your own stylesheet produces after the theme import.",
  files: ["TokenOverrideGrid.tsx", "columns.ts", "data.ts"],
});
