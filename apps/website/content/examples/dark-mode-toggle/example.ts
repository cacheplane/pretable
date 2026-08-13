import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Dark mode toggle",
  description:
    "A button flips the data-theme attribute to dark on a wrapper div — pretable.css's dark block is a bare attribute selector, so the grid repaints instantly with no JavaScript touching a token value.",
  files: ["DarkModeToggleGrid.tsx", "columns.ts", "data.ts"],
});
