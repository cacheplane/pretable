import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "External search with an explicit dataState lifecycle",
  description:
    'A product search backed by a scripted endpoint with an induced 700ms delay and a deterministic failure — search for "fail" — so idle, stale, and error are all reachable while the existing rows stay sortable and clickable throughout.',
  files: ["DataStateGrid.tsx", "columns.ts", "data.ts", "search-products.ts"],
  height: 420,
});
