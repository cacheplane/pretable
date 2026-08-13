import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Scroll follows focus",
  description:
    "140 trades exceed the viewport, so jump keys reveal focus with minimal scroll instead of centering it.",
  files: ["KeyboardNavGrid.tsx", "columns.ts", "data.ts"],
});
