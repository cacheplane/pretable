import { createColumnHelper } from "@pretable/core";
import { Pretable } from "@pretable/react";
import { createBatcher } from "@pretable/stream-adapter";
import { getDensityHeights } from "@pretable/ui";
import "@pretable/ui/themes/excel.css";
import "@pretable/ui/themes/material.css";
import "@pretable/ui/themes/pretable.css";
import "@pretable/ui/grid.css";
import "@pretable/ui/tailwind.css";
import "@pretable/ui/tokens.css";

const values = [createColumnHelper, Pretable, createBatcher, getDensityHeights];
document.documentElement.dataset.pretablePackedConsumer = values
  .map((value) => typeof value)
  .join(",");
