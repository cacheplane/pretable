import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Pin a view",
  description:
    "Toggle a view’s pinned state with an icon-only button. The accessible name stays the same while aria-pressed and a visible status report the change.",
  files: ["PinViewButton.tsx"],
  height: 200,
});
