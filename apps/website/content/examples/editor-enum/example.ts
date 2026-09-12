import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Move a task through its workflow",
  description:
    "Choose a status label and inspect its canonical value in the saved row.",
  files: ["EnumEditingGrid.tsx"],
  height: 440,
});
