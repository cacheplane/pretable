import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Signed changes",
  description:
    "Positive, negative, and zero changes use the same currency formatter while PretableDelta reads the raw value for direction.",
  files: ["DeltaDirectionsExample.tsx"],
  height: 240,
});
