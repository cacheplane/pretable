import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Saved view actions",
  description:
    "Apply a saved view with a ghost button, then reset it with a link button. Disabled states prevent repeating the current action.",
  files: ["SavedViewActions.tsx"],
  height: 200,
});
