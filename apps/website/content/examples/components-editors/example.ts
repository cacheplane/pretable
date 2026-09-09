import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Use your own editor controls",
  description:
    "Native input, textarea, and icon-button replacements preserve built-in editing, including a number stepper, multiline drafts, and delayed saves with a corrected retry.",
  files: [
    "EditorControlsGrid.tsx",
    "EditorControls.tsx",
    "editor-controls.css",
  ],
});
