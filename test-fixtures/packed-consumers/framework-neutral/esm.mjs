import { createRequire } from "node:module";
import { createColumnHelper } from "@pretable/core";
import { createBatcher } from "@pretable/stream-adapter";
import { getDensityHeights } from "@pretable/ui";

const require = createRequire(import.meta.url);
try {
  require.resolve("react");
  throw new Error(
    "React unexpectedly resolved in the framework-neutral consumer",
  );
} catch (error) {
  if (error?.code !== "MODULE_NOT_FOUND") throw error;
}

if (
  [createColumnHelper, createBatcher, getDensityHeights].some(
    (value) => typeof value !== "function",
  )
) {
  throw new Error("A framework-neutral ESM export is missing");
}
