import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Range selection",
  description:
    "The two selection slices side by side: cell ranges controlled through PretableSelectionFor<typeof columns> and onSelectionChange, and the rowSelectionColumn checkbox set reported by onRowSelectionChange — shift-click extends a range, Cmd/Ctrl-click adds a discontiguous one, dragging marquees a rectangle, and a caption under each shows which callback just fired.",
  files: ["RangeSelectionGrid.tsx", "columns.ts", "data.ts"],
});
