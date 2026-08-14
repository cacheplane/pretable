import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Custom cell editor",
  description:
    "A renderEditor select bridges a numeric priority column to and from the string a native control hands back, via formatEditValue and parseEditValue.",
  files: ["CustomEditorGrid.tsx", "columns.tsx", "data.ts"],
});
