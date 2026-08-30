import { createColumnHelper } from "@pretable/core";
import { Pretable } from "@pretable/react";
import { createBatcher } from "@pretable/stream-adapter";
import { getDensityHeights } from "@pretable/ui";
import "@pretable/ui/grid.css";
import "@pretable/ui/themes/pretable.css";

globalThis.__PRETABLE_WEBPACK_ESM__ = [
  createColumnHelper,
  Pretable,
  createBatcher,
  getDensityHeights,
].map((value) => typeof value);
