import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Reading density heights reactively",
  description:
    "The useDensityHeights recipe from this page run twice — once given a boxed wrapper whose data-density the buttons flip, once given null so it reads the document root — with a readout showing only the scoped one moving.",
  files: ["DensityHeightsDemo.tsx", "useDensityHeights.ts"],
});
