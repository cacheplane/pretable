const { createColumnHelper } = require("@pretable/core");
const { createBatcher } = require("@pretable/stream-adapter");
const { getDensityHeights } = require("@pretable/ui");

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
  throw new Error("A framework-neutral CommonJS export is missing");
}
