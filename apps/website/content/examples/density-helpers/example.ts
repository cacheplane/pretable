import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Reading density heights reactively",
  description:
    "The unmodified useDensityHeights recipe from this page, next to buttons that flip data-density on a boxed wrapper and a readout showing the wrapper's own heights alongside the page root's, which never moves.",
  files: ["DensityHeightsDemo.tsx", "useDensityHeights.ts"],
});
