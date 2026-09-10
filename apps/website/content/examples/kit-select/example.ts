import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Sort a project list",
  description:
    "A controlled Select reorders projects. Open it with ArrowDown, skip the disabled option, or type R to find the rich Recently updated label through textValue.",
  files: ["SelectSortExample.tsx"],
  height: 240,
});
