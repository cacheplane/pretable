import { createColumnHelper } from "@pretable/core";
import { Pretable, PretableBadge, type PretableLocale } from "@pretable/react";
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

export const publicValues = [createBatcher, getDensityHeights, locale] as const;

export function CompatibilityGrid() {
  return (
    <>
      <PretableBadge tone="positive">Ready</PretableBadge>
      <Pretable
        ariaLabel="People"
        columns={columns}
        getRowId={(row) => row.id}
        locale={locale}
        rows={rows}
      />
    </>
  );
}
