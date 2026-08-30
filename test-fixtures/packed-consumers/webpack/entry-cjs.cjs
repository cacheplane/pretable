const { createColumnHelper } = require("@pretable/core");
const { Pretable } = require("@pretable/react");
const { createBatcher } = require("@pretable/stream-adapter");
const { getDensityHeights } = require("@pretable/ui");

globalThis.__PRETABLE_WEBPACK_CJS__ = [
  createColumnHelper,
  Pretable,
  createBatcher,
  getDensityHeights,
].map((value) => typeof value);
