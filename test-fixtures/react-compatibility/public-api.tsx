import { createColumnHelper } from "@pretable/core";
import {
  Pretable,
  PretableBadge,
  PretableOverlayProvider,
  PretableSelect,
  type PretableLocale,
  type PretableSelectOption,
} from "@pretable/react";
import { createBatcher } from "@pretable/stream-adapter";
import { getDensityHeights } from "@pretable/ui";
import * as React from "react";

interface Person {
  id: string;
  name: string;
}

const column = createColumnHelper<Person>();
const columns = [
  column.accessor("name", { header: "Name", type: "text" }),
] as const;
const rows = [{ id: "1", name: "Ada" }] as const satisfies readonly Person[];
const locale: PretableLocale = ["en-US"];

const choices: readonly PretableSelectOption[] = [
  { value: "one", label: "One" },
  { value: "two", label: <strong>Two</strong>, textValue: "Two" },
];

export const publicValues = [createBatcher, getDensityHeights, locale] as const;

export function CompatibilityGrid() {
  return (
    <PretableOverlayProvider container={null}>
      <PretableBadge tone="positive">Ready</PretableBadge>
      <PretableSelect
        aria-label="Choice"
        options={choices}
        value="one"
        onChange={() => {}}
      />
      <Pretable
        ariaLabel="People"
        columns={columns}
        getRowId={(row) => row.id}
        locale={locale}
        rows={rows}
      />
    </PretableOverlayProvider>
  );
}
