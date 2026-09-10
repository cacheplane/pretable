import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Select projects",
  description:
    "Controlled checkboxes share a selected-project list. Select all starts mixed, selects every project on activation, then clears the list on the next activation.",
  files: ["CheckboxSelectionExample.tsx"],
  height: 240,
});
