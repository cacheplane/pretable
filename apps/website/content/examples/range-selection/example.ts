import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Range selection",
  description:
    "Cell-range selection plus the checkbox column, both controlled from the same PretableSelectionState — shift-click extends a range, Cmd/Ctrl-click adds a discontiguous one, and dragging marquees a rectangle, with a caption below echoing the active ranges as you go.",
  files: ["RangeSelectionGrid.tsx", "columns.ts", "data.ts"],
});
