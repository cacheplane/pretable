import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Atomic transactions",
  description:
    "One applyTransaction call adds a row, updates a row, and attempts to remove one that never existed — all landing as a single revision, with the unknown removal reported as a non-fatal issue.",
  files: ["TransactionDemo.tsx", "columns.ts", "data.ts"],
});
