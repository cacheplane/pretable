import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Headless custom renderer",
  description:
    "Drive your own markup from the @pretable/core row model with useSyncExternalStore — no grid renderer involved.",
  files: ["HeadlessTable.tsx", "columns.ts", "data.ts"],
});
