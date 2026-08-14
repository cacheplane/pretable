import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Token-aware toolbar",
  description:
    "A plain CSS toolbar reads var(--pretable-*) tokens directly and repaints alongside the grid when dark mode toggles, proving the tokens resolve live for any styling approach, not just the shipped grid CSS.",
  files: ["TokenAwareToolbar.tsx", "toolbar.css", "columns.ts", "data.ts"],
});
