import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Controlled row selection",
  description:
    "Check orders, mark the selected orders shipped, and clear the checked set. Controlled row selection also preserves select-all and any orders you uncheck afterward.",
  files: ["ControlledOrdersGrid.tsx", "columns.ts", "data.ts"],
});
